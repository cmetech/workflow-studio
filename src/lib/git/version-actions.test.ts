import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPairText } from '$src/lib/documents/types'
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
    })

    expect(result.status).toBe('created')
    expect(native.gitCreatePairVersion).toHaveBeenCalledWith('/repo', 'flow.yaml', 'flow.hermes.yaml', 'Pair version')
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
        return {
          ...workingPair,
          [mutation.document]: {
            ...document,
            text: mutation.text,
            revision: document.revision + 1,
          },
        }
      },
    })

    expect(applied).toEqual([
      'restore:a'.repeat(1) + 'a'.repeat(39) + ':definition',
      'restore:' + 'a'.repeat(40) + ':companion',
    ])
    expect(result.definition.text).toBe('name: Historical\n')
    expect(result.companion?.text).toBe('profile: historical\n')
    expect(result.definition.savedRevision).toBe(7)
    expect(result.companion?.savedRevision).toBe(3)
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
        return workingPair
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
