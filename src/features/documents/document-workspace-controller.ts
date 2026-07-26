import { atom } from 'nanostores'
import type { AuthoringContract } from '$src/lib/contract/types'
import {
  confirmDocumentSaved,
  confirmPairStructureSaved,
  createDocumentRevision,
  removeCompanion,
  setCompanion,
} from '$src/lib/documents/revisions'
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
import { createRecoveryDraft } from '$src/lib/recovery/recovery-store'
import type { RecoveryDraft } from '$src/lib/recovery/types'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import { createHistoryState, historyStore, migrateHistoryWorkflowIdentity } from '$src/stores/history'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
  updateDocumentSession,
  invalidateDocumentAnalysis,
  isDocumentPairDirty,
  type DocumentSyncOrigin,
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
  flush?(): Promise<void>
  close(): Promise<void>
}

export interface LayoutPersistenceLifecycle {
  flush?(): Promise<void>
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
  onWorkspaceChanged(): Promise<void>
}

export interface MissingDocumentChange {
  readonly kind: 'remove' | 'rename'
  readonly paths: readonly string[]
  readonly dirty: boolean
}

export interface DocumentWorkspaceState {
  readonly conflict: ExternalChangeConflict | null
  readonly recoveryOffers: readonly RecoveryDraft[]
  readonly saveOutcome: SaveWorkflowPairResult | null
  readonly analysisError: string | null
  readonly missingChange: MissingDocumentChange | null
}

const emptyState: DocumentWorkspaceState = {
  conflict: null,
  recoveryOffers: [],
  saveOutcome: null,
  analysisError: null,
  missingChange: null,
}

export const $documentWorkspace = atom<DocumentWorkspaceState>(emptyState)

export class DocumentWorkspaceController {
  private activationGeneration = 0
  private activeContract: AuthoringContract | null = null
  private activeWorkspaceId: string | null = null
  private unlisten: UnlistenWorkspace | null = null
  private layoutPersistence: LayoutPersistenceLifecycle | null = null
  private readonly analysisClient: DocumentAnalysisClient
  private deferredAnalysis: DocumentAnalysis | null = null
  private deferredAnalysisError: string | null = null
  private deferredWorkspaceChanges: RereadWorkspaceChange[] = []
  private closeInProgress = false
  private teardownStarted = false
  private teardownComplete = false
  private disposePromise: Promise<void> | null = null

  constructor(private readonly dependencies: DocumentWorkspaceControllerDependencies) {
    this.analysisClient = dependencies.createAnalysisClient(
      (analysis) => this.receiveAnalysis(analysis),
      (message) => this.receiveAnalysisError(message),
    )
  }

  beginActivation(): number {
    if (this.publicationSuppressed()) return this.activationGeneration
    return ++this.activationGeneration
  }

  async start(): Promise<void> {
    if (this.unlisten || this.teardownStarted) return
    const unlisten = await this.dependencies.watch((change) => this.handleWorkspaceChange(change))
    if (this.teardownStarted) unlisten()
    else this.unlisten = unlisten
  }

  async activate(
    workspaceId: string,
    entry: WorkflowPairEntry,
    contract: AuthoringContract | null,
    requestToken: number = this.beginActivation(),
  ): Promise<WorkflowPairText | null> {
    const generation = requestToken
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return null
    const [definition, companion] = await Promise.all([
      this.dependencies.read(entry.definitionPath),
      entry.companionPath ? this.dependencies.read(entry.companionPath) : Promise.resolve(null),
    ])
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return null

    if ($documentSession.get().pair) await this.dependencies.recoveryDrafts.close()
    await this.flushActiveLayout()
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return null
    const pair = openedPair(entry, definition, companion)
    this.activeContract = contract
    this.activeWorkspaceId = workspaceId
    const contractDigest = contract?.contract_digest ?? UNAVAILABLE_CONTRACT_DIGEST
    historyStore.set(createHistoryState())
    openDocumentSession(pair, contractDigest)
    $documentWorkspace.set({ ...emptyState })
    await this.loadActiveLayout(workspaceId, pair)
    await this.loadRecoveryOffers(pair)
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return null
    if (contract) this.analysisClient.schedule(pair, contract, 'open')
    else this.publishContractUnavailable(pair, contractDigest)
    return pair
  }

