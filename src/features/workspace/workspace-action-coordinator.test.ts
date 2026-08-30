import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import {
  createWorkspaceActionCoordinator,
  formatWorkspaceOutcomeResults,
  type CoordinatedWorkspaceActions,
} from './workspace-action-coordinator'

const entry: WorkflowPairEntry = {
  kind: 'workflow',
  id: 'workspace:flow.yaml',
  name: 'Flow',
  relativePath: 'flow.yaml',
  definitionPath: 'flow.yaml',
  companionPath: 'flow.hermes.yaml',
  state: 'paired',
  readOnly: false,
}

describe('workspace action coordinator', () => {
  it('dispatches every registered workflow intent to the exact targeted pair and refreshes mutations', async () => {
    const actions = {
      duplicateWorkflow: vi.fn(async () => undefined),
      renameWorkflow: vi.fn(async () => undefined),
      createCompanion: vi.fn(async () => 'flow.hermes.yaml'),
      removeCompanion: vi.fn(async () => undefined),
      exportWorkflow: vi.fn(async () => undefined),
      trashWorkflow: vi.fn(async () => undefined),
    } satisfies CoordinatedWorkspaceActions
    const open = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => undefined)
    const revision = {
      workflowId: entry.id,
      pairGeneration: 0,
      definitionPath: 'flow.yaml',
      companionPath: 'flow.hermes.yaml',
      definitionRevision: 0,
      companionRevision: 0,
      contractDigest: `sha256:${'1'.repeat(64)}` as const,
    }
    const pair = {
      workflowId: entry.id,
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'd',
        kind: 'definition' as const,
        path: 'flow.yaml',
        text: 'name: Flow\n',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: {
        id: 'c',
        kind: 'companion' as const,
        path: 'flow.hermes.yaml',
        text: 'language_compatibility: hermes-legacy\n',
        revision: 0,
        savedRevision: 0,
        diskHash: 'b'.repeat(64),
      },
    }
    const coordinate = createWorkspaceActionCoordinator({
      actions,
      getEntry: (id) => (id === entry.id ? entry : undefined),
      getWorkspaceId: () => 'workspace',
      read: async (path) => ({
        relativePath: path,
        text: '',
        sha256: path.startsWith('flow.') ? 'a'.repeat(64) : 'b'.repeat(64),
        size: 0,
        modifiedAt: '0',
        readOnly: false,
      }),
      open,
      refresh,
      promptRename: async () => 'renamed.yaml',
      promptCompanion: async () => ({ profile: 'hermes-legacy', metadata: {} }),
      confirm: async () => true,
      currentDocument: () => ({ pair, analysis: { ...revision, issues: [], structurallyValid: true }, revision }),
      confirmExportCollision: async () => true,
    })

    for (const kind of [
      'workflow.open',
      'workflow.duplicate',
      'workflow.rename',
      'workflow.create-companion',
      'workflow.remove-companion',
      'workflow.export',
      'workflow.trash',
    ] as const) {
      await coordinate({ kind, revision: 1, targetEntryId: entry.id })
    }

    expect(open).toHaveBeenCalledWith(entry)
    expect(actions.duplicateWorkflow).toHaveBeenCalledWith(entry)
    expect(actions.renameWorkflow).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flow.yaml' }))
    expect(actions.createCompanion).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flow.yaml' }))
    expect(actions.removeCompanion).toHaveBeenCalledWith({
      companionPath: 'flow.hermes.yaml',
      expectedHash: 'a'.repeat(64),
    })
    expect(actions.exportWorkflow).toHaveBeenCalledWith(expect.objectContaining({ pair, activeRevision: revision }))
    expect(actions.trashWorkflow).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flow.yaml' }))
    expect(refresh).toHaveBeenCalledTimes(5)
  })

  it('ignores an intent whose target identity is stale', async () => {
    const duplicateWorkflow = vi.fn(async () => undefined)
    const coordinate = createWorkspaceActionCoordinator({
      actions: {
        duplicateWorkflow,
        renameWorkflow: vi.fn(),
        createCompanion: vi.fn(),
        removeCompanion: vi.fn(),
        exportWorkflow: vi.fn(),
        trashWorkflow: vi.fn(),
      },
      getEntry: () => undefined,
      getWorkspaceId: () => 'workspace',
      read: vi.fn(),
      open: vi.fn(),
      refresh: vi.fn(),
      promptRename: vi.fn(),
      promptCompanion: vi.fn(),
      confirm: vi.fn(),
      currentDocument: () => ({ pair: null, analysis: null, revision: null }),
      confirmExportCollision: vi.fn(),
    })

    await coordinate({ kind: 'workflow.duplicate', revision: 1, targetEntryId: 'missing' })
    expect(duplicateWorkflow).not.toHaveBeenCalled()
  })

  it('exports an already active exact pair without reopening and invalidating its analysis', async () => {
    const open = vi.fn(async () => undefined)
    const exportWorkflow = vi.fn(async () => ({ status: 'exported' as const, paths: [], results: [] }))
    const pair = {
      workflowId: entry.id,
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'active-definition',
        kind: 'definition' as const,
        path: entry.definitionPath,
        text: 'name: Flow\n',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: {
        id: 'active-companion',
        kind: 'companion' as const,
        path: entry.companionPath!,
        text: 'language_compatibility: hermes-legacy\n',
        revision: 0,
        savedRevision: 0,
        diskHash: 'b'.repeat(64),
      },
    }
    const revision = {
      workflowId: entry.id,
      pairGeneration: 0,
      definitionPath: entry.definitionPath,
      companionPath: entry.companionPath,
      definitionRevision: 0,
      companionRevision: 0,
      contractDigest: `sha256:${'1'.repeat(64)}` as const,
    }
    const analysis = { ...revision, issues: [], structurallyValid: true }
    const coordinate = createWorkspaceActionCoordinator({
      actions: {
        duplicateWorkflow: vi.fn(),
        renameWorkflow: vi.fn(),
        createCompanion: vi.fn(),
        removeCompanion: vi.fn(),
        exportWorkflow,
        trashWorkflow: vi.fn(),
      },
      getEntry: () => entry,
      getWorkspaceId: () => 'workspace',
      read: vi.fn(),
      open,
      refresh: vi.fn(),
      promptRename: vi.fn(),
      promptCompanion: vi.fn(),
      confirm: vi.fn(),
      currentDocument: () => ({ pair, analysis, revision }),
      confirmExportCollision: vi.fn(async () => true),
    })

    await coordinate({ kind: 'workflow.export', revision: 1, targetEntryId: entry.id })

    expect(open).not.toHaveBeenCalled()
    expect(exportWorkflow).toHaveBeenCalledWith(expect.objectContaining({ pair, analysis, activeRevision: revision }))
  })

  it('rejects export when awaited open did not replace a previously active document with the target pair', async () => {
    const exportWorkflow = vi.fn(async () => undefined)
    const priorPair = {
      workflowId: 'workspace:prior.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'prior',
        kind: 'definition' as const,
        path: 'prior.yaml',
        text: 'name: Prior\n',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    }
    const coordinate = createWorkspaceActionCoordinator({
      actions: {
        duplicateWorkflow: vi.fn(),
        renameWorkflow: vi.fn(),
        createCompanion: vi.fn(),
        removeCompanion: vi.fn(),
        exportWorkflow,
        trashWorkflow: vi.fn(),
      },
      getEntry: () => entry,
      getWorkspaceId: () => 'workspace',
      read: vi.fn(),
      open: vi.fn(async () => undefined),
      refresh: vi.fn(),
      promptRename: vi.fn(),
      promptCompanion: vi.fn(),
      confirm: vi.fn(),
      currentDocument: () => ({
        pair: priorPair,
        analysis: null,
        revision: {
          workflowId: priorPair.workflowId,
          pairGeneration: 0,
          definitionPath: priorPair.definition.path,
          companionPath: null,
          definitionRevision: 0,
          companionRevision: null,
          contractDigest: `sha256:${'1'.repeat(64)}`,
        },
      }),
      confirmExportCollision: vi.fn(),
    })

    await expect(coordinate({ kind: 'workflow.export', revision: 1, targetEntryId: entry.id })).rejects.toMatchObject({
      code: 'workspace_document_identity_mismatch',
    })
    expect(exportWorkflow).not.toHaveBeenCalled()
  })

  it('propagates explicit contract-unavailable open failure and never exports the prior document', async () => {
    const exportWorkflow = vi.fn(async () => undefined)
    const openError = Object.assign(new Error('No contract'), { code: 'contract_unavailable' })
    const coordinate = createWorkspaceActionCoordinator({
      actions: {
        duplicateWorkflow: vi.fn(),
        renameWorkflow: vi.fn(),
        createCompanion: vi.fn(),
        removeCompanion: vi.fn(),
        exportWorkflow,
        trashWorkflow: vi.fn(),
      },
      getEntry: () => entry,
      getWorkspaceId: () => 'workspace',
      read: vi.fn(),
      open: vi.fn(async () => Promise.reject(openError)),
      refresh: vi.fn(),
      promptRename: vi.fn(),
      promptCompanion: vi.fn(),
      confirm: vi.fn(),
      currentDocument: () => ({ pair: null, analysis: null, revision: null }),
      confirmExportCollision: vi.fn(),
    })

    await expect(coordinate({ kind: 'workflow.export', revision: 1, targetEntryId: entry.id })).rejects.toBe(openError)
    expect(exportWorkflow).not.toHaveBeenCalled()
  })

  it('surfaces structured partial outcomes to the UI presenter', async () => {
    const partial = { status: 'partial', results: [{ path: 'flow-copy.yaml', status: 'failed' }] }
    const presentOutcome = vi.fn()
    const coordinate = createWorkspaceActionCoordinator({
      actions: {
        duplicateWorkflow: vi.fn(async () => partial),
        renameWorkflow: vi.fn(),
        createCompanion: vi.fn(),
        removeCompanion: vi.fn(),
        exportWorkflow: vi.fn(),
        trashWorkflow: vi.fn(),
      },
      getEntry: () => entry,
      getWorkspaceId: () => 'workspace',
      read: vi.fn(),
      open: vi.fn(),
      refresh: vi.fn(),
      promptRename: vi.fn(),
      promptCompanion: vi.fn(),
      confirm: vi.fn(),
      currentDocument: () => ({ pair: null, analysis: null, revision: null }),
      confirmExportCollision: vi.fn(),
      presentOutcome,
    })

    await coordinate({ kind: 'workflow.duplicate', revision: 1, targetEntryId: entry.id })
    expect(presentOutcome).toHaveBeenCalledWith('workflow.duplicate', partial)
  })

  it('formats native relative paths in partial rename feedback', () => {
    expect(
      formatWorkspaceOutcomeResults([
        { relativePath: 'archive/renamed.yaml', status: 'partial', message: 'layout flush failed' },
      ]),
    ).toBe('archive/renamed.yaml: partial — layout flush failed')
  })
})
