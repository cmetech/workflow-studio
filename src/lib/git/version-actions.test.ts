import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import { createHistoryState, recordTransaction, redoTransaction, undoTransaction } from '$src/stores/history'
import { createVersion, loadHistoricalPairAsDraft, refreshAfterVersion } from './version-actions'

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
      gitCreatePairVersion: vi.fn(async () => ({
        outcome: 'committed' as const,
        oid: 'a'.repeat(40),
        status: { entries: [] },
        warnings: [],
      })),
    }

    const result = await createVersion(native, {
      root: '/repo',
      pair: pair(),
      analysis: { structurallyValid: true, definitionRevision: 7, companionRevision: 3 },
      message: '  Pair version  ',
      authorizationToken: 'preview-token',
    })

    expect(result).toEqual({ status: 'committed', oid: 'a'.repeat(40), warnings: [] })
    expect(native.gitCreatePairVersion).toHaveBeenCalledWith(
      '/repo',
      'flow.yaml',
      'flow.hermes.yaml',
      'Pair version',
      'preview-token',
    )
  })

  it('preserves committed warnings and distinct unknown outcomes without retrying native Git', async () => {
    const committedNative = {
      gitCreatePairVersion: vi.fn(async () => ({
        outcome: 'committed' as const,
        oid: 'b'.repeat(40),
        status: null,
        warnings: ['Status refresh failed'],
      })),
    }
    const input = {
      root: '/repo',
      pair: pair(),
      analysis: { structurallyValid: true, definitionRevision: 7, companionRevision: 3 },
      message: 'Version',
      authorizationToken: 'preview-token',
    }

    await expect(createVersion(committedNative, input)).resolves.toEqual({
      status: 'committed',
      oid: 'b'.repeat(40),
      warnings: ['Status refresh failed'],
    })

    const unknownNative = {
      gitCreatePairVersion: vi.fn(async () => ({
        outcome: 'unknown' as const,
        candidateOid: 'c'.repeat(40),
        code: 'git_commit_outcome_unknown' as const,
        message: 'Inspect repository before retrying.',
      })),
    }
    await expect(createVersion(unknownNative, input)).resolves.toEqual({
      status: 'unknown',
      code: 'git_commit_outcome_unknown',
      message: 'Inspect repository before retrying.',
    })
    expect(unknownNative.gitCreatePairVersion).toHaveBeenCalledOnce()
  })

  it('never refreshes an unknown outcome and converts committed refresh failure to a warning', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('refresh unavailable')
    })
    const committed = await refreshAfterVersion(
      { status: 'committed', oid: 'd'.repeat(40), warnings: ['post hook warning'] },
      refresh,
    )
    expect(committed).toEqual({
      status: 'committed',
      oid: 'd'.repeat(40),
      warnings: [
        'post hook warning',
        'The version was committed, but the Git view could not be refreshed: refresh unavailable',
      ],
    })

    refresh.mockClear()
    const unknown = {
      status: 'unknown' as const,
      code: 'git_commit_outcome_unknown' as const,
      message: 'Inspect repository before retrying.',
    }
    await expect(refreshAfterVersion(unknown, refresh)).resolves.toBe(unknown)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('bounds renderer refresh diagnostics after a committed outcome', async () => {
    const result = await refreshAfterVersion({ status: 'committed', oid: 'e'.repeat(40), warnings: [] }, async () => {
      throw new Error('x'.repeat(8_192))
    })

    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.length).toBeLessThanOrEqual(4_097)
    expect(result.warnings[0]).toMatch(/…$/)
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