  changed(pair: WorkflowPairText, origin: DocumentSyncOrigin = 'visual'): void {
    if (this.publicationSuppressed()) return
    const contract = this.activeContract
    const revision = $documentSession.get().revision
    if (!revision || $documentSession.get().pair?.workflowId !== pair.workflowId) return
    updateDocumentSession(pair, revision.contractDigest, origin)
    this.dependencies.recoveryDrafts.changed(pair)
    if (contract) this.analysisClient.schedule(pair, contract, 'edit')
    else this.publishContractUnavailable(pair, revision.contractDigest)
  }

  async openDraft(
    workspaceId: string,
    pair: WorkflowPairText,
    contract: AuthoringContract | null,
    requestToken: number = this.beginActivation(),
  ): Promise<void> {
    const generation = requestToken
    if ($documentSession.get().pair) await this.dependencies.recoveryDrafts.close()
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return
    await this.flushActiveLayout()
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return
    this.activeContract = contract
    this.activeWorkspaceId = workspaceId
    const contractDigest = contract?.contract_digest ?? UNAVAILABLE_CONTRACT_DIGEST
    historyStore.set(createHistoryState())
    openDocumentSession(pair, contractDigest)
    $documentWorkspace.set({ ...emptyState })
    await this.loadActiveLayout(workspaceId, pair)
    if (generation !== this.activationGeneration || this.publicationSuppressed()) return
    this.dependencies.recoveryDrafts.changed(pair)
    if (contract) this.analysisClient.schedule(pair, contract, 'open')
    else this.publishContractUnavailable(pair, contractDigest)
  }

