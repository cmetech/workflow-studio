import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContractDigest, DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import { editDocumentText, removeCompanion, setCompanion } from '$src/lib/documents/revisions'
import { createHistoryState } from '$src/stores/history'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  updateDocumentSession,
} from '$src/stores/documents'
import {
  handleExternalChange,
  openWorkflowPair,
  resolveExternalChange,
  saveWorkflowPair,
  type DocumentActionNative,
} from './document-actions'
import type { WorkspaceTrashRequest } from '$src/lib/native/types'

const digest = `sha256:${'a'.repeat(64)}` as ContractDigest

function pair(overrides: Partial<WorkflowPairText> = {}): WorkflowPairText {
  return {
    workflowId: 'workflow:workspace:flows/release.yaml',
    generation: 0,
    savedGeneration: 0,
    definition: {
      id: 'definition:release',
      kind: 'definition',
      path: 'flows/release.yaml',
      text: 'id: release\ntasks: {}\n',
      revision: 2,
      savedRevision: 1,
      diskHash: 'definition-old',
    },
    companion: {
      id: 'companion:release',
      kind: 'companion',
      path: 'flows/release.hermes.yaml',
      text: 'language_compatibility: hermes-legacy\n',
      revision: 3,
      savedRevision: 2,
      diskHash: 'companion-old',
    },
    ...overrides,
  }
}

function analysis(current: WorkflowPairText, issues: DocumentAnalysis['issues'] = []): DocumentAnalysis {
  return {
    workflowId: current.workflowId,
    pairGeneration: current.generation,
    definitionRevision: current.definition.revision,
    companionRevision: current.companion?.revision ?? null,
    contractDigest: digest,
    structurallyValid: !issues.some((issue) => issue.blocking),
    issues,
  }
}

function native(): DocumentActionNative {
  return {
    workspaceRead: vi.fn(async (relativePath: string) => ({
      relativePath,
      text: relativePath.endsWith('.hermes.yaml')
        ? 'language_compatibility: hermes-legacy\n'
        : 'id: release\ntasks: {}\n',
      sha256: `${relativePath}-hash`,
      size: 20,
      modifiedAt: '2026-07-25T12:00:00.000Z',
      readOnly: false,
    })),
    workspaceWrite: vi.fn(async ({ relativePath, text }) => ({
      relativePath,
      sha256: `${relativePath}:${text.length}`,
      size: text.length,
      modifiedAt: '2026-07-25T12:01:00.000Z',
    })),
    workspaceTrashPaths: vi.fn(async (requests: readonly WorkspaceTrashRequest[]) => ({
      results: requests.map(({ relativePath }) => ({ relativePath, status: 'trashed' as const })),
    })),
  }
}

