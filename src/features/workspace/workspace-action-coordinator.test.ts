import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import { createWorkspaceActionCoordinator, type CoordinatedWorkspaceActions } from './workspace-action-coordinator'

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
})
