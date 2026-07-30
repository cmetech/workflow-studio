import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import { createHistoryState, recordTransaction, redoTransaction, undoTransaction } from '$src/stores/history'
import { createVersion, loadHistoricalPairAsDraft } from './version-actions'

function pair(): WorkflowPairText {
  return {
    workflowId: 'workspace:flow.yaml',
    generation: 4,
    savedGeneration: 4,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'flow.yaml',
      text: 'name: Current\n',
      revision: 7,
      savedRevision: 7,
      diskHash: 'definition-hash',
    },
    companion: {
      id: 'companion',
      kind: 'companion',
      path: 'flow.hermes.yaml',
      text: 'profile: current\n',
      revision: 3,
      savedRevision: 3,
      diskHash: 'companion-hash',
    },
  }
}

describe('createVersion', () => {
  it('blocks stale, dirty, or structurally invalid YAML before invoking native Git', async () => {
    const native = { gitCreatePairVersion: vi.fn() }

    const result = await createVersion(native, {
      root: '/repo',
      pair: { ...pair(), definition: { ...pair().definition, revision: 8 } },
      analysis: { structurallyValid: true, definitionRevision: 7, companionRevision: 3 },
      message: 'version',
      authorizationToken: 'preview-token',
    })

    expect(result).toEqual({ status: 'blocked', reason: 'pair_not_saved_current_valid' })
    expect(native.gitCreatePairVersion).not.toHaveBeenCalled()
  })

  it('passes exact saved pair paths and a trimmed required message', async () => {
    const native = {
      gitCreatePairVersion: vi.fn(async () => ({ oid: 'a'.repeat(40), status: { entries: [] } })),
    }

    const result = await createVersion(native, {
      root: '/repo',
      pair: pair(),
      analysis: { structurallyValid: true, definitionRevision: 7, companionRevision: 3 },
      message: '  Pair version  ',
      authorizationToken: 'preview-token',
    })

    expect(result.status).toBe('created')
    expect(native.gitCreatePairVersion).toHaveBeenCalledWith(
      '/repo',
      'flow.yaml',
      'flow.hermes.yaml',
      'Pair version',
      'preview-token',
    )
  })
})

describe('loadHistoricalPairAsDraft', () => {
  it('applies existing historical blobs as grouped unsaved replace-document transactions', async () => {
    const current = pair()
    const applied: string[] = []

    const result = await loadHistoricalPairAsDraft({
      pair: current,
      snapshot: {
        oid: 'a'.repeat(40),
        definition: 'name: Historical\n',
        companion: 'profile: historical\n',
      },
      apply: async (workingPair, mutation, group) => {
        applied.push(`${group}:${mutation.document}`)
        const document = mutation.document === 'definition' ? workingPair.definition : workingPair.companion!
        const next = {
          ...workingPair,
          [mutation.document]: {
            ...document,
            text: mutation.text,
            revision: document.revision + 1,
          },
        }
        return { pair: next, transaction: transaction(workingPair, next, mutation) }
      },
    })

    expect(applied).toEqual([
      'restore:a'.repeat(1) + 'a'.repeat(39) + ':definition',
      'restore:' + 'a'.repeat(40) + ':companion',
    ])
    expect(result.pair.definition.text).toBe('name: Historical\n')
    expect(result.pair.companion?.text).toBe('profile: historical\n')
    expect(result.pair.definition.savedRevision).toBe(7)
    expect(result.pair.companion?.savedRevision).toBe(3)
    expect(result.transaction).not.toBeNull()
    expect(result.transaction?.before).toEqual({ definition: 'name: Current\n', companion: 'profile: current\n' })
    expect(result.transaction?.after).toEqual({
      definition: 'name: Historical\n',
      companion: 'profile: historical\n',
    })
  })

  it('records a pair restore as one undoable transaction while saved revisions remain unchanged', async () => {
    const current = pair()
    const restored = await loadHistoricalPairAsDraft({
      pair: current,
      snapshot: {
        oid: 'c'.repeat(40),
        definition: 'name: Historical\n',
        companion: 'profile: historical\n',
      },
      apply: async (workingPair, mutation) => {
        const document = mutation.document === 'definition' ? workingPair.definition : workingPair.companion!
        const next = {
          ...workingPair,
          [mutation.document]: { ...document, text: mutation.text, revision: document.revision + 1 },
        }
        return { pair: next, transaction: transaction(workingPair, next, mutation) }
      },
    })

    expect(restored.transaction).not.toBeNull()
    const history = recordTransaction(createHistoryState(), restored.transaction!)
    expect(history.undo).toHaveLength(1)

    const undone = undoTransaction(history, restored.pair)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.pair.definition.text).toBe(current.definition.text)
    expect(undone.pair.companion?.text).toBe(current.companion?.text)
    expect(undone.pair.definition.savedRevision).toBe(7)
    expect(undone.pair.companion?.savedRevision).toBe(3)

    const redone = redoTransaction(undone.history, undone.pair)
    expect(redone.ok).toBe(true)
    if (!redone.ok) return
    expect(redone.pair.definition.text).toBe('name: Historical\n')
    expect(redone.pair.companion?.text).toBe('profile: historical\n')
    expect(redone.pair.definition.savedRevision).toBe(7)
    expect(redone.pair.companion?.savedRevision).toBe(3)
  })

  it('does not synthesize a missing historical companion', async () => {
    const current = pair()
    const apply = vi.fn(
      async (
        workingPair: WorkflowPairText,
        _mutation: { type: 'replace-document'; document: 'definition' | 'companion'; text: string },
        _group: string,
      ) => {
        void _mutation
        void _group
        return { pair: workingPair, transaction: transaction(workingPair, workingPair, _mutation) }
      },
    )

    await loadHistoricalPairAsDraft({
      pair: current,
      snapshot: { oid: 'b'.repeat(40), definition: 'name: Older\n', companion: null },
      apply,
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[1]).toMatchObject({ type: 'replace-document', document: 'definition' })
  })
})

function transaction(
  before: WorkflowPairText,
  after: WorkflowPairText,
  mutation: Extract<import('$src/lib/yaml/mutations').WorkflowMutation, { type: 'replace-document' }>,
): YamlTransaction {
  return {
    mutation,
    label: `Replace ${mutation.document}`,
    workflowId: before.workflowId,
    pairGeneration: before.generation,
    before: { definition: before.definition.text, companion: before.companion?.text ?? null },
    after: { definition: after.definition.text, companion: after.companion?.text ?? null },
    beforeRevisions: { definition: before.definition.revision, companion: before.companion?.revision ?? null },
    afterRevisions: { definition: after.definition.revision, companion: after.companion?.revision ?? null },
    selection: { document: mutation.document },
  }
}