  async save(): Promise<SaveWorkflowPairResult | null> {
    const session = $documentSession.get()
    if (!session.pair) return null
    const missingChange = $documentWorkspace.get().missingChange
    if (missingChange) {
      const missingPath = missingChange.paths[0] ?? session.pair.definition.path
      const outcome: SaveWorkflowPairResult = {
        status: 'blocked',
        pair: session.pair,
        issues: [
          {
            code: 'backing_file_missing',
            layer: 'operational',
            severity: 'error',
            blocking: true,
            message: `Backing YAML file is missing: ${missingChange.paths.join(', ')}. Choose Keep Mine / Recreate or Close and Recover Later.`,
            document: session.pair.companion?.path === missingPath ? 'companion' : 'definition',
            path: missingPath,
          },
        ],
        reason: 'backing_file_missing',
      }
      $documentWorkspace.set({ ...$documentWorkspace.get(), saveOutcome: outcome })
      return outcome
    }
    if (!this.activeContract) return null
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

  async recreateMissing(): Promise<void> {
    if (this.publicationSuppressed()) return
    const missingChange = $documentWorkspace.get().missingChange
    const session = $documentSession.get()
    if (!missingChange || !session.pair || !session.revision) return
    const generation = this.activationGeneration
    const workflowId = session.pair.workflowId

    for (const path of missingChange.paths) {
      const currentSession = $documentSession.get()
      const current = currentSession.pair
      if (
        this.publicationSuppressed() ||
        generation !== this.activationGeneration ||
        !current ||
        current.workflowId !== workflowId
      )
        return
      const document =
        current.definition.path === path
          ? current.definition
          : current.companion?.path === path
            ? current.companion
            : null
      if (!document) continue
      try {
        const written = await this.dependencies.write({
          relativePath: path,
          text: document.text,
          expectedCurrentHash: null,
        })
        const active = $documentSession.get().pair
        if (
          this.publicationSuppressed() ||
          generation !== this.activationGeneration ||
          !active ||
          !samePairIdentity(active, current)
        )
          return
        const saved = confirmDocumentSaved(active, document.kind, {
          revision: document.revision,
          diskHash: written.sha256,
        })
        updateDocumentSession(saved, currentSession.revision?.contractDigest ?? session.revision.contractDigest)
        this.clearMissingPaths([path])
        this.dependencies.recoveryDrafts.changed(saved)
      } catch (error: unknown) {
        let disk: WorkspaceReadResult
        try {
          disk = await this.dependencies.read(path)
        } catch {
          throw error
        }
        const active = $documentSession.get().pair
        if (
          this.publicationSuppressed() ||
          generation !== this.activationGeneration ||
          !active ||
          active.workflowId !== workflowId
        )
          return
        $documentWorkspace.set({
          ...$documentWorkspace.get(),
          conflict: {
            pair: active,
            document: document.kind,
            disk,
            choices: ['keep-mine', 'reload-disk', 'compare'],
            diffViewed: false,
          },
        })
        return
      }
    }
    const active = $documentSession.get().pair
    if (!active || $documentWorkspace.get().missingChange) return
    if (this.activeContract) this.analysisClient.schedule(active, this.activeContract, 'open')
    else if ($documentSession.get().revision) {
      this.publishContractUnavailable(active, $documentSession.get().revision!.contractDigest)
    }
  }

  async closeMissing(): Promise<void> {
    const pair = $documentSession.get().pair
    if (!pair || !$documentWorkspace.get().missingChange) return
    await this.flushRecovery(pair)
    await this.close(pair.workflowId)
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
    historyStore.set(migrateHistoryWorkflowIdentity(historyStore.get(), priorWorkflowId, workflowId))
    if (contract) this.analysisClient.schedule(renamed, contract, 'contract-change')
    else this.publishContractUnavailable(renamed, initialSession.revision.contractDigest)

    if (isDocumentPairDirty(renamed)) {
      await this.dependencies.recovery.save(createRecoveryDraft(renamed, new Date().toISOString()))
    }
    await this.dependencies.recovery.discard(priorWorkflowId)

    if (this.publicationSuppressed()) return

    const activeAfterRecovery = $documentSession.get().pair
    if (
      operationGeneration !== this.activationGeneration ||
      !activeAfterRecovery ||
      !samePairIdentity(activeAfterRecovery, renamed)
    ) {
      await this.dependencies.layout.renameWorkflowPath(workspaceId, fromDefinition, toDefinition)
      return
    }
    this.dependencies.recoveryDrafts.changed(activeAfterRecovery)

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
    const changed = setCompanion(current.pair, openedDocument(current.pair.workflowId, 'companion', disk))
    const next = confirmPairStructureSaved(changed, changed.generation)
    updateDocumentSession(next, current.revision?.contractDigest ?? session.revision.contractDigest)
    this.clearMissingPaths([companionPath])
    this.dependencies.recoveryDrafts.changed(next)
    if (contract) this.analysisClient.schedule(next, contract, 'contract-change')
    else this.publishContractUnavailable(next, session.revision.contractDigest)
  }

  async companionRemoved(companionPath: string): Promise<void> {
    const session = $documentSession.get()
    const contract = this.activeContract
    const pair = session.pair
    if (!pair || !session.revision || pair.companion?.path !== companionPath) return
    const changed = removeCompanion(pair)
    const next = confirmPairStructureSaved(changed, changed.generation)
    updateDocumentSession(next, session.revision.contractDigest)
    this.clearMissingPaths([companionPath])
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
    updateDocumentSession(recovered, session.revision.contractDigest, 'recovery')
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
    if (this.publicationSuppressed()) return
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
    updateDocumentSession(result.pair, revision.contractDigest, choice === 'reload-disk' ? 'disk' : 'unknown')
    this.clearMissingPaths([conflict.disk.relativePath])
    this.dependencies.recoveryDrafts.changed(result.pair)
    if (contract) this.analysisClient.schedule(result.pair, contract, 'open')
    else this.publishContractUnavailable(result.pair, revision.contractDigest)
    $documentWorkspace.set({ ...$documentWorkspace.get(), conflict: null })
  }

  dispose(): Promise<void> {
    if (this.teardownComplete) return Promise.resolve()
    if (this.disposePromise) return this.disposePromise
    this.closeInProgress = true
    this.activationGeneration += 1
    const operation = (async () => {
      try {
        const results = await Promise.allSettled([this.flushRecoveryForClose(), this.flushLayoutForClose()])
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failure) throw failure.reason
        await this.finalizeLayoutAfterCloseFlush()
        this.teardownStarted = true
        this.unlisten?.()
        this.unlisten = null
        this.analysisClient.dispose()
        this.teardownComplete = true
        this.clearDeferredPublications()
      } catch (error: unknown) {
        this.closeInProgress = false
        await this.replayDeferredPublications()
        throw error
      }
    })().finally(() => {
      if (this.disposePromise === operation) this.disposePromise = null
    })
    this.disposePromise = operation
    return operation
  }

