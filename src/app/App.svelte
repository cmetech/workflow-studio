<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import {
    executeCommand,
    listCommands,
    setCanvasCommandHandlers,
    setDocumentSaveHandler,
  } from '$src/lib/commands/registry'
  import type { CommandContext, EditorMode } from '$src/lib/commands/types'
  import { getBundledBrandAssetUrl, loadBundledBrand } from '$src/lib/branding/load-brand'
  import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
  import { buildDocumentationIndex } from '$src/lib/docs/build-index'
  import type { DocumentationGuide, DocumentationIndex } from '$src/lib/docs/types'
  import { createContractCache, type ContractCache } from '$src/lib/contract/contract-cache'
  import ContractSettingsHost from '$src/features/settings/ContractSettingsHost.svelte'
  import type { AuthoringContract } from '$src/lib/contract/types'
  import { collectContractFields, fieldsForNode, materializeFormFields } from '$src/lib/forms/widget-registry'
  import type { FormField, FormFieldCommit } from '$src/lib/forms/types'
  import { applyWorkflowMutation } from '$src/lib/documents/transactions'
  import type { WorkflowMutation } from '$src/lib/yaml/mutations'
  import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
  import { activeActivity, activeEditorMode, showActivity, showEditorMode, workspaceIntent } from '$src/stores/shell'
  import { loadWorkspaceEntries, workspace } from '$src/stores/workspace'
  import { selectWorkspaceEntry } from '$src/stores/workspace'
  import { getNativeBridge } from '$src/lib/native/bridge'
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'
  import type { WorkflowPairEntry } from '$src/lib/workspace/types'
  import { createLayoutStore, LayoutPersistenceController } from '$src/lib/layout/layout-store'
  import type { LayoutRecordV1 } from '$src/lib/layout/types'
  import type { WorkflowProjection } from '$src/lib/projection/types'
  import { createWorkspaceActions, WorkspaceActionError } from '$src/features/workspace/workspace-actions'
  import {
    $documentSession as documentSessionStore,
    $documentSyncOrigins as documentSyncOriginsStore,
    openDocumentSession,
  } from '$src/stores/documents'
  import { $activeLayout as activeLayoutStore, setActiveLayout } from '$src/stores/layout'
  import { createRecoveryDraft, createRecoveryStore, RecoveryDraftController } from '$src/lib/recovery/recovery-store'
  import { watchWorkspaceChanges } from '$src/lib/native/workspace-api'
  import { DocumentClient } from '$src/workers/document-client'
  import type { DocumentAnalysis, DocumentKind, WorkflowPairText } from '$src/lib/documents/types'
  import {
    $documentWorkspace as documentWorkspaceState,
    DocumentWorkspaceController,
  } from '$src/features/documents/document-workspace-controller'
  import {
    createWorkspaceActionCoordinator,
    formatWorkspaceOutcomeResults,
  } from '$src/features/workspace/workspace-action-coordinator'
  import Explorer from '$src/features/workspace/Explorer.svelte'
  import OpenWorkspace from '$src/features/workspace/OpenWorkspace.svelte'
  import QuickOpen from '$src/features/workspace/QuickOpen.svelte'
  import WorkflowContextMenu from '$src/features/workspace/WorkflowContextMenu.svelte'
  import NewWorkflowDialog from '$src/features/workspace/NewWorkflowDialog.svelte'
  import ImportExportDialog from '$src/features/workspace/ImportExportDialog.svelte'
  import ProblemsPanel from '$src/features/documents/ProblemsPanel.svelte'
  import ExternalChangeDialog from '$src/features/documents/ExternalChangeDialog.svelte'
  import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
  import AddNodePicker from '$src/features/canvas/AddNodePicker.svelte'
  import DeleteImpactDialog from '$src/features/canvas/DeleteImpactDialog.svelte'
  import Inspector from '$src/features/inspector/Inspector.svelte'
  import DocumentationView from '$src/features/documentation/DocumentationView.svelte'
  import EditorModes from '$src/features/editor/EditorModes.svelte'
  import { applyAuthoritativeEditorText, synchronizeEditorProjection } from '$src/features/editor/editor-extensions'
  import type { NodeKindDescriptor } from '$src/lib/contract/types'
  import { renameNode, type CanvasActionContext, type DeleteImpact } from '$src/features/canvas/canvas-actions'
  import { createCanvasAuthoringCoordinator } from '$src/features/canvas/canvas-authoring-coordinator'
  import {
    $canvasPositions as canvasPositionsStore,
    $canvasSelection as canvasSelectionStore,
    activateCanvasWorkflowIdentity,
  } from '$src/stores/canvas'
  import { historyStore, recordTransaction } from '$src/stores/history'
  import { createCanvasActivationBarrier } from '$src/features/canvas/canvas-activation-barrier'
  import ActivityRail from './ActivityRail.svelte'
  import StatusBar from './StatusBar.svelte'
  import { createApplicationDisposal } from './application-disposal'
  import { installWindowCloseLifecycle } from './window-close-lifecycle'

  const globalContext: CommandContext = {
    surface: 'global',
    canMutate: false,
    hasSelection: false,
  }

  const brand = loadBundledBrand()
  const bundledGuideSources = import.meta.glob('../../docs/app-guides/*.md', {
    eager: true,
    import: 'default',
    query: '?raw',
  }) as Readonly<Record<string, string>>
  const bundledGuides: readonly DocumentationGuide[] = Object.entries(bundledGuideSources)
    .map(([path, body]) => ({
      id: path.split('/').at(-1)?.replace(/\.md$/, '') ?? path,
      title: body.match(/^#\s+(.+)$/m)?.[1] ?? path.split('/').at(-1)?.replace(/\.md$/, '') ?? path,
      body,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const brandMarkUrl = getBundledBrandAssetUrl(brand, 'mark')
  const native = getNativeBridge()
  const layoutStore = createLayoutStore(native)
  const recoveryStore = createRecoveryStore(native)
  const recoveryDrafts = new RecoveryDraftController(recoveryStore)
  const draftDigest = `sha256:${'0'.repeat(64)}` as const
  const availableContracts: AuthoringContract[] = []
  let contracts = $state.raw<readonly AuthoringContract[]>([])
  let contractsLoaded = $state(false)
  let appContractCache = $state.raw<ContractCache | null>(null)
  function synchronizeContractRegistry(next: readonly AuthoringContract[]): void {
    availableContracts.splice(0, availableContracts.length, ...next)
    contracts = next
  }
  function activeContractForProfile(profile: 'hermes-legacy' | 'archon-2026-07'): AuthoringContract | undefined {
    return appContractCache?.activeContract(profile)
  }
  const contractReadiness = loadBundledAuthoringContracts().then(async (loaded) => {
    appContractCache = createContractCache({
      bundled: loaded,
      native,
      activate: (contract) => documentWorkspace.activateContract(contract),
    })
    synchronizeContractRegistry(appContractCache.listAuthoringContracts())
    await appContractCache.hydrate()
    synchronizeContractRegistry(appContractCache.listAuthoringContracts())
    contractsLoaded = true
    return loaded
  })
  let recent = $state<readonly RecentWorkspace[]>([])
  let workspaceError = $state<string | null>(null)
  let quickOpenVisible = $state(false)
  let quickOpenOpener = $state<HTMLElement | undefined>()
  let contextEntryId = $state<string | null>(null)
  let contextOpener = $state<HTMLElement | undefined>()
  let contextProfile = $state<'hermes-legacy' | 'archon-2026-07' | null>(null)
  let newDialogOpener = $state<HTMLElement | undefined>()
  let newDialogVisible = $state(false)
  let importDialogOpener = $state<HTMLElement | undefined>()
  let importDialogVisible = $state(false)
  let exportBlockingIssues = $state<readonly string[]>([])
  let inspectorDocumentationTopicId = $state<string | undefined>()
  let documentationNavigationRequest = $state<{ readonly id: number; readonly topicId: string } | undefined>()
  let documentationNavigationSequence = 0
  let canvasProjection = $state.raw<WorkflowProjection | null>(null)
  let canvasWorkflowId = $state<string | null>(null)
  let canvasStale = $state(false)
  let canvasTransitionLocked = $state(false)
  let graphCanvas = $state<ReturnType<typeof GraphCanvas> | null>(null)
  let addNodeRequest = $state<{
    request: { readonly afterNodeId?: string; readonly viewportCenter: { readonly x: number; readonly y: number } }
    opener: HTMLElement | undefined
  } | null>(null)
  let deleteRequest = $state<{ impact: DeleteImpact; opener: HTMLElement | undefined } | null>(null)
  let exportConfirmation = $state<{
    paths: readonly string[]
    resolve: (confirmed: boolean) => void
    opener: HTMLElement | undefined
  } | null>(null)
  let handledIntent = 0
  let restoredLayoutModeIdentity: string | null = null
  const documentWorkspace = new DocumentWorkspaceController({
    read: (path) => native.workspaceRead(path),
    write: (request) => native.workspaceWrite(request),
    trash: (requests) => native.workspaceTrashPaths(requests),
    createAnalysisClient: (onAnalysis, onError) => {
      if (typeof Worker === 'undefined') {
        return {
          schedule: () => onError('Document analysis worker is unavailable.'),
          registerContract: async () => {
            throw new Error('Document analysis worker is unavailable.')
          },
          dispose: () => undefined,
        }
      }
      const worker = new Worker(new URL('../workers/document-worker.ts', import.meta.url), { type: 'module' })
      const client = new DocumentClient(worker, { onAnalysis, onError: (error) => onError(error.message) })
      return {
        schedule: (pair, contract, reason) => client.schedule(pair, contract, reason),
        registerContract: (contract) => client.registerContract(contract),
        dispose: () => {
          client.dispose()
          worker.terminate()
        },
      }
    },
    watch: watchWorkspaceChanges,
    recovery: recoveryStore,
    recoveryDrafts,
    layout: layoutStore,
    createLayoutPersistence: () =>
      new LayoutPersistenceController(async (layout) => {
        const pair = documentSessionStore.get().pair
        await layoutStore.saveLayout(
          layout,
          pair?.definition.diskHash
            ? {
                definition: pair.definition.diskHash,
                companion: pair.companion?.diskHash ?? null,
              }
            : undefined,
        )
      }),
    onWorkspaceChanged: refreshWorkspace,
  })
  const canvasAuthoring = createCanvasAuthoringCoordinator({ getContext: canvasAuthoringContext })
  const actions = createWorkspaceActions({
    native,
    contracts: availableContracts,
    activeContract: activeContractForProfile,
    analyze: analyzeCandidateInWorker,
    activate: openEntry,
    openDraft: (pair, contract) => {
      const requestToken = documentWorkspace.beginActivation()
      return withCanvasLayoutBarrier(async () => {
        const workspaceId = $workspace.id
        if (workspaceId) await documentWorkspace.openDraft(workspaceId, pair, contract, requestToken)
        else openDocumentSession(pair, draftDigest)
      })
    },
    currentDocument: () => documentSessionStore.get().pair,
    flushRecovery: (pair) => documentWorkspace.flushRecovery(pair),
    closeWorkspace: () => withCanvasLayoutBarrier(() => documentWorkspace.closeWorkspace()),
    closeDocument: (workflowId) => withCanvasLayoutBarrier(() => documentWorkspace.close(workflowId)),
    renameDocument: (workspaceId, from, to, companionMoved) =>
      withCanvasLayoutBarrier(() => documentWorkspace.renameActivePair(workspaceId, from, to, companionMoved)),
    companionCreated: (definitionPath, companionPath) =>
      documentWorkspace.companionCreated(definitionPath, companionPath),
    companionRemoved: (companionPath) => documentWorkspace.companionRemoved(companionPath),
    recoverDraft: async (pair) => {
      await recoveryStore.save(createRecoveryDraft(pair, new Date().toISOString()))
    },
  })

  const editorModes: readonly { id: EditorMode; label: string }[] = [
    { id: 'visual', label: 'Visual' },
    { id: 'split', label: 'Split' },
    { id: 'yaml', label: 'YAML' },
  ]

  const canvasActivationBarrier = createCanvasActivationBarrier({
    getCanvas: () => graphCanvas,
    setLocked: (locked) => {
      canvasTransitionLocked = locked
    },
    settle: tick,
    onPersistenceError: surfaceCanvasPersistenceError,
  })
  const applicationDisposal = createApplicationDisposal(
    () => withCanvasLayoutBarrier(() => documentWorkspace.dispose()),
    surfaceCanvasPersistenceError,
  )

  const inspectorContract = $derived(
    contracts.find(
      (candidate) =>
        candidate.contract_digest === $documentSessionStore.revision?.contractDigest &&
        candidate.profile === canvasProjection?.profile,
    ),
  )
  const inspectorNodes = $derived(
    (canvasProjection?.nodes ?? []).filter((node) => $canvasSelectionStore.includes(node.id)),
  )
  const inspectorFields = $derived.by(() => {
    const node = inspectorNodes[0]
    const projection = canvasProjection
    if (!inspectorContract || !projection || inspectorNodes.length > 1) return []
    const index = node ? projection.nodes.findIndex(({ id }) => id === node.id) : -1
    if (!node) {
      const fields = collectContractFields(inspectorContract).filter(
        (field) => !field.nodeKinds && (field.document !== 'companion' || projection.companion),
      )
      return fields.flatMap((field) =>
        materializeFormFields(
          [field],
          field.document === 'companion' ? (projection.companion ?? {}) : projection.definition,
          index,
        ),
      )
    }
    return materializeFormFields(fieldsForNode(inspectorContract, node.kind), projection.definition, index)
  })
  const inspectorValues = $derived.by(() => {
    if (!canvasProjection) return {}
    const values: Record<string, unknown> = {}
    for (const field of inspectorFields) {
      const root = field.document === 'companion' ? canvasProjection.companion : canvasProjection.definition
      const value = root ? formFieldValue(root, field) : undefined
      if (value !== undefined) values[field.id] = value
    }
    return values
  })
  const inspectorBindingIdentity = $derived(formBindingIdentity(inspectorNodes[0]?.id ?? 'workflow'))
  const inspectorDisabledReason = $derived(inspectorMutationDisabledReason())
  const documentationContract = $derived(
    contracts.find((candidate) => candidate.contract_digest === $documentSessionStore.revision?.contractDigest),
  )
  const documentationIndex = $derived.by<DocumentationIndex | null>(() =>
    documentationContract ? buildDocumentationIndex(documentationContract, bundledGuides) : null,
  )

  function runCommand(id: string, context: CommandContext = globalContext): Promise<void> {
    return executeCommand(id, context)
  }

  async function persistCanvasLayout(next: LayoutRecordV1): Promise<void> {
    const active = activeLayoutStore.get()
    const pair = documentSessionStore.get().pair
    if (
      active?.workspaceId === next.workspaceId &&
      active.workflowPath === next.workflowPath &&
      pair?.definition.path === next.workflowPath
    ) {
      setActiveLayout(next)
    }
    await layoutStore.saveLayout(
      next,
      pair?.definition.path === next.workflowPath && pair.definition.diskHash
        ? { definition: pair.definition.diskHash, companion: pair.companion?.diskHash ?? null }
        : undefined,
    )
  }

  function surfaceCanvasPersistenceError(error: unknown): void {
    workspaceError = error instanceof Error ? error.message : 'The canvas layout could not be saved.'
  }

  function canvasAuthoringContext(): CanvasActionContext | { readonly unavailable: string } {
    if (canvasTransitionLocked) return { unavailable: 'Canvas authoring is unavailable during a document transition.' }
    if (canvasStale) return { unavailable: 'Canvas authoring is unavailable while the YAML projection is stale.' }
    if ($documentWorkspaceState.missingChange) {
      return { unavailable: 'Canvas authoring is unavailable while a backing YAML file is missing.' }
    }
    const session = documentSessionStore.get()
    const projection = canvasProjection
    if (!session.pair || !session.revision || !projection || !session.analysis?.structurallyValid) {
      return { unavailable: 'Canvas authoring requires a current valid YAML projection.' }
    }
    const contract = contracts.find(
      (candidate) =>
        candidate.contract_digest === session.revision?.contractDigest && candidate.profile === projection.profile,
    )
    if (!contract) return { unavailable: 'The active workflow authoring contract is unavailable.' }
    const entry = workspace.get().entries.find((candidate) => candidate.id === session.pair?.workflowId)
    if (entry?.readOnly === true) return { unavailable: 'This workflow is read-only.' }
    const layout = activeLayoutStore.get()
    if (!layout) return { unavailable: 'Canvas layout is unavailable.' }

    return {
      pair: session.pair,
      projection,
      contract,
      positions: canvasPositionsStore.get(),
      commit: (pair, transaction) => {
        historyStore.set(recordTransaction(historyStore.get(), transaction))
        documentWorkspace.changed(pair, 'visual')
      },
      commitPositions: async (updates) => {
        const active = activeLayoutStore.get()
        if (!active) return
        const nodePositions = { ...active.nodePositions }
        for (const [id, position] of Object.entries(updates)) {
          if (position) nodePositions[id] = { ...position }
          else delete nodePositions[id]
        }
        await persistCanvasLayout({ ...active, nodePositions, updatedAt: new Date().toISOString() })
      },
      // The invoking surface owns the single live announcement. GraphCanvas uses
      // its named polite region; dialogs and commands surface their returned result.
      announce: () => undefined,
    }
  }

  function requestCanvasAdd(request: {
    readonly afterNodeId?: string
    readonly viewportCenter: { readonly x: number; readonly y: number }
  }): void {
    const current = canvasAuthoringContext()
    if ('unavailable' in current) {
      workspaceError = current.unavailable
      return
    }
    addNodeRequest = {
      request,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    }
  }

  function editYamlDocument(document: DocumentKind, text: string): void {
    const pair = documentSessionStore.get().pair
    if (!pair) return
    applyAuthoritativeEditorText(pair, document, text, (next) => documentWorkspace.changed(next, 'user'))
  }

  function formBindingIdentity(nodeId: string | undefined): string {
    const session = $documentSessionStore
    if (!session.pair || !session.revision || !nodeId) return 'no-form-binding'
    return [
      session.pair.workflowId,
      session.pair.generation,
      session.pair.definition.revision,
      session.pair.companion?.revision ?? -1,
      session.revision.contractDigest,
      nodeId,
    ].join(':')
  }

  function inspectorMutationDisabledReason(): string | undefined {
    if (canvasTransitionLocked) return 'The document is transitioning.'
    if (canvasStale) return 'The YAML projection is stale.'
    if ($documentWorkspaceState.missingChange) return 'A backing YAML file is missing.'
    const entry = $workspace.entries.find(({ id }) => id === $documentSessionStore.pair?.workflowId)
    if (entry?.readOnly) return 'This workflow is read-only.'
    if (!inspectorContract || !$documentSessionStore.analysis?.structurallyValid) {
      return 'A current valid authoring contract and YAML projection are required.'
    }
    return undefined
  }

  function formFieldValue(definition: Readonly<Record<string, unknown>>, field: FormField): unknown {
    let value: unknown = definition
    for (const segment of field.concretePath ?? []) {
      if (typeof segment === 'number') {
        if (!Array.isArray(value)) return undefined
        value = value[segment]
      } else {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
        value = (value as Record<string, unknown>)[segment]
      }
    }
    return value
  }

  function concreteFormPath(field: FormField, nodeIndex: number): readonly (string | number)[] | null {
    const path = field.concretePath ?? field.pathTemplate.map((token) => (token === '$node' ? nodeIndex : token))
    return path.some((token) => token === '*') ? null : path
  }

  async function commitInspectorField(commit: FormFieldCommit): Promise<void> {
    const node = inspectorNodes[0]
    const contract = inspectorContract
    const session = documentSessionStore.get()
    const projection = canvasProjection
    const expectedIdentity = inspectorBindingIdentity
    if (!contract || !session.pair || !projection || inspectorDisabledReason) return
    const bindingSubject = node?.id ?? 'workflow'
    const nodeIndex = node ? projection.nodes.findIndex(({ id }) => id === node.id) : -1
    const path = concreteFormPath(commit.field, nodeIndex)
    if (!path) {
      workspaceError = 'This contract field cannot be mutated safely by the current reader.'
      return
    }

    const graphFields = commit.field.fieldPath.replace(/^nodes\[\]\./, '')
    if (node && graphFields === 'id' && !commit.remove && typeof commit.value === 'string') {
      let didCommit = false
      const context = canvasAuthoringContext()
      if ('unavailable' in context) {
        workspaceError = context.unavailable
        return
      }
      const result = await renameNode(
        {
          ...context,
          commit: (pair, transaction) => {
            if (formBindingIdentity(node.id) !== expectedIdentity) return
            didCommit = true
            historyStore.set(recordTransaction(historyStore.get(), transaction))
            documentWorkspace.changed(pair, 'form')
          },
          commitPositions: (updates) => (didCommit ? context.commitPositions(updates) : undefined),
        },
        node.id,
        commit.value,
      )
      if (result.status !== 'committed') workspaceError = result.message
      else if (!didCommit) workspaceError = 'The inspector binding changed before the edit could commit.'
      return
    }

    let mutation: WorkflowMutation
    if (node && graphFields === 'depends_on' && !commit.remove && Array.isArray(commit.value)) {
      mutation = { type: 'set-dependencies', nodeId: node.id, dependsOn: commit.value.map(String) }
    } else if (commit.remove) {
      mutation = { type: 'delete-field', document: commit.field.document, path }
    } else {
      mutation = { type: 'set-field', document: commit.field.document, path, value: commit.value }
    }

    const result = await applyWorkflowMutation(session.pair, mutation, contract)
    if (!result.ok) {
      workspaceError = result.message
      return
    }
    if (formBindingIdentity(bindingSubject) !== expectedIdentity) {
      workspaceError = 'The inspector binding changed before the edit could commit.'
      return
    }
    historyStore.set(recordTransaction(historyStore.get(), result.transaction))
    documentWorkspace.changed(result.pair, 'form')
  }

  async function chooseCanvasNode(descriptor: NodeKindDescriptor): Promise<void> {
    const request = addNodeRequest?.request
    if (!request) return
    const result = await canvasAuthoring.add(descriptor, request)
    addNodeRequest = null
    if (result.status !== 'committed') workspaceError = result.message
  }

  function requestCanvasDelete(nodeIds: readonly string[]): void {
    const preview = canvasAuthoring.previewDelete(nodeIds)
    if (preview.status === 'rejected') {
      workspaceError = preview.message
      return
    }
    deleteRequest = {
      impact: preview.impact,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    }
  }

  async function confirmCanvasDelete(): Promise<void> {
    const nodeIds = deleteRequest?.impact.nodeIds
    if (!nodeIds) return
    const result = await canvasAuthoring.delete(nodeIds)
    if (result.status === 'committed') deleteRequest = null
    else workspaceError = result.message
  }

  function withCanvasLayoutBarrier<T>(transition: () => Promise<T>): Promise<T> {
    return canvasActivationBarrier.run(transition)
  }

  function disposeApplicationState(): Promise<void> {
    return applicationDisposal.dispose()
  }

  async function refreshRecent(): Promise<void> {
    recent = await actions.recentWorkspaces.list()
  }

  async function openWorkspace(rootPath?: string): Promise<void> {
    await actions.openWorkspace(rootPath)
    await refreshRecent()
  }

  async function refreshWorkspace(): Promise<void> {
    const current = $workspace
    if (!current.id || !current.displayName) return
    loadWorkspaceEntries(current.id, current.displayName, await native.workspaceScan())
  }

  async function activeContractFor(entry: WorkflowPairEntry): Promise<AuthoringContract | undefined> {
    if (contracts.length === 0) return undefined
    if (!entry.companionPath) {
      return activeContractForProfile('hermes-legacy')
    }
    const companion = await native.workspaceRead(entry.companionPath)
    const parsed = parseWorkflowYaml(companion.text, {
      document: 'companion',
      maxBytes: Math.max(...contracts.map(({ limits }) => limits.max_document_bytes)),
    }).parsed
    const value = parsed?.document.toJS({ maxAliasCount: 1_000 })
    const profile =
      value && typeof value === 'object' && 'language_compatibility' in value
        ? value.language_compatibility
        : 'hermes-legacy'
    return activeContractForProfile(profile)
  }

  async function openEntry(entry: WorkflowPairEntry): Promise<void> {
    const requestToken = documentWorkspace.beginActivation()
    await withCanvasLayoutBarrier(async () => {
      await contractReadiness
      const contract = await activeContractFor(entry)
      const workspaceId = $workspace.id
      if (!workspaceId) return
      const opened = await documentWorkspace.activate(workspaceId, entry, contract ?? null, requestToken)
      if (opened) selectWorkspaceEntry(entry.id)
    })
  }

  function analyzeCandidateInWorker(input: {
    definitionText: string
    companionText: string | null
    contract: AuthoringContract
  }): Promise<DocumentAnalysis> {
    if (typeof Worker === 'undefined') {
      return Promise.reject(
        new WorkspaceActionError('analysis_unavailable', 'Document analysis worker is unavailable.'),
      )
    }
    const pair: WorkflowPairText = {
      workflowId: 'candidate',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'candidate:definition',
        kind: 'definition',
        path: 'candidate.yaml',
        text: input.definitionText,
        revision: 0,
        savedRevision: 0,
        diskHash: null,
      },
      companion:
        input.companionText === null
          ? null
          : {
              id: 'candidate:companion',
              kind: 'companion',
              path: 'candidate.hermes.yaml',
              text: input.companionText,
              revision: 0,
              savedRevision: 0,
              diskHash: null,
            },
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/document-worker.ts', import.meta.url), { type: 'module' })
      const client = new DocumentClient(worker, {
        onAnalysis: (analysis) => {
          client.dispose()
          worker.terminate()
          resolve(analysis)
        },
        onError: (error) => {
          client.dispose()
          worker.terminate()
          reject(new WorkspaceActionError(error.code, error.message))
        },
      })
      client.schedule(pair, input.contract, 'explicit-validate')
    })
  }

  function confirmExact(action: 'remove-companion' | 'trash', paths: readonly string[]): Promise<boolean> {
    const verb = action === 'trash' ? 'Move to Trash' : 'Remove companion'
    return Promise.resolve(window.confirm(`${verb} exactly these files?\n\n${paths.join('\n')}`))
  }

  function confirmExportCollision(paths: readonly string[]): Promise<boolean> {
    return new Promise((resolve) => {
      exportConfirmation = { paths, resolve, opener: contextOpener }
    })
  }

  function runWorkspaceOperation(operation: Promise<unknown>): void {
    void operation.catch((error: unknown) => {
      const pathResults =
        error && typeof error === 'object' && 'pathResults' in error && Array.isArray(error.pathResults)
          ? (error.pathResults as readonly { relativePath?: string; status?: string; message?: string }[])
          : []
      workspaceError =
        pathResults.length > 0
          ? pathResults
              .map(
                ({ relativePath, status, message }) =>
                  `${relativePath ?? 'unknown path'}: ${status ?? 'failed'}${message ? ` — ${message}` : ''}`,
              )
              .join('\n')
          : error instanceof Error
            ? error.message
            : 'The workspace action failed.'
    })
  }

  function contextFor(entryId: string): CommandContext {
    const entry = $workspace.entries.find((candidate) => candidate.id === entryId)
    return {
      surface: 'global',
      canMutate: entry?.readOnly === false,
      hasSelection: Boolean(entry),
      targetEntryId: entryId,
      contractAvailable:
        contractsLoaded && contextProfile !== null && activeContractForProfile(contextProfile) !== undefined,
      workflowProfile: contextProfile,
      hasCompanion: entry?.kind === 'workflow' && entry.companionPath !== null,
    }
  }

  const coordinateWorkspaceAction = createWorkspaceActionCoordinator({
    actions,
    getEntry: (id) => $workspace.entries.find((entry) => entry.id === id),
    getWorkspaceId: () => $workspace.id,
    read: (path) => native.workspaceRead(path),
    open: openEntry,
    refresh: refreshWorkspace,
    promptRename: async (entry) => window.prompt('Rename workflow definition to:', entry.definitionPath),
    promptCompanion: async (entry) => {
      if (!contractsLoaded || entry.state !== 'legacy') return null
      const contract = activeContractForProfile('hermes-legacy')
      return contract ? { profile: contract.profile, metadata: {} } : null
    },
    confirm: confirmExact,
    currentDocument: () => documentSessionStore.get(),
    confirmExportCollision,
    presentOutcome: (action, outcome) => {
      if (!outcome || typeof outcome !== 'object' || !('status' in outcome)) return
      const status = (outcome as { status?: unknown }).status
      if (status !== 'partial' && status !== 'blocked') return
      const result = outcome as {
        status: string
        reason?: string
        issues?: readonly { message: string }[]
        results?: readonly { path?: string; relativePath?: string; status?: string; message?: string }[]
      }
      workspaceError = result.results
        ? formatWorkspaceOutcomeResults(result.results)
        : `${action ?? 'Workspace action'} ${result.status}${result.reason ? `: ${result.reason}` : ''}.`
      if (action === 'workflow.export' && status === 'blocked') {
        exportBlockingIssues = result.issues?.map(({ message }) => message) ?? [workspaceError]
      }
    },
  })

  $effect(() => {
    const intent = $workspaceIntent
    if (intent.revision === 0 || intent.revision === handledIntent) return
    handledIntent = intent.revision
    if (intent.kind === 'open-folder') runWorkspaceOperation(openWorkspace())
    else if (intent.kind === 'quick-open') {
      quickOpenOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      quickOpenVisible = true
    } else if (intent.kind?.startsWith('workflow.')) runWorkspaceOperation(coordinateWorkspaceAction(intent))
  })

  $effect.pre(() => {
    activateCanvasWorkflowIdentity($documentSessionStore.pair?.workflowId ?? null)
  })

  $effect(() => {
    const session = $documentSessionStore
    const synchronized = synchronizeEditorProjection(
      {
        workflowId: canvasWorkflowId,
        projection: canvasProjection,
        stale: canvasStale,
        readOnly: canvasStale,
      },
      session,
    )
    canvasWorkflowId = synchronized.workflowId
    canvasProjection = synchronized.projection
    canvasStale = synchronized.stale
  })

  $effect(() => {
    const layout = $activeLayoutStore
    const mode = $activeEditorMode
    if (!layout) {
      restoredLayoutModeIdentity = null
      return
    }
    const identity = `${layout.workspaceId}\0${layout.workflowPath}`
    if (identity !== restoredLayoutModeIdentity) {
      restoredLayoutModeIdentity = identity
      if (mode !== layout.editorMode) showEditorMode(layout.editorMode)
      return
    }
    if (layout.editorMode === mode) return
    void persistCanvasLayout({ ...layout, editorMode: mode, updatedAt: new Date().toISOString() }).catch(
      surfaceCanvasPersistenceError,
    )
  })

  onMount(() => {
    const unbindCanvas = setCanvasCommandHandlers({
      addNode: () => {
        if (graphCanvas) graphCanvas.requestAdd()
        else requestCanvasAdd({ viewportCenter: { x: 0, y: 0 } })
      },
      copySelection: () => {
        const result = canvasAuthoring.copy(canvasSelectionStore.get())
        if (result.status === 'rejected') workspaceError = result.message
      },
      deleteSelection: () => requestCanvasDelete(canvasSelectionStore.get()),
      duplicateSelection: async () => {
        const result = await canvasAuthoring.duplicate(canvasSelectionStore.get())
        if (result.status !== 'committed') workspaceError = result.message
      },
      pasteSelection: async () => {
        const result = await canvasAuthoring.paste()
        if (result.status !== 'committed') workspaceError = result.message
      },
    })
    let dispose: (() => void) | undefined = unbindCanvas
    let disposed = false
    void (async () => {
      const currentWindow = '__TAURI_INTERNALS__' in window ? getCurrentWindow() : null
      if (currentWindow) {
        const unlistenClose = await installWindowCloseLifecycle(currentWindow, disposeApplicationState, (error) => {
          workspaceError = error instanceof Error ? error.message : 'The document lifecycle could not be flushed.'
        })
        if (disposed) {
          unlistenClose()
          return
        }
        const disposeCanvas = dispose
        dispose = () => {
          unlistenClose()
          disposeCanvas?.()
        }
      }
      await contractReadiness
      if (disposed) return
      await documentWorkspace.start()
      if (disposed) return
      const unbindSave = setDocumentSaveHandler(async () => {
        await documentWorkspace.save()
      })
      const keydown = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          runWorkspaceOperation(
            runCommand('document.save', {
              surface: 'global',
              canMutate: Boolean(documentSessionStore.get().pair),
              hasSelection: false,
            }),
          )
        }
      }
      window.addEventListener('keydown', keydown)
      const disposeClose = dispose
      dispose = () => {
        unbindSave()
        window.removeEventListener('keydown', keydown)
        disposeClose?.()
      }
      await refreshRecent()
      if (disposed) return
      try {
        await actions.handleStartupPaths()
      } catch (error: unknown) {
        workspaceError = error instanceof Error ? error.message : 'The startup workflow could not be opened.'
      }
      if (disposed || !currentWindow) return
      const disposeDragDrop = await currentWindow.onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return
        for (const path of event.payload.paths) runWorkspaceOperation(actions.handleExternalPath(path))
      })
      if (disposed) {
        disposeDragDrop()
        return
      }
      const disposeLifecycle = dispose
      dispose = () => {
        disposeDragDrop()
        disposeLifecycle?.()
      }
    })()
    return () => {
      disposed = true
      dispose?.()
    }
  })

  onDestroy(() => {
    exportConfirmation?.resolve(false)
    applicationDisposal.unmount()
  })
