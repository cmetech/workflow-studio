import type { WorkflowProfile } from '$src/lib/contract/types'
import type { DocumentAnalysis, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkspaceReadResult } from '$src/lib/native/types'
import type { WorkflowPairEntry, WorkspaceEntry } from '$src/lib/workspace/types'
import type { WorkspaceIntent } from '$src/stores/shell'

export interface WorkspaceOutcomePathResult {
  readonly path?: string
  readonly relativePath?: string
  readonly status?: string
  readonly message?: string
}

export function formatWorkspaceOutcomeResults(results: readonly WorkspaceOutcomePathResult[]): string {
  return results
    .map(
      ({ path, relativePath, status, message }) =>
        `${path ?? relativePath ?? 'unknown path'}: ${status ?? 'failed'}${message ? ` — ${message}` : ''}`,
    )
    .join('\n')
}

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
    workflowId: string
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
  presentOutcome?(action: WorkspaceIntent['kind'], outcome: unknown): void
}

export class WorkspaceActionCoordinatorError extends Error {
  constructor(
    readonly code: 'workspace_document_identity_mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceActionCoordinatorError'
  }
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
      case 'workflow.duplicate': {
        const outcome = await dependencies.actions.duplicateWorkflow(entry)
        dependencies.presentOutcome?.(intent.kind, outcome)
        await dependencies.refresh()
        break
      }
      case 'workflow.rename': {
        const workspaceId = dependencies.getWorkspaceId()
        const destinationDefinition = await dependencies.promptRename(entry)
        if (!workspaceId || !destinationDefinition) return
        const outcome = await dependencies.actions.renameWorkflow({
          workspaceId,
          definitionPath: entry.definitionPath,
          destinationDefinition,
        })
        dependencies.presentOutcome?.(intent.kind, outcome)
        await dependencies.refresh()
        break
      }
      case 'workflow.create-companion': {
        const companion = await dependencies.promptCompanion(entry)
        if (!companion) return
        const outcome = await dependencies.actions.createCompanion({
          definitionPath: entry.definitionPath,
          ...companion,
        })
        dependencies.presentOutcome?.(intent.kind, outcome)
        await dependencies.refresh()
        break
      }
      case 'workflow.remove-companion': {
        if (!entry.companionPath || !(await dependencies.confirm('remove-companion', [entry.companionPath]))) return
        const companion = await dependencies.read(entry.companionPath)
        const outcome = await dependencies.actions.removeCompanion({
          companionPath: entry.companionPath,
          expectedHash: companion.sha256,
        })
        dependencies.presentOutcome?.(intent.kind, outcome)
        await dependencies.refresh()
        break
      }
      case 'workflow.export': {
        let document = dependencies.currentDocument()
        const activePair = document.pair
        const entryIsActive = Boolean(
          activePair &&
          activePair.workflowId === entry.id &&
          activePair.definition.path === entry.definitionPath &&
          (activePair.companion?.path ?? null) === entry.companionPath,
        )
        if (!entryIsActive) {
          await dependencies.open(entry)
          document = dependencies.currentDocument()
        }
        if (!document.pair || !document.revision) {
          throw new WorkspaceActionCoordinatorError(
            'workspace_document_identity_mismatch',
            'Opening the selected workflow did not produce an exportable document session.',
          )
        }
        if (
          document.pair.workflowId !== entry.id ||
          document.pair.definition.path !== entry.definitionPath ||
          (document.pair.companion?.path ?? null) !== entry.companionPath
        ) {
          throw new WorkspaceActionCoordinatorError(
            'workspace_document_identity_mismatch',
            'The opened document does not match the exact workflow selected for export.',
          )
        }
        const outcome = await dependencies.actions.exportWorkflow({
          pair: document.pair,
          analysis: document.analysis,
          activeRevision: document.revision,
          confirmCollision: dependencies.confirmExportCollision,
        })
        dependencies.presentOutcome?.(intent.kind, outcome)
        break
      }
      case 'workflow.trash': {
        const paths = [entry.definitionPath, ...(entry.companionPath ? [entry.companionPath] : [])]
        if (!(await dependencies.confirm('trash', paths))) return
        const [definition, companion] = await Promise.all([
          dependencies.read(entry.definitionPath),
          entry.companionPath ? dependencies.read(entry.companionPath) : Promise.resolve(null),
        ])
        const outcome = await dependencies.actions.trashWorkflow({
          workflowId: entry.id,
          definitionPath: entry.definitionPath,
          definitionHash: definition.sha256,
          companionPath: entry.companionPath,
          companionHash: companion?.sha256 ?? null,
        })
        dependencies.presentOutcome?.(intent.kind, outcome)
        await dependencies.refresh()
        break
      }
    }
  }
}
