import { atom } from 'nanostores'
import type { AuthoringContract } from '$src/lib/contract/types'
import { createDocumentRevision, removeCompanion, setCompanion } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import type {
  UnlistenWorkspace,
  WorkspaceReadResult,
  WorkspaceTrashRequest,
  WorkspaceTrashResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '$src/lib/native/types'
import type { RereadWorkspaceChange } from '$src/lib/native/workspace-api'
import type { LayoutStore } from '$src/lib/layout/layout-store'
import { reconcileLayout } from '$src/lib/layout/place-new-nodes'
import type { LayoutProjection, LayoutRecordV1 } from '$src/lib/layout/types'
import type { RecoveryStore } from '$src/lib/recovery/recovery-store'
import type { RecoveryDraft } from '$src/lib/recovery/types'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import { historyStore } from '$src/stores/history'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
  updateDocumentSession,
} from '$src/stores/documents'
import { $activeLayout, clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import {
  handleExternalChange,
  resolveExternalChange,
  saveWorkflowPair,
  type ExternalChangeChoice,
  type ExternalChangeConflict,
  type SaveWorkflowPairResult,
} from './document-actions'

export interface DocumentAnalysisClient {
  schedule(
    pair: WorkflowPairText,
    contract: AuthoringContract,
    reason: 'edit' | 'open' | 'explicit-validate' | 'contract-change',
  ): unknown
  dispose(): void
}

export interface RecoveryDraftLifecycle {
  changed(pair: WorkflowPairText): void
  close(): Promise<void>
}

export interface LayoutPersistenceLifecycle {
  close(): Promise<void>
}

export interface DocumentWorkspaceControllerDependencies {
  read(path: string): Promise<WorkspaceReadResult>
  write(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>
  trash(requests: readonly WorkspaceTrashRequest[]): Promise<WorkspaceTrashResult>
  createAnalysisClient(
    onAnalysis: (analysis: DocumentAnalysis) => void,
    onError: (message: string) => void,
  ): DocumentAnalysisClient
  watch(handler: (change: RereadWorkspaceChange) => Promise<void>): Promise<UnlistenWorkspace>
  recovery: RecoveryStore
  recoveryDrafts: RecoveryDraftLifecycle
  layout: LayoutStore
  createLayoutPersistence(layout: LayoutRecordV1): LayoutPersistenceLifecycle
}

export interface DocumentWorkspaceState {
  readonly conflict: ExternalChangeConflict | null
  readonly recoveryOffers: readonly RecoveryDraft[]
  readonly saveOutcome: SaveWorkflowPairResult | null
  readonly analysisError: string | null
}

const emptyState: DocumentWorkspaceState = {
  conflict: null,
  recoveryOffers: [],
  saveOutcome: null,
  analysisError: null,
}

export const $documentWorkspace = atom<DocumentWorkspaceState>(emptyState)

export class DocumentWorkspaceController {
  private activationGeneration = 0
  private activeContract: AuthoringContract | null = null
  private activeWorkspaceId: string | null = null
  private unlisten: UnlistenWorkspace | null = null
  private layoutPersistence: LayoutPersistenceLifecycle | null = null
  private readonly analysisClient: DocumentAnalysisClient
  private disposed = false

  constructor(private readonly dependencies: DocumentWorkspaceControllerDependencies) {
    this.analysisClient = dependencies.createAnalysisClient(
      (analysis) => this.receiveAnalysis(analysis),
      (message) => $documentWorkspace.set({ ...$documentWorkspace.get(), analysisError: message }),
    )
  }

  async start(): Promise<void> {
    if (this.unlisten || this.disposed) return
    const unlisten = await this.dependencies.watch((change) => this.handleWorkspaceChange(change))
    if (this.disposed) unlisten()
    else this.unlisten = unlisten
  }

  async activate(
    workspaceId: string,
    entry: WorkflowPairEntry,
    contract: AuthoringContract | null,
  ): Promise<WorkflowPairText | null> {
    const generation = ++this.activationGeneration
    const [definition, companion] = await Promise.all([
      this.dependencies.read(entry.definitionPath),
      entry.companionPath ? this.dependencies.read(entry.companionPath) : Promise.resolve(null),
    ])
    if (generation !== this.activationGeneration || this.disposed) return null

    if ($documentSession.get().pair) await this.dependencies.recoveryDrafts.close()
    await this.flushActiveLayout()
    if (generation !== this.activationGeneration || this.disposed) return null
    const pair = openedPair(entry, definition, companion)
    this.activeContract = contract
    this.activeWorkspaceId = workspaceId
    const contractDigest = contract?.contract_digest ?? UNAVAILABLE_CONTRACT_DIGEST
    openDocumentSession(pair, contractDigest)
    $documentWorkspace.set({ ...emptyState })
    await this.loadActiveLayout(workspaceId, pair)
    await this.loadRecoveryOffers(pair)
    if (generation !== this.activationGeneration || this.disposed) return null
    if (contract) this.analysisClient.schedule(pair, contract, 'open')
    else this.publishContractUnavailable(pair, contractDigest)
    return pair
  }

  changed(pair: WorkflowPairText): void {
    const contract = this.activeContract
    const revision = $documentSession.get().revision
    if (!revision || $documentSession.get().pair?.workflowId !== pair.workflowId) return
    updateDocumentSession(pair, revision.contractDigest)
    this.dependencies.recoveryDrafts.changed(pair)
    if (contract) this.analysisClient.schedule(pair, contract, 'edit')
    else this.publishContractUnavailable(pair, revision.contractDigest)
  }

  async openDraft(workspaceId: string, pair: WorkflowPairText, contract: AuthoringContract | null): Promise<void> {
    const generation = ++this.activationGeneration
    if ($documentSession.get().pair) await this.dependencies.recoveryDrafts.close()
    if (generation !== this.activationGeneration || this.disposed) return
    await this.flushActiveLayout()
    if (generation !== this.activationGeneration || this.disposed) return
    this.activeContract = contract
    this.activeWorkspaceId = workspaceId
    const contractDigest = contract?.contract_digest ?? UNAVAILABLE_CONTRACT_DIGEST
    openDocumentSession(pair, contractDigest)
    $documentWorkspace.set({ ...emptyState })
    await this.loadActiveLayout(workspaceId, pair)
    if (generation !== this.activationGeneration || this.disposed) return
    this.dependencies.recoveryDrafts.changed(pair)
    if (contract) this.analysisClient.schedule(pair, contract, 'open')
    else this.publishContractUnavailable(pair, contractDigest)
  }

  async save(): Promise<SaveWorkflowPairResult | null> {
    const session = $documentSession.get()
    if (!session.pair || !this.activeContract) return null
    const generation = this.activationGeneration
    const workflowId = session.pair.workflowId
    const definitionPath = session.pair.definition.path
    const companionPath = session.pair.companion?.path ?? null
    const outcome = await saveWorkflowPair({
      pair: session.pair,
      analysis: session.analysis,
      native: {
        workspaceRead: this.dependencies.read,
        workspaceWrite: this.dependencies.write,
        workspaceTrashPaths: this.dependencies.trash,
      },
      keepRecovery: (draft) => this.dependencies.recovery.save(draft),
      discardRecovery: (workflowId) => this.dependencies.recovery.discard(workflowId),
    })
    const active = $documentSession.get().pair
    if (
      generation === this.activationGeneration &&
      active?.workflowId === workflowId &&
      active.definition.path === definitionPath &&
      (active.companion?.path ?? null) === companionPath
    ) {
      $documentWorkspace.set({ ...$documentWorkspace.get(), saveOutcome: outcome })
      this.dependencies.recoveryDrafts.changed(active)
    }
    return outcome
  }

  async flushRecovery(pair?: WorkflowPairText): Promise<void> {
    const active = $documentSession.get().pair
    if (pair && active?.workflowId === pair.workflowId) this.dependencies.recoveryDrafts.changed(active)
    await this.dependencies.recoveryDrafts.close()
  }

  async renameActivePair(
    workspaceId: string,
    fromDefinition: string,
    toDefinition: string,
    companionMoved: boolean,
  ): Promise<void> {
    const operationGeneration = this.activationGeneration
    const initialSession = $documentSession.get()
    const initial = initialSession.pair
    const priorWorkflowId = initial?.workflowId
    const contract = this.activeContract
    if (
      !initial ||
      !initialSession.revision ||
      initial.workflowId !== priorWorkflowId ||
      initial.definition.path !== fromDefinition
    ) {
      await this.dependencies.layout.renameWorkflowPath(workspaceId, fromDefinition, toDefinition)
      return
    }
    const workflowId = `workflow:${workspaceId}:${toDefinition}`
    const companionPath = companionMoved ? canonicalCompanionPath(toDefinition) : (initial.companion?.path ?? null)
    const renamed: WorkflowPairText = {
      ...initial,
      workflowId,
      definition: { ...initial.definition, id: `${workflowId}:definition`, path: toDefinition },
      companion: initial.companion
        ? { ...initial.companion, id: `${workflowId}:companion`, path: companionPath ?? initial.companion.path }
        : null,
    }
    openDocumentSession(renamed, initialSession.revision.contractDigest)
    this.dependencies.recoveryDrafts.changed(renamed)
    if (contract) this.analysisClient.schedule(renamed, contract, 'contract-change')
    else this.publishContractUnavailable(renamed, initialSession.revision.contractDigest)

    await this.flushActiveLayout()
    await this.dependencies.layout.renameWorkflowPath(workspaceId, fromDefinition, toDefinition)
    if (operationGeneration !== this.activationGeneration) return
    const layout = $activeLayout.get()
    const active = $documentSession.get().pair
    if (layout && active && samePairIdentity(active, renamed)) {
      const migrated = { ...layout, workflowPath: toDefinition, updatedAt: new Date().toISOString() }
      setActiveLayout(migrated)
      this.layoutPersistence = this.dependencies.createLayoutPersistence(migrated)
    }
    await this.dependencies.recovery.discard(priorWorkflowId)
    const current = $documentSession.get().pair
    if (!current || current.workflowId !== workflowId || current.definition.path !== toDefinition) return
    this.dependencies.recoveryDrafts.changed(current)
  }

  async companionCreated(definitionPath: string, companionPath: string): Promise<void> {
    const session = $documentSession.get()
    const contract = this.activeContract
    const pair = session.pair
    const operationGeneration = this.activationGeneration
    if (!pair || !session.revision || pair.definition.path !== definitionPath || pair.companion) return
    const disk = await this.dependencies.read(companionPath)
    const current = $documentSession.get()
    if (
      operationGeneration !== this.activationGeneration ||
      current.pair?.workflowId !== pair.workflowId ||
      current.pair.definition.path !== definitionPath ||
      current.pair.companion
    )
      return
    const next = setCompanion(current.pair, openedDocument(current.pair.workflowId, 'companion', disk))
    updateDocumentSession(next, current.revision?.contractDigest ?? session.revision.contractDigest)
    this.dependencies.recoveryDrafts.changed(next)
    if (contract) this.analysisClient.schedule(next, contract, 'contract-change')
    else this.publishContractUnavailable(next, session.revision.contractDigest)
  }

  async companionRemoved(companionPath: string): Promise<void> {
    const session = $documentSession.get()
    const contract = this.activeContract
    const pair = session.pair
    if (!pair || !session.revision || pair.companion?.path !== companionPath) return
    const next = removeCompanion(pair)
    updateDocumentSession(next, session.revision.contractDigest)
    this.dependencies.recoveryDrafts.changed(next)
    if (contract) this.analysisClient.schedule(next, contract, 'contract-change')
    else this.publishContractUnavailable(next, session.revision.contractDigest)
  }

  recoverDraft(draft: RecoveryDraft): void {
    const session = $documentSession.get()
    const pair = session.pair
    if (
      !pair ||
      !session.revision ||
      draft.workflowId !== pair.workflowId ||
      draft.definition.path !== pair.definition.path
    )
      return
    const recovered: WorkflowPairText = {
      ...pair,
      generation: Math.max(pair.generation, draft.generation),
      savedGeneration: draft.savedGeneration,
      definition: { ...pair.definition, ...draft.definition },
      companion: draft.companion
        ? {
            id: `${pair.workflowId}:companion`,
            kind: 'companion',
            ...draft.companion,
          }
        : null,
    }
    updateDocumentSession(recovered, session.revision.contractDigest)
    this.dependencies.recoveryDrafts.changed(recovered)
    if (this.activeContract) this.analysisClient.schedule(recovered, this.activeContract, 'edit')
    $documentWorkspace.set({ ...$documentWorkspace.get(), recoveryOffers: [] })
  }

  async discardRecovery(workflowId: string): Promise<void> {
    await this.dependencies.recovery.discard(workflowId)
    $documentWorkspace.set({
      ...$documentWorkspace.get(),
      recoveryOffers: $documentWorkspace.get().recoveryOffers.filter((draft) => draft.workflowId !== workflowId),
    })
  }

  async close(workflowId: string): Promise<void> {
    const pair = $documentSession.get().pair
    if (pair?.workflowId !== workflowId) return
    const definitionPath = pair.definition.path
    const companionPath = pair.companion?.path ?? null
    this.activationGeneration += 1
    await this.flushActiveLayout()
    const active = $documentSession.get().pair
    if (
      active?.workflowId !== workflowId ||
      active.definition.path !== definitionPath ||
      (active.companion?.path ?? null) !== companionPath
    )
      return
    closeDocumentSession()
    clearActiveLayout()
    this.activeContract = null
    this.activeWorkspaceId = null
    $documentWorkspace.set({ ...emptyState })
  }

  async closeWorkspace(): Promise<void> {
    const pair = $documentSession.get().pair
    this.activationGeneration += 1
    await this.dependencies.recoveryDrafts.close()
    await this.flushActiveLayout()
    const active = $documentSession.get().pair
    if ((pair === null && active !== null) || (pair !== null && (active === null || !samePairIdentity(pair, active)))) {
      throw new Error('The active document changed while the workspace was closing.')
    }
    closeDocumentSession()
    clearActiveLayout()
    this.activeContract = null
    this.activeWorkspaceId = null
    $documentWorkspace.set({ ...emptyState })
  }

  resolveConflict(choice: ExternalChangeChoice): void {
    const conflict = $documentWorkspace.get().conflict
    const contract = this.activeContract
    const revision = $documentSession.get().revision
    if (!conflict || !revision) return
    const result = resolveExternalChange(conflict, choice, historyStore.get())
    historyStore.set(result.history)
    if (result.status === 'compare' || result.status === 'diff-required') {
      $documentWorkspace.set({ ...$documentWorkspace.get(), conflict: result.conflict })
      return
    }
    updateDocumentSession(result.pair, revision.contractDigest)
    this.dependencies.recoveryDrafts.changed(result.pair)
    if (contract) this.analysisClient.schedule(result.pair, contract, 'open')
    else this.publishContractUnavailable(result.pair, revision.contractDigest)
    $documentWorkspace.set({ ...$documentWorkspace.get(), conflict: null })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.activationGeneration += 1
    this.unlisten?.()
    this.unlisten = null
    await Promise.all([this.dependencies.recoveryDrafts.close(), this.flushActiveLayout()])
    this.analysisClient.dispose()
  }

  private receiveAnalysis(analysis: DocumentAnalysis): void {
    receiveDocumentAnalysis(analysis)
    const session = $documentSession.get()
    const layout = $activeLayout.get()
    if (session.analysis !== analysis || !session.pair || !layout || !isLayoutProjection(analysis.projection)) return
    const reconciled = reconcileLayout(analysis.projection, layout)
    setActiveLayout(reconciled)
    const hashes = session.pair.definition.diskHash
      ? { definition: session.pair.definition.diskHash, companion: session.pair.companion?.diskHash ?? null }
      : undefined
    void this.dependencies.layout.saveLayout(reconciled, hashes)
  }

  private publishContractUnavailable(pair: WorkflowPairText, contractDigest: DocumentAnalysis['contractDigest']): void {
    receiveDocumentAnalysis({
      ...createDocumentRevision(pair, contractDigest),
      issues: [
        {
          code: 'contract_unavailable',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Workflow analysis is unavailable because no validated production authoring contract is bundled.',
          document: 'definition',
        },
      ],
      structurallyValid: false,
    })
  }

  private async handleWorkspaceChange(change: RereadWorkspaceChange): Promise<void> {
    const contract = this.activeContract
    const revision = $documentSession.get().revision
    let pair = $documentSession.get().pair
    if (!pair || !revision) return
    for (const disk of change.files) {
      const result = handleExternalChange(pair, disk)
      if (result.status === 'reloaded') {
        pair = result.pair
        updateDocumentSession(pair, revision.contractDigest)
        if (contract) this.analysisClient.schedule(pair, contract, 'open')
      } else if (result.status === 'conflict') {
        $documentWorkspace.set({ ...$documentWorkspace.get(), conflict: result.conflict })
      }
    }
  }

  private async loadRecoveryOffers(pair: WorkflowPairText): Promise<void> {
    const drafts = await this.dependencies.recovery.list()
    if ($documentSession.get().pair?.workflowId !== pair.workflowId) return
    const offers = drafts
      .filter((draft) => draft.workflowId === pair.workflowId)
      .filter(
        (draft) =>
          draft.definition.text !== pair.definition.text ||
          (draft.companion?.text ?? null) !== (pair.companion?.text ?? null),
      )
    $documentWorkspace.set({ ...$documentWorkspace.get(), recoveryOffers: offers })
  }

  private async loadActiveLayout(workspaceId: string, pair: WorkflowPairText): Promise<void> {
    const loaded = await this.dependencies.layout.loadLayout({
      workspaceId,
      workflowPath: pair.definition.path,
      ...(pair.definition.diskHash
        ? { savedHashes: { definition: pair.definition.diskHash, companion: pair.companion?.diskHash ?? null } }
        : {}),
    })
    if ($documentSession.get().pair?.workflowId !== pair.workflowId) return
    const layout = loaded ?? defaultLayout(workspaceId, pair.definition.path)
    setActiveLayout(layout)
    this.layoutPersistence = this.dependencies.createLayoutPersistence(layout)
  }

  private async flushActiveLayout(): Promise<void> {
    const persistence = this.layoutPersistence
    await persistence?.close()
    if (this.layoutPersistence === persistence) this.layoutPersistence = null
  }
}

function openedPair(
  entry: WorkflowPairEntry,
  definition: WorkspaceReadResult,
  companion: WorkspaceReadResult | null,
): WorkflowPairText {
  return {
    workflowId: entry.id,
    generation: 0,
    savedGeneration: 0,
    definition: openedDocument(entry.id, 'definition', definition),
    companion: companion ? openedDocument(entry.id, 'companion', companion) : null,
  }
}

function openedDocument(
  workflowId: string,
  kind: 'definition' | 'companion',
  read: WorkspaceReadResult,
): WorkflowPairText['definition'] {
  return {
    id: `${workflowId}:${kind}`,
    kind,
    path: read.relativePath,
    text: read.text,
    revision: 0,
    savedRevision: 0,
    diskHash: read.sha256,
  }
}

function defaultLayout(workspaceId: string, workflowPath: string): LayoutRecordV1 {
  return {
    schemaVersion: 1,
    workspaceId,
    workflowPath,
    nodePositions: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: new Date().toISOString(),
  }
}

function canonicalCompanionPath(definitionPath: string): string {
  return definitionPath.replace(/\.(?:yaml|yml)$/, '.hermes.yaml')
}

function samePairIdentity(left: WorkflowPairText, right: WorkflowPairText): boolean {
  return (
    left.workflowId === right.workflowId &&
    left.definition.path === right.definition.path &&
    (left.companion?.path ?? null) === (right.companion?.path ?? null)
  )
}

function isLayoutProjection(value: unknown): value is LayoutProjection {
  if (!value || typeof value !== 'object' || !('nodes' in value) || !Array.isArray(value.nodes)) return false
  return value.nodes.every(
    (node) =>
      node !== null &&
      typeof node === 'object' &&
      'id' in node &&
      typeof node.id === 'string' &&
      'kind' in node &&
      typeof node.kind === 'string' &&
      'dependsOn' in node &&
      Array.isArray(node.dependsOn) &&
      'options' in node &&
      node.options !== null &&
      typeof node.options === 'object',
  )
}

const UNAVAILABLE_CONTRACT_DIGEST = `sha256:${'0'.repeat(64)}` as const

export function currentDocumentRevision() {
  const session = $documentSession.get()
  return session.pair && session.revision ? createDocumentRevision(session.pair, session.revision.contractDigest) : null
}
