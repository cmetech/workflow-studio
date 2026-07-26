import type { WorkflowProfile } from '$src/lib/contract/types'
import type { DocumentAnalysis, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkspaceReadResult } from '$src/lib/native/types'
import type { WorkflowPairEntry, WorkspaceEntry } from '$src/lib/workspace/types'
import type { WorkspaceIntent } from '$src/stores/shell'

export interface CoordinatedWorkspaceActions {
  duplicateWorkflow(input: { definitionPath: string; companionPath: string | null }): Promise<unknown>
  renameWorkflow(input: {
    workspaceId: string
    definitionPath: string
    destinationDefinition: string
  }): Promise<unknown>
  createCompanion(input: {
    definitionPath: string
    profile: WorkflowProfile
    metadata: Readonly<Record<string, unknown>>
  }): Promise<string>
  removeCompanion(input: { companionPath: string; expectedHash: string }): Promise<void>
  exportWorkflow(input: {
    pair: WorkflowPairText
    analysis: DocumentAnalysis | null
    activeRevision: DocumentRevision
    confirmCollision: (paths: readonly string[]) => Promise<boolean>
  }): Promise<unknown>
  trashWorkflow(input: {
    definitionPath: string
    definitionHash: string
    companionPath: string | null
    companionHash: string | null
  }): Promise<void>
}

export interface WorkspaceActionCoordinatorDependencies {
  actions: CoordinatedWorkspaceActions
  getEntry(id: string): WorkspaceEntry | undefined
  getWorkspaceId(): string | null
  read(path: string): Promise<WorkspaceReadResult>
  open(entry: WorkflowPairEntry): Promise<void>
  refresh(): Promise<void>
  promptRename(entry: WorkflowPairEntry): Promise<string | null>
  promptCompanion(entry: WorkflowPairEntry): Promise<{
    profile: WorkflowProfile
    metadata: Readonly<Record<string, unknown>>
  } | null>
  confirm(action: 'remove-companion' | 'trash', paths: readonly string[]): Promise<boolean>
  currentDocument(): {
    pair: WorkflowPairText | null
    analysis: DocumentAnalysis | null
    revision: DocumentRevision | null
  }
  confirmExportCollision(paths: readonly string[]): Promise<boolean>
}

export function createWorkspaceActionCoordinator(dependencies: WorkspaceActionCoordinatorDependencies) {
  return async (intent: WorkspaceIntent): Promise<void> => {
    if (!intent.kind?.startsWith('workflow.') || !intent.targetEntryId) return
    const candidate = dependencies.getEntry(intent.targetEntryId)
    if (!candidate || candidate.kind !== 'workflow') return
    const entry = candidate

    switch (intent.kind) {
      case 'workflow.open':
        await dependencies.open(entry)
        break
      case 'workflow.duplicate':
        await dependencies.actions.duplicateWorkflow(entry)
        await dependencies.refresh()
        break
      case 'workflow.rename': {
        const workspaceId = dependencies.getWorkspaceId()
        const destinationDefinition = await dependencies.promptRename(entry)
        if (!workspaceId || !destinationDefinition) return
        await dependencies.actions.renameWorkflow({
          workspaceId,
          definitionPath: entry.definitionPath,
          destinationDefinition,
        })
        await dependencies.refresh()
        break
      }
      case 'workflow.create-companion': {
        const companion = await dependencies.promptCompanion(entry)
        if (!companion) return
        await dependencies.actions.createCompanion({ definitionPath: entry.definitionPath, ...companion })
        await dependencies.refresh()
        break
      }
      case 'workflow.remove-companion': {
        if (!entry.companionPath || !(await dependencies.confirm('remove-companion', [entry.companionPath]))) return
        const companion = await dependencies.read(entry.companionPath)
        await dependencies.actions.removeCompanion({
          companionPath: entry.companionPath,
          expectedHash: companion.sha256,
        })
        await dependencies.refresh()
        break
      }
      case 'workflow.export': {
        await dependencies.open(entry)
        const document = dependencies.currentDocument()
        if (!document.pair || !document.revision) return
        await dependencies.actions.exportWorkflow({
          pair: document.pair,
          analysis: document.analysis,
          activeRevision: document.revision,
          confirmCollision: dependencies.confirmExportCollision,
        })
        break
      }
      case 'workflow.trash': {
        const paths = [entry.definitionPath, ...(entry.companionPath ? [entry.companionPath] : [])]
        if (!(await dependencies.confirm('trash', paths))) return
        const [definition, companion] = await Promise.all([
          dependencies.read(entry.definitionPath),
          entry.companionPath ? dependencies.read(entry.companionPath) : Promise.resolve(null),
        ])
        await dependencies.actions.trashWorkflow({
          definitionPath: entry.definitionPath,
          definitionHash: definition.sha256,
          companionPath: entry.companionPath,
          companionHash: companion?.sha256 ?? null,
        })
        await dependencies.refresh()
        break
      }
    }
  }
}