</script>

<svelte:head>
  <title>{brand.displayName}</title>
</svelte:head>

<main class="application-shell">
  <header class="titlebar">
    <div class="brand-lockup">
      <img src={brandMarkUrl} alt="" />
      <div class="title-copy">
        <p class="eyebrow">LOOP24</p>
        <h1 aria-label={brand.displayName}>Workflow Studio</h1>
      </div>
    </div>
    <div class="title-actions">
      <button
        type="button"
        disabled={!contractsLoaded || contracts.length === 0}
        onclick={(event) => {
          newDialogOpener = event.currentTarget
          newDialogVisible = true
        }}>New Workflow</button
      >
      <button type="button" class="open-folder" onclick={() => runCommand('workspace.open-folder')}>Open Folder</button>
    </div>
  </header>

  {#if contractsLoaded && contracts.length === 0}
    <p class="contract-unavailable" aria-live="polite">
      No validated production authoring contract is bundled. Contract-dependent creation and import are disabled.
    </p>
  {/if}
  {#if workspaceError}
    <p class="workspace-error" role="alert">{workspaceError}</p>
  {/if}

  <div class="workbench">
    <ActivityRail />
    <aside class="panel left-panel" aria-label="Workspace panel">
      {#if $activeActivity === 'explorer' && $workspace.id !== null}
        <Explorer
          contractAvailable={contractsLoaded && contracts.length > 0}
          onOpen={(entry) => entry.kind === 'workflow' && runWorkspaceOperation(openEntry(entry))}
          onContext={(entry) => {
            contextEntryId = entry.id
            contextOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
            contextProfile = entry.state === 'legacy' ? 'hermes-legacy' : null
            if (entry.kind === 'workflow' && entry.companionPath) {
              void contractReadiness
                .then(() => activeContractFor(entry))
                .then((contract) => {
                  if (contextEntryId === entry.id) contextProfile = contract?.profile ?? null
                })
            }
          }}
          onNew={(opener) => {
            newDialogOpener = opener
            newDialogVisible = true
          }}
          onImport={(opener) => {
            importDialogOpener = opener
            importDialogVisible = true
          }}
        />
      {:else if $activeActivity === 'settings'}
        {#if contractsLoaded && appContractCache}
          <ContractSettingsHost
            cache={appContractCache}
            {native}
            confirmUnsupported={() =>
              Promise.resolve(window.confirm('Cache this unsupported contract for inspection only?'))}
            onContractsChanged={synchronizeContractRegistry}
          />
        {:else}
          <p>Loading bundled contracts…</p>
        {/if}
      {:else if $activeActivity === 'documentation'}
        {#if documentationIndex}
          <DocumentationView
            index={documentationIndex}
            topicId={documentationNavigationRequest?.topicId}
            navigationRequestId={documentationNavigationRequest?.id}
            onTopicConsumed={(_id, requestId) => {
              if (requestId !== undefined && documentationNavigationRequest?.id === requestId) {
                documentationNavigationRequest = undefined
              }
            }}
            onOpenExternal={(url) => window.open(url, '_blank', 'noopener')}
          />
        {:else}
          <p class="documentation-unavailable" role="status">Documentation is unavailable for the active contract.</p>
        {/if}
      {/if}
    </aside>
    <section class="editor-column" aria-label="Workflow workspace">
      <div class="editor-tabs" role="group" aria-label="Editor mode">
        {#each editorModes as mode (mode.id)}
          <button
            type="button"
            aria-pressed={$activeEditorMode === mode.id}
            class:active={$activeEditorMode === mode.id}
            onclick={() => runCommand(`view.editor.${mode.id}`)}
          >
            {mode.label}
          </button>
        {/each}
      </div>
      <section class="editor-region" aria-label="Workflow editor">
        {#if $workspace.id === null}
          <OpenWorkspace
            {recent}
            onOpen={(rootPath) => runWorkspaceOperation(openWorkspace(rootPath))}
            onDropPath={(path) => runWorkspaceOperation(actions.handleExternalPath(path))}
          />
        {:else}
          <div
            class="editor-surfaces"
            class:split={$activeEditorMode === 'split'}
            class:yaml-only={$activeEditorMode === 'yaml'}
            class:no-canvas={!canvasProjection || !$activeLayoutStore}
          >
            {#if canvasProjection && $activeLayoutStore}
              <div class="canvas-pane">
                <GraphCanvas
                  bind:this={graphCanvas}
                  projection={canvasProjection}
                  layout={$activeLayoutStore}
                  workflowIdentity={`${$workspace.id}\0${$documentSessionStore.pair?.workflowId ?? ''}\0${$documentSessionStore.pair?.definition.path ?? ''}`}
                  transitionLocked={canvasTransitionLocked}
                  issues={$documentSessionStore.analysis?.issues ?? []}
                  stale={canvasStale}
                  readOnly={$workspace.entries.find((entry) => entry.id === $documentSessionStore.pair?.workflowId)
                    ?.readOnly === true}
                  onPersistLayout={persistCanvasLayout}
                  onPersistenceError={surfaceCanvasPersistenceError}
                  onConnect={(source, target) => canvasAuthoring.connect(source, target)}
                  onDisconnect={(source, target) => canvasAuthoring.disconnect(source, target)}
                  onRequestAdd={requestCanvasAdd}
                  onDuplicate={(nodeIds) => canvasAuthoring.duplicate(nodeIds)}
                  onRequestDelete={requestCanvasDelete}
                />
              </div>
            {/if}
            {#if $documentSessionStore.pair && $documentSessionStore.revision}
              <div class="yaml-pane">
                {#key $documentSessionStore.pair.workflowId}
                  <EditorModes
                    pair={$documentSessionStore.pair}
                    revision={$documentSessionStore.revision}
                    analysis={$documentSessionStore.analysis}
                    projection={canvasProjection}
                    mode={$activeEditorMode}
                    syncOrigins={{
                      definition:
                        $documentSyncOriginsStore.definition?.revision ===
                        $documentSessionStore.pair.definition.revision
                          ? $documentSyncOriginsStore.definition.origin
                          : 'unknown',
                      companion:
                        $documentSessionStore.pair.companion &&
                        $documentSyncOriginsStore.companion?.revision === $documentSessionStore.pair.companion.revision
                          ? $documentSyncOriginsStore.companion.origin
                          : 'unknown',
                    }}
                    readOnly={$workspace.entries.find((entry) => entry.id === $documentSessionStore.pair?.workflowId)
                      ?.readOnly === true}
                    onTextChange={editYamlDocument}
                  />
                {/key}
              </div>
            {/if}
          </div>
        {/if}
      </section>
      {#if $documentSessionStore.pair}
        <ProblemsPanel
          issues={$documentSessionStore.analysis?.issues ?? []}
          paths={{
            definition: $documentSessionStore.pair.definition.path,
            companion: $documentSessionStore.pair.companion?.path ?? null,
          }}
          onDocumentation={(id) => {
            documentationNavigationSequence += 1
            documentationNavigationRequest = { id: documentationNavigationSequence, topicId: id }
            showActivity('documentation')
          }}
        />
        {#if $documentWorkspaceState.analysisError}
          <p class="document-outcome" role="alert">{$documentWorkspaceState.analysisError}</p>
        {/if}
        {#if $documentWorkspaceState.missingChange}
          <div class="document-outcome" role="alert">
            <p>
              {$documentWorkspaceState.missingChange.dirty ? 'Unsaved workflow' : 'Workflow'} file missing after external
              {$documentWorkspaceState.missingChange.kind}: {$documentWorkspaceState.missingChange.paths.join(', ')}.
            </p>
            <div class="missing-actions">
              <button type="button" onclick={() => runWorkspaceOperation(documentWorkspace.recreateMissing())}
                >Keep Mine / Recreate</button
              >
              <button
                type="button"
                onclick={() => runWorkspaceOperation(withCanvasLayoutBarrier(() => documentWorkspace.closeMissing()))}
                >Close and Recover Later</button
              >
            </div>
          </div>
        {/if}
        {#if $documentWorkspaceState.saveOutcome?.status === 'blocked'}
          <p class="document-outcome" role="alert">
            Save blocked: {$documentWorkspaceState.saveOutcome.reason}.
            {$documentWorkspaceState.saveOutcome.issues.map(({ message }) => message).join(' ')}
          </p>
        {:else if $documentWorkspaceState.saveOutcome?.status === 'partial'}
          <p class="document-outcome" role="alert">
            Save partially completed.
            {[
              $documentWorkspaceState.saveOutcome.results.definition,
              $documentWorkspaceState.saveOutcome.results.companion,
            ]
              .filter((result) => result?.status === 'failed')
              .map((result) => `${result?.path}: ${result?.message ?? result?.errorCode ?? 'failed'}`)
              .join(' ')}
          </p>
        {/if}
      {/if}
    </section>
    <aside class="panel inspector-panel" aria-label="Inspector">
      <Inspector
        fields={inspectorFields}
        values={inspectorValues}
        selectionLabel={inspectorNodes.length === 1
          ? (inspectorNodes[0]?.id ?? 'Node')
          : inspectorNodes.length === 0
            ? 'Workflow'
            : `${inspectorNodes.length} nodes`}
        selectionCount={inspectorNodes.length}
        selectionNodeId={inspectorNodes[0]?.id}
        bindingIdentity={inspectorBindingIdentity}
        issues={$documentSessionStore.analysis?.issues ?? []}
        disabledReason={inspectorDisabledReason}
        documentationIndex={documentationIndex ?? undefined}
        documentationTopicId={inspectorDocumentationTopicId}
        onDocumentationTopic={(id) => (inspectorDocumentationTopicId = id)}
        onCommit={commitInspectorField}
      />
    </aside>
  </div>

  <StatusBar />
  {#if quickOpenVisible}
    <QuickOpen
      entries={$workspace.entries}
      opener={quickOpenOpener}
      onOpen={(entry) => {
        quickOpenVisible = false
        if (entry.kind === 'workflow') runWorkspaceOperation(openEntry(entry))
      }}
      onClose={() => (quickOpenVisible = false)}
    />
  {/if}
  {#if $documentWorkspaceState.conflict}
    <ExternalChangeDialog
      files={[
        {
          relativePath: $documentWorkspaceState.conflict.disk.relativePath,
          modifiedAt: $documentWorkspaceState.conflict.disk.modifiedAt,
        },
      ]}
      diffViewed={$documentWorkspaceState.conflict.diffViewed}
      onChoice={(choice) => documentWorkspace.resolveConflict(choice)}
    />
  {/if}
  {#if $documentWorkspaceState.recoveryOffers[0]}
    <div class="recovery-offer" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="recovery-title">
      <h2 id="recovery-title">Recover unsaved workflow?</h2>
      <p>{$documentWorkspaceState.recoveryOffers[0].definition.path}</p>
      <button type="button" onclick={() => documentWorkspace.recoverDraft($documentWorkspaceState.recoveryOffers[0]!)}
        >Recover</button
      >
      <button
        type="button"
        onclick={() => void documentWorkspace.discardRecovery($documentWorkspaceState.recoveryOffers[0]!.workflowId)}
        >Discard</button
      >
    </div>
  {/if}
  {#if contextEntryId}
    <div class="context-layer">
      <WorkflowContextMenu
        commands={listCommands()}
        opener={contextOpener}
        context={contextFor(contextEntryId)}
        onRun={async (id) => {
          const targetEntryId = contextEntryId!
          const context = contextFor(targetEntryId)
          contextEntryId = null
          await runCommand(id, context)
        }}
        onClose={() => (contextEntryId = null)}
      />
    </div>
  {/if}
  {#if newDialogVisible && contracts.length > 0}
    <NewWorkflowDialog
      {contracts}
      activeContract={activeContractForProfile}
      opener={newDialogOpener}
      onCancel={() => (newDialogVisible = false)}
      onCreate={async (input) => {
        const outcome = await actions.createWorkflow(input)
        await refreshWorkspace()
        if (outcome.status === 'completed') newDialogVisible = false
        else
          workspaceError = outcome.results
            .map(({ path, status, message }) => `${path}: ${status}${message ? ` — ${message}` : ''}`)
            .join('\n')
      }}
    />
  {/if}
  {#if importDialogVisible && activeContractForProfile('archon-2026-07')}
    <ImportExportDialog
      mode="import"
      opener={importDialogOpener}
      onCancel={() => (importDialogVisible = false)}
      onConfirm={async () => {
        const outcome = await actions.importWorkflow({ profile: 'archon-2026-07' })
        await refreshWorkspace()
        if (outcome.status !== 'partial') importDialogVisible = false
        else
          workspaceError = outcome.results
            .map(({ path, status, message }) => `${path}: ${status}${message ? ` — ${message}` : ''}`)
            .join('\n')
      }}
    />
  {/if}
  {#if exportBlockingIssues.length > 0}
    <ImportExportDialog
      mode="export"
      blockingIssues={exportBlockingIssues}
      opener={contextOpener}
      onCancel={() => (exportBlockingIssues = [])}
    />
  {/if}
  {#if exportConfirmation}
    <ImportExportDialog
      mode="export"
      paths={exportConfirmation.paths}
      collision={true}
      opener={exportConfirmation.opener}
      onCancel={() => {
        exportConfirmation?.resolve(false)
        exportConfirmation = null
      }}
      onConfirm={() => {
        exportConfirmation?.resolve(true)
        exportConfirmation = null
      }}
    />
  {/if}
  {#if addNodeRequest && canvasProjection}
    <AddNodePicker
      descriptors={contracts.find(
        (contract) =>
          contract.contract_digest === $documentSessionStore.revision?.contractDigest &&
          contract.profile === canvasProjection?.profile,
      )?.node_kinds ?? []}
      profile={canvasProjection.profile}
      opener={addNodeRequest.opener}
      onChoose={chooseCanvasNode}
      onClose={() => (addNodeRequest = null)}
    />
  {/if}
  {#if deleteRequest}
    <DeleteImpactDialog
      impact={deleteRequest.impact}
      opener={deleteRequest.opener}
      onCancel={() => (deleteRequest = null)}
      onConfirm={confirmCanvasDelete}
    />
  {/if}
</main>

<style>
  .application-shell {
    display: grid;
    gap: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    max-width: none;
    min-height: 100vh;
    align-content: stretch;
    padding: 0;
    overflow: hidden;
    color: var(--color-text);
    background: var(--color-background);
  }

  .contract-unavailable,
  .workspace-error {
    position: fixed;
    z-index: 45;
    right: 1rem;
    bottom: 2.25rem;
    max-width: 28rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-warning);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .workspace-error {
    border-color: var(--color-danger);
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
    padding: 0.5rem 0.875rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-yaml-gutter);
    box-shadow: 0 0.75rem 2.5rem var(--color-shadow);
  }

  .brand-lockup {
    display: flex;
    gap: 0.625rem;
    align-items: center;
  }

  .title-actions {
    display: flex;
    gap: 0.5rem;
  }

  .brand-lockup img {
    width: 2rem;
    height: 2rem;
    object-fit: contain;
    object-position: left center;
  }

  .title-copy {
    padding-left: 0.625rem;
    border-left: 1px solid var(--color-border);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-accent);
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.2;
  }

  .open-folder,
  .editor-tabs button {
    min-height: 2rem;
    border-radius: 0.375rem;
    cursor: pointer;
  }

  .open-folder {
    padding: 0.375rem 0.625rem;
    border: 1px solid var(--color-edge);
    color: var(--color-accent-contrast);
    background: var(--color-accent);
  }

  .workbench {
    display: grid;
    grid-template-columns: 3rem minmax(10rem, 16.875rem) minmax(0, 1fr) minmax(11rem, 18.875rem);
    min-height: 0;
  }

  .panel {
    min-width: 0;
    background: var(--color-surface);
  }

  .left-panel {
    border-right: 1px solid var(--color-border);
  }

  .inspector-panel {
    border-left: 1px solid var(--color-border);
  }

  .editor-column {
    display: grid;
    grid-template-rows: 2.625rem minmax(0, 1fr);
    min-width: 0;
    background: var(--color-canvas);
  }

  .editor-tabs {
    display: flex;
    gap: 0.1875rem;
    align-items: center;
    padding: 0 0.625rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  .editor-tabs button {
    padding: 0.25rem 0.625rem;
    border: 1px solid transparent;
    color: var(--color-text-muted);
    background: transparent;
  }

  .editor-tabs button.active {
    border-color: var(--color-edge);
    color: var(--color-accent-strong);
    background: var(--color-node-selected);
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }

  .editor-region {
    display: grid;
    position: relative;
    min-width: 0;
    min-height: 0;
    background-color: var(--color-canvas);
    background-image: radial-gradient(var(--color-grid) 1px, transparent 1px);
    background-size: 1.25rem 1.25rem;
  }

  .editor-surfaces,
  .canvas-pane,
  .yaml-pane {
    display: grid;
    min-width: 0;
    min-height: 0;
  }

  .editor-surfaces {
    grid-template-columns: minmax(0, 1fr);
  }

  .editor-surfaces.split:not(.no-canvas) {
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.72fr);
  }

  .editor-surfaces.split:not(.no-canvas) .yaml-pane {
    border-left: 1px solid var(--color-border);
  }

  .editor-surfaces:not(.split):not(.yaml-only) .yaml-pane,
  .editor-surfaces.yaml-only .canvas-pane {
    display: none;
  }

  .editor-surfaces.yaml-only .yaml-pane,
  .editor-surfaces.split.no-canvas .yaml-pane {
    grid-column: 1;
  }

  .context-layer {
    position: fixed;
    z-index: 40;
    top: 8rem;
    left: 17rem;
  }
</style>
