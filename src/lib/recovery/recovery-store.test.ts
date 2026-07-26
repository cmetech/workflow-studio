import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPairText } from '$src/lib/documents/types'
import {
  createRecoveryDraft,
  createRecoveryStore,
  RecoveryDraftController,
  shouldOfferRecovery,
  type RecoveryNativePort,
} from './recovery-store'

function pair(workflowId = 'workflow-1', text = 'id: draft\ntasks: {}\n'): WorkflowPairText {
  return {
    workflowId,
    generation: 1,
    definition: {
      id: `${workflowId}:definition`,
      kind: 'definition',
      path: `flows/${workflowId}.yaml`,
      text,
      revision: 3,
      savedRevision: 1,
      diskHash: `${workflowId}-saved`,
    },
    companion: null,
  }
}

function memoryPort(): RecoveryNativePort & { records: Map<string, { key: string; content: string }> } {
  const records = new Map<string, { key: string; content: string }>()
  let sequence = 0
  return {
    records,
    recoveryList: vi.fn(async () =>
      [...records].map(([id, { key, content }]) => ({
        id,
        key,
        content,
        size: new TextEncoder().encode(content).byteLength,
      })),
    ),
    recoveryWrite: vi.fn(async ({ key, content }) => {
      sequence += 1
      records.set(`record-${sequence}`, { key, content })
    }),
    recoveryDelete: vi.fn(async (id) => {
      records.delete(id)
    }),
  }
}

describe('recovery store', () => {
  it('records schema, workflow paths, exact texts/revisions, hashes, and timestamp', () => {
    const draft = createRecoveryDraft(pair(), '2026-07-25T12:00:00.000Z')
    expect(draft).toMatchObject({
      schemaVersion: 1,
      workflowId: 'workflow-1',
      generation: 1,
      updatedAt: '2026-07-25T12:00:00.000Z',
      definition: {
        path: 'flows/workflow-1.yaml',
        text: 'id: draft\ntasks: {}\n',
        revision: 3,
        savedRevision: 1,
        diskHash: 'workflow-1-saved',
      },
      companion: null,
    })
  })

  it('offers a draft only when its exact text differs from current disk content', () => {
    const draft = createRecoveryDraft(pair(), '2026-07-25T12:00:00.000Z')
    expect(shouldOfferRecovery(draft, { definitionText: draft.definition.text, companionText: null })).toBe(false)
    expect(shouldOfferRecovery(draft, { definitionText: 'id: disk\n', companionText: null })).toBe(true)
  })

  it('persists dirty drafts after 750ms idle, flushes on close, and discards after save', async () => {
    vi.useFakeTimers()
    const port = memoryPort()
    const store = createRecoveryStore(port)
    const controller = new RecoveryDraftController(store, () => '2026-07-25T12:00:00.000Z')

    controller.changed(pair())
    await vi.advanceTimersByTimeAsync(749)
    expect(port.recoveryWrite).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(port.recoveryWrite).toHaveBeenCalledOnce()

    controller.changed(pair('workflow-2'))
    await controller.close()
    expect(port.recoveryWrite).toHaveBeenCalledTimes(2)

    await store.discard('workflow-1')
    expect([...port.records.values()].some((record) => record.key === 'workflow-1')).toBe(false)
    vi.useRealTimers()
  })

  it('keeps at most 50 workflow drafts by pruning oldest records first', async () => {
    const port = memoryPort()
    const store = createRecoveryStore(port)
    for (let index = 0; index < 51; index += 1) {
      await store.save(createRecoveryDraft(pair(`workflow-${index}`), new Date(index * 1_000).toISOString()))
    }

    const drafts = await store.list()
    expect(drafts).toHaveLength(50)
    expect(drafts.some((draft) => draft.workflowId === 'workflow-0')).toBe(false)
  })

  it('keeps total serialized recovery data within 64 MiB', async () => {
    const port = memoryPort()
    const store = createRecoveryStore(port)
    const chunk = 'x'.repeat(2 * 1024 * 1024)
    for (let index = 0; index < 40; index += 1) {
      await store.save(createRecoveryDraft(pair(`large-${index}`, chunk), new Date(index * 1_000).toISOString()))
    }

    const total = [...port.records.values()].reduce(
      (size, { content }) => size + new TextEncoder().encode(content).byteLength,
      0,
    )
    expect(total).toBeLessThanOrEqual(64 * 1024 * 1024)
  })
})