describe('document actions', () => {
  afterEach(() => closeDocumentSession())

  it('opens both files at revision zero, clean, and schedules immediate analysis', async () => {
    const host = native()
    const scheduleAnalysis = vi.fn()

    const opened = await openWorkflowPair({
      workflowId: 'workflow:workspace:flows/release.yaml',
      definitionPath: 'flows/release.yaml',
      companionPath: 'flows/release.hermes.yaml',
      contractDigest: digest,
      native: host,
      scheduleAnalysis,
    })

    expect(opened.definition).toMatchObject({ revision: 0, savedRevision: 0, diskHash: 'flows/release.yaml-hash' })
    expect(opened).toMatchObject({ generation: 0, savedGeneration: 0 })
    expect(opened.companion).toMatchObject({
      revision: 0,
      savedRevision: 0,
      diskHash: 'flows/release.hermes.yaml-hash',
    })
    expect(scheduleAnalysis).toHaveBeenCalledWith(opened, 'open')
  })

  it.each(['syntax', 'contract', 'semantic'] as const)('blocks save for a blocking %s issue', async (layer) => {
    const current = pair()
    const host = native()
    const result = await saveWorkflowPair({
      pair: current,
      analysis: analysis(current, [
        {
          code: `${layer}_broken`,
          layer,
          severity: 'error',
          blocking: true,
          message: 'Broken',
          document: 'definition',
        },
      ]),
      native: host,
    })

    expect(result.status).toBe('blocked')
    expect(host.workspaceWrite).not.toHaveBeenCalled()
  })

  it.each(['compatibility', 'operational'] as const)(
    'allows save with %s advisories and expected hashes',
    async (layer) => {
      const current = pair()
      const host = native()
      const result = await saveWorkflowPair({
        pair: current,
        analysis: analysis(current, [
          {
            code: `${layer}_warning`,
            layer,
            severity: 'warning',
            blocking: false,
            message: 'Advisory',
            document: 'definition',
          },
        ]),
        native: host,
      })

      expect(result.status).toBe('saved')
      expect(host.workspaceWrite).toHaveBeenNthCalledWith(1, {
        relativePath: 'flows/release.yaml',
        text: current.definition.text,
        expectedCurrentHash: 'definition-old',
      })
      expect(host.workspaceWrite).toHaveBeenNthCalledWith(2, {
        relativePath: 'flows/release.hermes.yaml',
        text: current.companion?.text,
        expectedCurrentHash: 'companion-old',
      })
      expect(result.pair.definition.savedRevision).toBe(2)
      expect(result.pair.companion?.savedRevision).toBe(3)
    },
  )

  it('keeps exact text and only the successful saved revision when the companion write fails', async () => {
    const current = pair()
    const host = native()
    vi.mocked(host.workspaceWrite)
      .mockResolvedValueOnce({
        relativePath: current.definition.path,
        sha256: 'definition-new',
        size: current.definition.text.length,
        modifiedAt: '2026-07-25T12:01:00.000Z',
      })
      .mockRejectedValueOnce(new Error('disk full'))
    const keepRecovery = vi.fn(async () => undefined)

    const result = await saveWorkflowPair({
      pair: current,
      analysis: analysis(current),
      native: host,
      keepRecovery,
      now: () => '2026-07-25T12:02:00.000Z',
    })

    expect(result.status).toBe('partial')
    if (result.status === 'blocked') return
    expect(result.pair.definition).toMatchObject({
      text: current.definition.text,
      savedRevision: 2,
      diskHash: 'definition-new',
    })
    expect(result.pair.companion).toMatchObject({
      text: current.companion?.text,
      savedRevision: 2,
      diskHash: 'companion-old',
    })
    expect(result.results).toMatchObject({ definition: { status: 'saved' }, companion: { status: 'failed' } })
    expect(keepRecovery).toHaveBeenCalledOnce()
  })

  it('creates a new companion when its disk hash is null even at revision zero', async () => {
    const current = pair({
      definition: { ...pair().definition, revision: 1, savedRevision: 1 },
      companion: {
        ...pair().companion!,
        revision: 0,
        savedRevision: 0,
        diskHash: null,
      },
    })
    const host = native()

    const result = await saveWorkflowPair({ pair: current, analysis: analysis(current), native: host })

    expect(result.status).toBe('saved')
    expect(host.workspaceWrite).toHaveBeenCalledOnce()
    expect(host.workspaceWrite).toHaveBeenCalledWith({
      relativePath: 'flows/release.hermes.yaml',
      text: current.companion?.text,
      expectedCurrentHash: null,
    })
  })

  it('never replaces a newer in-memory edit when an older save finishes', async () => {
    const current = pair({ companion: null })
    openDocumentSession(current, digest)
    const newer = editDocumentText(current, 'definition', 'id: newer\ntasks: {}\n')
    const host = native()
    vi.mocked(host.workspaceWrite).mockImplementationOnce(async ({ relativePath, text }) => {
      updateDocumentSession(newer, digest)
      return {
        relativePath,
        sha256: 'saved-snapshot-hash',
        size: text.length,
        modifiedAt: '2026-07-25T12:01:00.000Z',
      }
    })

    const keepRecovery = vi.fn(async () => undefined)
    const discardRecovery = vi.fn(async () => undefined)
    const result = await saveWorkflowPair({
      pair: current,
      analysis: analysis(current),
      native: host,
      keepRecovery,
      discardRecovery,
    })

    expect(result.pair.definition.text).toBe(newer.definition.text)
    expect($documentSession.get().pair?.definition).toMatchObject({
      text: newer.definition.text,
      revision: newer.definition.revision,
      savedRevision: current.definition.revision,
      diskHash: 'saved-snapshot-hash',
    })
    expect(discardRecovery).not.toHaveBeenCalled()
    expect(keepRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ definition: expect.objectContaining({ text: newer.definition.text }) }),
    )
  })

  it('returns a concurrently changed pair generation as authoritative and recovery-backed', async () => {
    const current = pair()
    openDocumentSession(current, digest)
    const changedGeneration = removeCompanion(current)
    const host = native()
    vi.mocked(host.workspaceWrite).mockImplementationOnce(async ({ relativePath, text }) => {
      updateDocumentSession(changedGeneration, digest)
      return {
        relativePath,
        sha256: 'saved-definition-hash',
        size: text.length,
        modifiedAt: '2026-07-25T12:01:00.000Z',
      }
    })
    const keepRecovery = vi.fn(async () => undefined)

    const result = await saveWorkflowPair({
      pair: current,
      analysis: analysis(current),
      native: host,
      keepRecovery,
    })

    expect(result.pair).toMatchObject({
      generation: changedGeneration.generation,
      companion: null,
      definition: { text: current.definition.text, diskHash: 'saved-definition-hash' },
    })
    expect(keepRecovery).toHaveBeenCalledOnce()
  })

  it('returns a companion-only concurrent addition as dirty and persists recovery', async () => {
    const current = pair({ companion: null })
    openDocumentSession(current, digest)
    const added = setCompanion(current, {
      ...pair().companion!,
      revision: 0,
      savedRevision: 0,
      diskHash: null,
    })
    const host = native()
    vi.mocked(host.workspaceWrite).mockImplementationOnce(async ({ relativePath, text }) => {
      updateDocumentSession(added, digest)
      return {
        relativePath,
        sha256: 'saved-definition-hash',
        size: text.length,
        modifiedAt: '2026-07-25T12:01:00.000Z',
      }
    })
    const keepRecovery = vi.fn(async () => undefined)
    const discardRecovery = vi.fn(async () => undefined)

    const result = await saveWorkflowPair({
      pair: current,
      analysis: analysis(current),
      native: host,
      keepRecovery,
      discardRecovery,
    })

    expect(result.pair).toMatchObject({ generation: added.generation, companion: { diskHash: null } })
    expect(keepRecovery).toHaveBeenCalledOnce()
    expect(discardRecovery).not.toHaveBeenCalled()
  })

  it('uses a bound expected hash for companion deletion and treats failed or partial path results as partial save', async () => {
    const current = pair({
      definition: { ...pair().definition, revision: 1, savedRevision: 1 },
      companion: null,
    })
    const host = native()
    vi.mocked(host.workspaceRead).mockResolvedValueOnce({
      relativePath: 'flows/release.hermes.yaml',
      text: 'language_compatibility: hermes-legacy\n',
      sha256: 'companion-old',
      size: 42,
      modifiedAt: '2026-07-25T13:00:00.000Z',
      readOnly: false,
    })
    vi.mocked(host.workspaceTrashPaths).mockResolvedValueOnce({
      results: [
        {
          relativePath: 'flows/release.hermes.yaml',
          status: 'partial',
          errorCode: 'workspace_trash_partial',
          message: 'OS Trash handoff was incomplete.',
        },
      ],
    })
    const keepRecovery = vi.fn(async () => undefined)

    const result = await saveWorkflowPair({
      pair: current,
      analysis: analysis(current),
      native: host,
      removedCompanion: { path: 'flows/release.hermes.yaml', diskHash: 'companion-old' },
      keepRecovery,
    })

    expect(host.workspaceTrashPaths).toHaveBeenCalledWith([
      { relativePath: 'flows/release.hermes.yaml', expectedCurrentHash: 'companion-old' },
    ])
    expect(result.status).toBe('partial')
    if (result.status === 'blocked') return
    expect(result.results.companion).toMatchObject({
      status: 'failed',
      errorCode: 'workspace_trash_partial',
    })
    expect(keepRecovery).toHaveBeenCalledOnce()
  })

  it('auto-reloads clean external changes and creates a three-choice conflict for dirty text', () => {
    const clean = pair({
      definition: { ...pair().definition, revision: 1, savedRevision: 1 },
    })
    const disk = {
      relativePath: clean.definition.path,
      text: 'id: external\ntasks: {}\n',
      sha256: 'external-hash',
      size: 24,
      modifiedAt: '2026-07-25T13:00:00.000Z',
      readOnly: false,
    }

    const reloaded = handleExternalChange(clean, disk)
    expect(reloaded.status).toBe('reloaded')
    if (reloaded.status === 'reloaded') {
      expect(reloaded.pair.definition).toMatchObject({
        text: disk.text,
        revision: 2,
        savedRevision: 2,
        diskHash: disk.sha256,
      })
      expect(reloaded.pair.savedGeneration).toBe(clean.savedGeneration)
    }

    const dirty = handleExternalChange(pair(), disk)
    expect(dirty.status).toBe('conflict')
    if (dirty.status === 'conflict') expect(dirty.conflict.choices).toEqual(['keep-mine', 'reload-disk', 'compare'])
  })

  it('requires Compare before Keep Mine, keeps Compare non-mutating, and reloads as one history transaction', () => {
    const current = pair()
    const disk = {
      relativePath: current.definition.path,
      text: 'id: external\ntasks: {}\n',
      sha256: 'external-hash',
      size: 24,
      modifiedAt: '2026-07-25T13:00:00.000Z',
      readOnly: false,
    }
    const changed = handleExternalChange(current, disk)
    expect(changed.status).toBe('conflict')
    if (changed.status !== 'conflict') return

    const rejectedKeep = resolveExternalChange(changed.conflict, 'keep-mine', createHistoryState())
    expect(rejectedKeep.status).toBe('diff-required')

    const compared = resolveExternalChange(changed.conflict, 'compare', createHistoryState())
    expect(compared.status).toBe('compare')
    if (compared.status !== 'compare') return
    expect(compared.pair).toBe(current)
    expect(compared.conflict.diffViewed).toBe(true)

    const kept = resolveExternalChange(compared.conflict, 'keep-mine', createHistoryState())
    expect(kept.status).toBe('resolved')
    if (kept.status === 'resolved') expect(kept.pair.definition.diskHash).toBe('external-hash')

    const reloaded = resolveExternalChange(compared.conflict, 'reload-disk', createHistoryState())
    expect(reloaded.status).toBe('resolved')
    if (reloaded.status === 'resolved') {
      expect(reloaded.pair.definition.text).toBe(disk.text)
      expect(reloaded.history.undo).toHaveLength(1)
      expect(reloaded.history.undo[0]?.label).toBe('Reload definition from disk')
    }
  })
})
