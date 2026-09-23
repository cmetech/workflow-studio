import { describe, it, expect, vi } from 'vitest'
import { commitResourcePlan } from './resource-action-coordinator'
import type { ResourceCreationPlan } from '$src/lib/packages/resource-actions'
import type { WorkflowPairText } from '$src/lib/documents/types'
const pair = {
  workflowId: 'work',
  generation: 1,
  savedGeneration: 1,
  definition: { path: 'pkg/main.yaml', text: 'old', revision: 1, savedRevision: 1, diskHash: 'before' },
  companion: null,
} as WorkflowPairText
const nextPair = { ...pair, definition: { ...pair.definition, text: 'new', revision: 2 } }
const plan = {
  nextPair,
  expectedRevision: {
    workflowId: 'work',
    pairGeneration: 1,
    definitionPath: 'pkg/main.yaml',
    companionPath: null,
    definitionRevision: 1,
    companionRevision: null,
    contractDigest: 'c',
  },
  nativePlan: { workspaceId: 'w', expectedEntries: [], writes: [], moves: [], trashes: [] },
  transaction: {},
} as unknown as ResourceCreationPlan
it('commits exact planned bytes before publishing one saved semantic transaction', async () => {
  const publish = vi.fn()
  const apply = vi.fn(async () => ({ status: 'committed' as const, results: [] }))
  await commitResourcePlan(plan, { current: () => pair, workspaceId: () => 'w', apply, publish })
  expect(apply).toHaveBeenCalledWith(plan.nativePlan)
  expect(publish).toHaveBeenCalledOnce()
  const saved = publish.mock.calls[0]![0] as WorkflowPairText
  expect(saved.definition.savedRevision).toBe(2)
  expect(saved.definition.diskHash).toMatch(/^[a-f0-9]{64}$/)
  expect(saved.definition.text).toBe('new')
})
describe('stale resource authorization', () => {
  it('rejects edits before writing', async () => {
    const apply = vi.fn()
    const publish = vi.fn()
    await expect(
      commitResourcePlan(plan, { current: () => nextPair, workspaceId: () => 'w', apply, publish }),
    ).rejects.toThrow('changed')
    expect(apply).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
  it('keeps newer drafts when an edit arrives during native commit', async () => {
    let current = pair
    const publish = vi.fn()
    await expect(
      commitResourcePlan(plan, {
        current: () => current,
        workspaceId: () => 'w',
        apply: async () => {
          current = nextPair
          return { status: 'committed', results: [] }
        },
        publish,
      }),
    ).rejects.toThrow('committed')
    expect(publish).not.toHaveBeenCalled()
  })
  it('does not publish failed writes', async () => {
    const publish = vi.fn()
    await expect(
      commitResourcePlan(plan, {
        current: () => pair,
        workspaceId: () => 'w',
        apply: async () => {
          throw Error('conflict')
        },
        publish,
      }),
    ).rejects.toThrow('conflict')
    expect(publish).not.toHaveBeenCalled()
  })
})