  private receiveAnalysis(analysis: DocumentAnalysis): void {
    if (this.teardownStarted) return
    if (this.closeInProgress) {
      this.deferredAnalysis = analysis
      return
    }
    if ($documentWorkspace.get().missingChange) return
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

  private receiveAnalysisError(message: string): void {
    if (this.teardownStarted) return
    if (this.closeInProgress) {
      this.deferredAnalysisError = message
      return
    }
    $documentWorkspace.set({ ...$documentWorkspace.get(), analysisError: message })
  }

  private publishContractUnavailable(pair: WorkflowPairText, contractDigest: DocumentAnalysis['contractDigest']): void {
    if (this.publicationSuppressed()) return
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
    if (this.teardownStarted) return
    if (this.closeInProgress) {
      this.deferredWorkspaceChanges.push(change)
      return
    }
    await this.dependencies.onWorkspaceChanged()
    if (this.teardownStarted) return
    if (this.closeInProgress) {
      this.deferredWorkspaceChanges.push(change)
      return
    }
    const contract = this.activeContract
    const revision = $documentSession.get().revision
    let pair = $documentSession.get().pair
    if (!pair || !revision) return
    if (await this.migrateExternalRename(change, pair, revision.contractDigest)) return

    const availablePaths = new Set(change.files.map(({ relativePath }) => relativePath))
    const activePaths = [pair.definition.path, ...(pair.companion ? [pair.companion.path] : [])]
    const missingPaths = activePaths.filter((path) => change.event.paths.includes(path) && !availablePaths.has(path))
    if (missingPaths.length > 0) {
      pair = invalidateMissingDiskIdentity(pair, missingPaths)
      updateDocumentSession(pair, revision.contractDigest)
      invalidateDocumentAnalysis()
      this.dependencies.recoveryDrafts.changed(pair)
      const workspaceState = $documentWorkspace.get()
      const priorMissing = workspaceState.missingChange
      const mergedPaths = [...(priorMissing?.paths ?? [])]
      for (const path of missingPaths) if (!mergedPaths.includes(path)) mergedPaths.push(path)
      $documentWorkspace.set({
        ...workspaceState,
        missingChange: {
          kind: priorMissing?.kind === 'rename' || change.event.kind === 'rename' ? 'rename' : 'remove',
          paths: mergedPaths,
          dirty: priorMissing?.dirty === true || isDocumentPairDirty(pair),
        },
      })
    }
    this.clearMissingPaths(change.event.paths.filter((path) => availablePaths.has(path)))
    for (const disk of change.files) {
      const result = handleExternalChange(pair, disk)
      if (result.status === 'reloaded') {
        pair = result.pair
        updateDocumentSession(pair, revision.contractDigest, 'disk')
        if (contract) this.analysisClient.schedule(pair, contract, 'open')
      } else if (result.status === 'conflict') {
        $documentWorkspace.set({ ...$documentWorkspace.get(), conflict: result.conflict })
      }
    }
  }

  private async migrateExternalRename(
    change: RereadWorkspaceChange,
    pair: WorkflowPairText,
    contractDigest: DocumentAnalysis['contractDigest'],
  ): Promise<boolean> {
    const operationGeneration = this.activationGeneration
    const workspaceId = this.activeWorkspaceId
    if (
      change.event.kind !== 'rename' ||
      !workspaceId ||
      !change.event.paths.includes(pair.definition.path) ||
      !pair.definition.diskHash
    )
      return false
    if (pair.companion && !change.event.paths.includes(pair.companion.path)) return false
    const definitionMatches = change.files.filter(
      (file) => file.relativePath !== pair.definition.path && file.sha256 === pair.definition.diskHash,
    )
    if (definitionMatches.length !== 1) return false
    const movedDefinition = definitionMatches[0]!
    let movedCompanion: WorkspaceReadResult | null = null
    if (pair.companion && change.event.paths.includes(pair.companion.path)) {
      const companionMatches = change.files.filter(
        (file) => file.relativePath !== pair.companion?.path && file.sha256 === pair.companion?.diskHash,
      )
      if (companionMatches.length !== 1) return false
      movedCompanion = companionMatches[0]!
    }

    const priorWorkflowId = pair.workflowId
    const priorDefinitionPath = pair.definition.path
    const workflowId = `workflow:${workspaceId}:${movedDefinition.relativePath}`
    const migrated: WorkflowPairText = {
      ...pair,
      workflowId,
      definition: {
        ...pair.definition,
        id: `${workflowId}:definition`,
        path: movedDefinition.relativePath,
      },
      companion: pair.companion
        ? {
            ...pair.companion,
            id: `${workflowId}:companion`,
            path: movedCompanion?.relativePath ?? pair.companion.path,
          }
        : null,
    }
    updateDocumentSession(migrated, contractDigest)
    historyStore.set(migrateHistoryWorkflowIdentity(historyStore.get(), priorWorkflowId, workflowId))
    if (isDocumentPairDirty(migrated)) {
      await this.dependencies.recovery.save(createRecoveryDraft(migrated, new Date().toISOString()))
    }
    await this.dependencies.recovery.discard(priorWorkflowId)

    if (this.publicationSuppressed()) return true

    const layoutRequest = {
      workspaceId,
      workflowPath: movedDefinition.relativePath,
      savedHashes: {
        definition: pair.definition.diskHash,
        companion: pair.companion?.diskHash ?? null,
      },
      missingWorkflowPaths: [priorDefinitionPath],
    }
    const active = $documentSession.get().pair
    if (operationGeneration !== this.activationGeneration || !active || !samePairIdentity(active, migrated)) {
      await this.dependencies.layout.loadLayout(layoutRequest)
      return true
    }
    this.dependencies.recoveryDrafts.changed(active)

    await this.flushActiveLayout()
    const loaded = await this.dependencies.layout.loadLayout(layoutRequest)
    const activeAfterLayout = $documentSession.get().pair
    if (
      this.publicationSuppressed() ||
      operationGeneration !== this.activationGeneration ||
      !activeAfterLayout ||
      !samePairIdentity(activeAfterLayout, migrated)
    )
      return true
    const layout = loaded ?? defaultLayout(workspaceId, movedDefinition.relativePath)
    setActiveLayout(layout)
    this.layoutPersistence = this.dependencies.createLayoutPersistence(layout)
    $documentWorkspace.set({ ...$documentWorkspace.get(), missingChange: null })
    if (this.activeContract) this.analysisClient.schedule(migrated, this.activeContract, 'open')
    else this.publishContractUnavailable(migrated, contractDigest)
    return true
  }

  private clearMissingPaths(paths: readonly string[]): void {
    if (paths.length === 0) return
    const state = $documentWorkspace.get()
    const missingChange = state.missingChange
    if (!missingChange) return
    const restored = new Set(paths)
    const remainingPaths = missingChange.paths.filter((path) => !restored.has(path))
    if (remainingPaths.length === missingChange.paths.length) return
    $documentWorkspace.set({
      ...state,
      missingChange: remainingPaths.length > 0 ? { ...missingChange, paths: remainingPaths } : null,
    })
  }

  private async loadRecoveryOffers(pair: WorkflowPairText): Promise<void> {
    const drafts = await this.dependencies.recovery.list()
    if (this.publicationSuppressed() || $documentSession.get().pair?.workflowId !== pair.workflowId) return
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
    if (this.publicationSuppressed() || $documentSession.get().pair?.workflowId !== pair.workflowId) return
    const layout = loaded ?? defaultLayout(workspaceId, pair.definition.path)
    setActiveLayout(layout)
    this.layoutPersistence = this.dependencies.createLayoutPersistence(layout)
  }

  private async flushActiveLayout(): Promise<void> {
    const persistence = this.layoutPersistence
    await persistence?.close()
    if (this.layoutPersistence === persistence) this.layoutPersistence = null
  }

  private flushRecoveryForClose(): Promise<void> {
    return this.dependencies.recoveryDrafts.flush?.() ?? this.dependencies.recoveryDrafts.close()
  }

  private flushLayoutForClose(): Promise<void> {
    const persistence = this.layoutPersistence
    return persistence?.flush?.() ?? persistence?.close() ?? Promise.resolve()
  }

  private async finalizeLayoutAfterCloseFlush(): Promise<void> {
    const persistence = this.layoutPersistence
    if (!persistence) return
    if (persistence.flush) await this.flushActiveLayout()
    else if (this.layoutPersistence === persistence) this.layoutPersistence = null
  }

  private async replayDeferredPublications(): Promise<void> {
    const changes = this.deferredWorkspaceChanges
    const analysis = this.deferredAnalysis
    const analysisError = this.deferredAnalysisError
    this.clearDeferredPublications()
    for (const change of changes) await this.handleWorkspaceChange(change)
    if (analysis) this.receiveAnalysis(analysis)
    if (analysisError) this.receiveAnalysisError(analysisError)
  }

  private clearDeferredPublications(): void {
    this.deferredWorkspaceChanges = []
    this.deferredAnalysis = null
    this.deferredAnalysisError = null
  }

  private publicationSuppressed(): boolean {
    return this.closeInProgress || this.teardownStarted
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

function invalidateMissingDiskIdentity(pair: WorkflowPairText, paths: readonly string[]): WorkflowPairText {
  const missing = new Set(paths)
  return {
    ...pair,
    definition: missing.has(pair.definition.path) ? { ...pair.definition, diskHash: null } : pair.definition,
    companion:
      pair.companion && missing.has(pair.companion.path) ? { ...pair.companion, diskHash: null } : pair.companion,
  }
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
