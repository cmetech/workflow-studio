<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import {
    commandRegistry,
    setCanvasCommandHandlers,
    setDocumentCommandHandlers,
    setDocumentHistoryHandlers,
    setDocumentSaveHandler,
    type CommandSurface,
  } from '$src/lib/commands/registry'
  import { resolveCommand } from '$src/lib/commands/surface'
  import { dispatchKeybinding } from '$src/lib/commands/keybindings'
  import { NodeChordController, type NodeChordKind, type NodeChordState } from '$src/lib/commands/node-chords'
  import type { ActivityId, CommandContext, CommandHandlerResult, EditorMode } from '$src/lib/commands/types'
  import { resolveThemeMode } from '$src/lib/branding/load-brand'
  import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
  import { createExampleCopy, loadExampleCatalog } from '$src/lib/examples/load-examples'
  import type { ExampleDescriptor } from '$src/lib/examples/types'
  import { buildDocumentationIndex } from '$src/lib/docs/build-index'
  import type { DocumentationGuide, DocumentationIndex } from '$src/lib/docs/types'
  import { createContractCache, type ContractCache, type ContractCacheAdvisory } from '$src/lib/contract/contract-cache'
  import ContractSettingsHost from '$src/features/settings/ContractSettingsHost.svelte'
  import AboutView from '$src/features/settings/AboutView.svelte'
  import BrandSettings from '$src/features/branding/BrandSettings.svelte'
  import BrandPreview from '$src/features/branding/BrandPreview.svelte'
  import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
  import { collectContractFields, fieldsForNode, materializeFormFields } from '$src/lib/forms/widget-registry'
  import type { FormField, FormFieldCommit } from '$src/lib/forms/types'
  import { applyWorkflowMutation } from '$src/lib/documents/transactions'
  import type { WorkflowMutation } from '$src/lib/yaml/mutations'
  import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
  import {
    activeActivity,
    activeEditorMode,
    commandPaletteOpen,
    inspectorPanelOpen,
    isPageActivity,
    keyboardShortcutsOpen,
    openInspectorPanel,
    resolveWorkbenchSurface,
    returnToWorkflow,
    showActivity,
    showEditorMode,
    workspacePanelOpen,
    workspaceIntent,
    closeCommandPalette,
    closeKeyboardShortcuts,
  } from '$src/stores/shell'
  import { loadWorkspaceEntries, workspace } from '$src/stores/workspace'
  import { selectWorkspaceEntry } from '$src/stores/workspace'
  import { getNativeBridge } from '$src/lib/native/bridge'
  import { createSetupController } from '$src/lib/progress/setup-controller'
  import type { ProgressState } from '$src/lib/progress/types'
  import { createBrandController, themePreference } from '$src/stores/branding'
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'
  import type { WorkflowPairEntry } from '$src/lib/workspace/types'
  import { createLayoutStore, LayoutPersistenceController } from '$src/lib/layout/layout-store'
  import { clampDockedPanels, resolveWorkbenchPresentation } from '$src/lib/layout/workbench-layout'
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
  import { isAnalysisCurrent } from '$src/lib/documents/revisions'
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
  import { canvasCapacityForProjection } from '$src/features/canvas/project-canvas'
  import AddNodePicker from '$src/features/canvas/AddNodePicker.svelte'
  import NodePalette from '$src/features/canvas/NodePalette.svelte'
  import { nodeKindAvailable } from '$src/features/canvas/node-kind-options'
  import CommandPalette from '$src/features/commands/CommandPalette.svelte'
  import KeyboardShortcuts from '$src/features/commands/KeyboardShortcuts.svelte'
  import DeleteImpactDialog from '$src/features/canvas/DeleteImpactDialog.svelte'
  import Inspector from '$src/features/inspector/Inspector.svelte'
  import DocumentationView from '$src/features/documentation/DocumentationView.svelte'
  import ExampleGallery from '$src/features/examples/ExampleGallery.svelte'
  import GitView from '$src/features/version-control/GitView.svelte'
  import SetupOverlay from '$src/features/setup/SetupOverlay.svelte'
  import UpdateOverlay from '$src/features/updates/UpdateOverlay.svelte'
  import { createUpdateController } from '$src/lib/updates/update-api'
  import type { UpdateState } from '$src/lib/updates/types'
  import type { HostInfo } from '$src/lib/native/types'
  import { publishUpdateState } from '$src/stores/updates'
  import type { GitPairPaths, GitPairSnapshot } from '$src/lib/git/types'
  import {
    createVersion,
    loadHistoricalPairAsDraft,
    pairIsSavedCurrentValid,
    refreshAfterVersion,
    type CreateVersionOutcome,
  } from '$src/lib/git/version-actions'
  import { createGitInspectionController, gitState, synchronizeGitLifecycle } from '$src/stores/git'
  import EditorModes from '$src/features/editor/EditorModes.svelte'
  import { applyAuthoritativeEditorText, synchronizeEditorProjection } from '$src/features/editor/editor-extensions'
  import type { NodeKindDescriptor } from '$src/lib/contract/types'
  import { renameNode, type CanvasActionContext, type DeleteImpact } from '$src/features/canvas/canvas-actions'
  import { createCanvasAuthoringCoordinator } from '$src/features/canvas/canvas-authoring-coordinator'
  import {
    $canvasPositions as canvasPositionsStore,
    $canvasSelection as canvasSelectionStore,
    activateCanvasWorkflowIdentity,
    setCanvasSelection,
  } from '$src/stores/canvas'
  import { historyStore, recordTransaction, redoTransaction, undoTransaction } from '$src/stores/history'
  import { createCanvasActivationBarrier } from '$src/features/canvas/canvas-activation-barrier'
  import ActivityRail from './ActivityRail.svelte'
  import ActivityPage from './ActivityPage.svelte'
  import StatusBar from './StatusBar.svelte'
  import X from 'lucide-svelte/icons/x'
  import { createApplicationDisposal, disposeApplicationResources } from './application-disposal'
  import { installWindowCloseLifecycle } from './window-close-lifecycle'

  const globalContext: CommandContext = {
    surface: 'global',
    setupReady: false,
    canMutate: false,
    hasSelection: false,
  }

  interface Props {
    commandSurface?: CommandSurface
  }
  let { commandSurface = commandRegistry }: Props = $props()

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
  const native = getNativeBridge()
  let setupProgress = $state.raw<ProgressState | null>(null)
  let resolveSetupReadiness!: () => void
  let setupReady = $state(false)
  const setupReadiness = new Promise<void>((resolve) => {
    resolveSetupReadiness = resolve
  })
  function markSetupReady(): void {
    if (setupReady) return
    setupReady = true
    globalContext.setupReady = true
    resolveSetupReadiness()
    void initializeUpdates()
  }
  const setupController = createSetupController(native, {
    onState: (state) => {
      setupProgress = state
    },
    onReady: markSetupReady,
    onError: (error) => {
      workspaceError = error instanceof Error ? error.message : 'Application setup could not be completed.'
    },
  })
  setupProgress = setupController.state()
  let updateProgress = $state.raw<UpdateState | null>(null)
  let startupCheckEnabled = $state(true)
  let hostInfo = $state.raw<HostInfo | null>(null)
  let updateInitialization: Promise<void> | null = null
  const updateController = createUpdateController(native, {
    onState: (state) => {
      updateProgress = state
      publishUpdateState(state)
    },
    onPreference: (enabled) => {
      startupCheckEnabled = enabled
    },
    onError: (error) => {
      workspaceError = error instanceof Error ? error.message : 'The update operation could not be completed.'
    },
  })
  updateProgress = updateController.state()
  function initializeUpdates(): Promise<void> {
    if (updateInitialization) return updateInitialization
    updateInitialization = Promise.all([
      native.hostHealth().then((value) => (hostInfo = value)),
      updateController.start(),
    ])
      .then(() => {
        if (updateController.startupCheckEnabled()) void updateController.check(true)
      })
      .catch((error: unknown) => {
        workspaceError = error instanceof Error ? error.message : 'Application update status is unavailable.'
      })
    return updateInitialization
  }
  const brandController = createBrandController(native)
  const brandState = brandController.state
  const gitController = createGitInspectionController(native)
  let gitLifecycleIdentity = ''
  const layoutStore = createLayoutStore(native)
  const recoveryStore = createRecoveryStore(native)
  const recoveryDrafts = new RecoveryDraftController(recoveryStore)
  const draftDigest = `sha256:${'0'.repeat(64)}` as const
  const availableContracts: AuthoringContract[] = []
  let contracts = $state.raw<readonly AuthoringContract[]>([])
  let bundledContracts = $state.raw<readonly AuthoringContract[]>([])
  let examples = $state.raw<readonly ExampleDescriptor[]>([])
  let contractsLoaded = $state(false)
  let appContractCache = $state.raw<ContractCache | null>(null)
  let contractCacheAdvisories = $state.raw<readonly ContractCacheAdvisory[]>([])
  function synchronizeContractRegistry(next: readonly AuthoringContract[]): void {
    availableContracts.splice(0, availableContracts.length, ...next)
    contracts = next
  }
  function activeContractForProfile(profile: 'hermes-legacy' | 'archon-2026-07'): AuthoringContract | undefined {
    return appContractCache?.activeContract(profile)
  }
  const contractReadiness = loadBundledAuthoringContracts().then(async (loaded) => {
    bundledContracts = loaded
    appContractCache = createContractCache({
      bundled: loaded,
      native,
      activate: (contract) => documentWorkspace.activateContract(contract),
    })
    synchronizeContractRegistry(appContractCache.listAuthoringContracts())
    try {
      await appContractCache.hydrate()
    } finally {
      synchronizeContractRegistry(appContractCache.listAuthoringContracts())
      contractCacheAdvisories = appContractCache.listAdvisories()
      contractsLoaded = true
    }
    return loaded
  })
  const examplesReadiness = loadExampleCatalog().then((loaded) => {
    examples = loaded
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
  let brandPreviewId = $state<string | null>(null)
  let brandPreviewOpener = $state<HTMLElement | undefined>()
  let exportBlockingIssues = $state<readonly string[]>([])
  let nodeChordState = $state.raw<NodeChordState>({ pending: false, choices: [], afterSelection: false })
  let inspectorDocumentationTopicId = $state<string | undefined>()
  let documentationNavigationRequest = $state<{ readonly id: number; readonly topicId: string } | undefined>()
  let exampleDocumentationProfile = $state<WorkflowProfile | undefined>()
  let documentationNavigationSequence = 0
  let canvasProjection = $state.raw<WorkflowProjection | null>(null)
  let canvasWorkflowId = $state<string | null>(null)
  let canvasStale = $state(false)
  let canvasReadOnly = $state(false)
  let canvasStaleSource = $state<'current' | 'retained' | null>(null)
  let canvasTransitionLocked = $state(false)
  let graphCanvas = $state<ReturnType<typeof GraphCanvas> | null>(null)
  let editorModesHost = $state<ReturnType<typeof EditorModes> | null>(null)
  let workbenchHost = $state<HTMLDivElement>()
  let editorColumnHost = $state<HTMLElement>()
  let workspacePanelHost = $state<HTMLElement>()
  let inspectorPanelHost = $state<HTMLElement>()
  let workbenchWidth = $state(1280)
  let editorWidth = $state(720)
  let compactSplitPane = $state<'canvas' | 'yaml'>('canvas')
  let workspacePanelOpener = $state<HTMLElement | undefined>()
  let pageOpener = $state<HTMLElement | undefined>()
  let inspectorDrawerOwner = $state<
    { readonly kind: 'explicit'; readonly opener: HTMLElement | undefined } | { readonly kind: 'resize' } | undefined
  >()
  type DrawerEscapeSnapshot =
    | { readonly panel: 'workspace' }
    | {
        readonly panel: 'inspector'
        readonly restorationTarget: HTMLElement | undefined
        readonly selectedNode: HTMLElement | undefined
      }
  let previousPanelPresentation: 'docked' | 'drawers' = 'docked'
  let previousSplitPresentation: 'side-by-side' | 'tabs' = 'side-by-side'
  let panelPresentationMeasured = false
  let splitPresentationMeasured = false
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
    activeContractForProfile,
  })
  const canvasAuthoring = createCanvasAuthoringCoordinator({ getContext: canvasAuthoringContext })
  const nodeChords = new NodeChordController({
    onStateChange: (state) => (nodeChordState = state),
    onChoose: (kind, afterSelection) => chooseCanvasChord(kind, afterSelection),
  })
  const actions = createWorkspaceActions({
    native,
    setupReady: () => setupReady,
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

  const editorModes: readonly EditorMode[] = ['visual', 'split', 'yaml']
  const inspectorPanelId = 'workflow-inspector'

  const canvasActivationBarrier = createCanvasActivationBarrier({
    getCanvas: () => graphCanvas,
    setLocked: (locked) => {
      canvasTransitionLocked = locked
    },
    settle: tick,
    onPersistenceError: surfaceCanvasPersistenceError,
  })
  const applicationDisposal = createApplicationDisposal(async () => {
    setupController.dispose()
    updateController.dispose()
    await disposeApplicationResources(
      () => gitController.dispose(),
      () => withCanvasLayoutBarrier(() => documentWorkspace.dispose()),
    )
  }, surfaceCanvasPersistenceError)

  const activeRuntimeBrand = $derived.by(() => {
    const fallback = $brandState.packs[0]
    if (!fallback) throw new Error('The bundled LOOP24 brand is unavailable.')
    return $brandState.packs.find(({ manifest }) => manifest.id === $brandState.activeId) ?? fallback
  })
  const previewRuntimeBrand = $derived($brandState.packs.find(({ manifest }) => manifest.id === brandPreviewId) ?? null)
  const workbenchSurface = $derived(resolveWorkbenchSurface($activeActivity, $workspace.id !== null))
  const authoringHidden = $derived(workbenchSurface !== 'authoring')
  const workbenchPresentation = $derived(resolveWorkbenchPresentation(workbenchWidth, editorWidth))
  const clampedPanels = $derived(
    clampDockedPanels($activeLayoutStore?.panels ?? { left: 280, right: 320, problems: 180 }, workbenchWidth),
  )
  const workspacePanelHidden = $derived(
    authoringHidden || (workbenchPresentation.panels === 'drawers' && !$workspacePanelOpen),
  )
  const inspectorPanelHidden = $derived(
    authoringHidden || (workbenchPresentation.panels === 'drawers' && !$inspectorPanelOpen),
  )
  let authoringWasHidden = false
  let authoringScrollSnapshot: readonly {
    readonly element: HTMLElement
    readonly top: number
    readonly left: number
  }[] = []

  function captureAuthoringScroll(): void {
    const roots = [workspacePanelHost, editorColumnHost, inspectorPanelHost].filter(
      (element): element is HTMLElement => element !== undefined,
    )
    authoringScrollSnapshot = roots
      .flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>('*')])
      .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
      .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }))
  }

  function restoreAuthoringScroll(): void {
    for (const { element, top, left } of authoringScrollSnapshot) {
      if (!element.isConnected) continue
      element.scrollTop = top
      element.scrollLeft = left
    }
  }

  $effect.pre(() => {
    const hidden = authoringHidden
    if (hidden && !authoringWasHidden) captureAuthoringScroll()
    authoringWasHidden = hidden
  })

  $effect(() => {
    const hidden = authoringHidden
    if (authoringScrollSnapshot.length === 0) return
    restoreAuthoringScroll()
    const frame = requestAnimationFrame(() => {
      restoreAuthoringScroll()
      if (!hidden) authoringScrollSnapshot = []
    })
    return () => cancelAnimationFrame(frame)
  })

  $effect.pre(() => {
    const panelPresentation = workbenchPresentation.panels
    const splitPresentation = workbenchPresentation.split
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panelPresentationChanged = panelPresentationMeasured && previousPanelPresentation !== panelPresentation

    if (panelPresentationChanged && panelPresentation === 'docked') {
      workspacePanelOpener = undefined
      inspectorDrawerOwner = undefined
    }

    if (panelPresentationChanged && panelPresentation === 'drawers' && focused) {
      if (workspacePanelHost?.contains(focused)) workspacePanelOpen.set(true)
      else if (inspectorPanelHost?.contains(focused)) {
        inspectorDrawerOwner = { kind: 'resize' }
        inspectorPanelOpen.set(true)
      }
    }
    if (
      splitPresentationMeasured &&
      previousSplitPresentation !== splitPresentation &&
      splitPresentation === 'tabs' &&
      $activeEditorMode === 'split' &&
      focused
    ) {
      if (focused.closest('.yaml-pane')) compactSplitPane = 'yaml'
      else if (focused.closest('.canvas-pane')) compactSplitPane = 'canvas'
    }

    previousPanelPresentation = panelPresentation
    previousSplitPresentation = splitPresentation
  })

  const inspectorContract = $derived(
    contracts.find(
      (candidate) =>
        candidate.contract_digest === $documentSessionStore.revision?.contractDigest &&
        candidate.profile === canvasProjection?.profile,
    ),
  )
  const canvasCapacity = $derived(canvasProjection ? canvasCapacityForProjection(canvasProjection) : null)
  const nodesPaletteDisabled = $derived(nodesPaletteDisabledReason())
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
  const activeDocumentDocumentationContract = $derived(
    contracts.find((candidate) => candidate.contract_digest === $documentSessionStore.revision?.contractDigest),
  )
  const activeDocumentDocumentationIndex = $derived.by<DocumentationIndex | null>(() =>
    activeDocumentDocumentationContract
      ? buildDocumentationIndex(activeDocumentDocumentationContract, bundledGuides)
      : null,
  )
  const exampleDocumentationContract = $derived(
    exampleDocumentationProfile
      ? bundledContracts.find((candidate) => candidate.profile === exampleDocumentationProfile)
      : undefined,
  )
  const documentationIndex = $derived.by<DocumentationIndex | null>(() =>
    exampleDocumentationProfile
      ? exampleDocumentationContract
        ? buildDocumentationIndex(exampleDocumentationContract, bundledGuides)
        : null
      : activeDocumentDocumentationIndex,
  )
  const exampleTopicLabels = $derived.by(() =>
    Object.fromEntries(
      bundledContracts.flatMap((contract) =>
        contract.documentation.topics.map((topic) => [`${contract.profile}:${topic.id}`, topic.title]),
      ),
    ),
  )

  function runCommand(id: string, context: CommandContext = globalContext): Promise<void> {
    return commandSurface.executeCommand(id, context).then(() => undefined)
  }

  function keyboardContext(target: EventTarget | null): CommandContext {
    const element = target instanceof Element ? target : null
    const surface: CommandContext['surface'] = element?.closest('.graph-canvas')
      ? 'canvas'
      : element?.closest('.yaml-editor')
        ? 'yaml'
        : element?.closest('input, textarea, select, [contenteditable="true"]')
          ? 'form'
          : 'global'
    const canvasContext = surface === 'canvas' ? canvasAuthoringContext() : null
    const pair = documentSessionStore.get().pair
    const activeEntry = workspace.get().entries.find((entry) => entry.id === pair?.workflowId)
    const documentCanMutate = Boolean(pair && activeEntry?.readOnly === false)
    return {
      surface,
      setupReady,
      canMutate: surface === 'canvas' ? Boolean(canvasContext && !('unavailable' in canvasContext)) : documentCanMutate,
      canValidate: Boolean(pair),
      hasSelection: surface === 'canvas' ? canvasSelectionStore.get().length > 0 : false,
      selectionCount: surface === 'canvas' ? canvasSelectionStore.get().length : 0,
    }
  }

  async function undoDocument(): Promise<void> {
    const pair = documentSessionStore.get().pair
    if (!pair) return
    const result = undoTransaction(historyStore.get(), pair)
    if (!result.ok) {
      workspaceError = result.message
      return
    }
    historyStore.set(result.history)
    documentWorkspace.changed(result.pair, 'visual')
  }

  async function redoDocument(): Promise<void> {
    const pair = documentSessionStore.get().pair
    if (!pair) return
    const result = redoTransaction(historyStore.get(), pair)
    if (!result.ok) {
      workspaceError = result.message
      return
    }
    historyStore.set(result.history)
    documentWorkspace.changed(result.pair, 'visual')
  }

  function findInCurrentSurface(): CommandHandlerResult {
    if (editorModesHost?.openFind()) return { commandPalette: 'close' }
    void runCommand('workbench.command-palette', globalContext)
    return { commandPalette: 'keep-open' }
  }

  function validateCurrentWorkflow(): void {
    const pair = documentSessionStore.get().pair
    if (!pair) return
    workspaceError = documentWorkspace.validateCurrent()
      ? 'Validation scheduled for the current workflow.'
      : 'Validation is unavailable for the current workflow.'
  }

  async function focusInspector(invoker?: HTMLElement): Promise<void> {
    inspectorDrawerOwner =
      workbenchPresentation.panels === 'drawers'
        ? {
            kind: 'explicit',
            opener: invoker?.isConnected
              ? invoker
              : document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined,
          }
        : undefined
    openInspectorPanel()
    await tick()
    const inspector = document.querySelector<HTMLElement>('.inspector-panel .inspector')
    const target =
      inspector?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      inspector?.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )
    target?.focus()
  }

  function currentInspectorRestorationTarget(): HTMLElement | undefined {
    return (
      document.querySelector<HTMLElement>('.svelte-flow__node.selected') ??
      document.querySelector<HTMLElement>(`[aria-controls="${inspectorPanelId}"][aria-expanded="true"]`) ??
      undefined
    )
  }

  async function focusWorkspaceDrawer(opener: HTMLElement | undefined): Promise<void> {
    workspacePanelOpener = opener
    await tick()
    workspacePanelHost?.querySelector<HTMLElement>('.drawer-close')?.focus()
  }

  function rememberActivityOpener(opener: HTMLElement, activity: ActivityId): void {
    if (isPageActivity(activity)) pageOpener = opener
    else workspacePanelOpener = opener
  }

  function rememberPageOpener(opener: HTMLElement | undefined): void {
    if (opener?.isConnected) pageOpener = opener
  }

  async function returnToAuthoringSurface(): Promise<void> {
    const opener = pageOpener
    returnToWorkflow()
    await tick()
    const target = opener?.isConnected
      ? opener
      : document.querySelector<HTMLElement>(`[data-activity="${$activeActivity}"]`)
    target?.focus()
    pageOpener = undefined
  }

  async function closeWorkspaceDrawer(): Promise<void> {
    const target = workspacePanelOpener?.isConnected
      ? workspacePanelOpener
      : document.querySelector<HTMLElement>(`[data-activity="${$activeActivity}"]`)
    workspacePanelOpen.set(false)
    await tick()
    target?.focus()
    workspacePanelOpener = undefined
  }

  async function closeInspectorDrawer(invoker?: HTMLElement): Promise<void> {
    const target = invoker?.isConnected
      ? invoker
      : inspectorDrawerOwner?.kind === 'explicit' && inspectorDrawerOwner.opener?.isConnected
        ? inspectorDrawerOwner.opener
        : currentInspectorRestorationTarget()
    inspectorPanelOpen.set(false)
    await tick()
    if (document.activeElement !== target) target?.focus()
    inspectorDrawerOwner = undefined
  }

  async function closeOpenDrawer(snapshot?: DrawerEscapeSnapshot): Promise<void> {
    if ((snapshot?.panel === 'inspector' || !snapshot) && $inspectorPanelOpen) {
      await closeInspectorDrawer(snapshot?.panel === 'inspector' ? snapshot.restorationTarget : undefined)
    } else if ((snapshot?.panel === 'workspace' || !snapshot) && $workspacePanelOpen) await closeWorkspaceDrawer()
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
      opener:
        document.querySelector<HTMLElement>('.graph-canvas') ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : undefined),
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
    const session = $documentSessionStore
    const currentRepairableDraft = Boolean(
      session.revision &&
      session.analysis?.visuallyAuthorable === true &&
      isAnalysisCurrent(session.revision, session.analysis) &&
      session.analysis.projection === canvasProjection,
    )
    if (canvasStale && !currentRepairableDraft) return 'The YAML projection is stale.'
    if ($documentWorkspaceState.missingChange) return 'A backing YAML file is missing.'
    const entry = $workspace.entries.find(({ id }) => id === $documentSessionStore.pair?.workflowId)
    if (entry?.readOnly) return 'This workflow is read-only.'
    if (
      !inspectorContract ||
      (!$documentSessionStore.analysis?.structurallyValid && !$documentSessionStore.analysis?.visuallyAuthorable)
    ) {
      return 'A current valid authoring contract and YAML projection are required.'
    }
    return undefined
  }

  function nodesPaletteDisabledReason(): string | undefined {
    if (canvasCapacity?.visual === false) return canvasCapacity.advisory
    const context = canvasAuthoringContext()
    return 'unavailable' in context ? context.unavailable : undefined
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
      else {
        setCanvasSelection([commit.value])
        await tick()
        document.querySelector<HTMLElement>('.inspector-panel [role="tab"][aria-selected="true"]')?.focus()
      }
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

    let mutationContract = contract
    if (commit.field.document === 'companion' && path.length === 1 && path[0] === 'language_compatibility') {
      const proposedProfile = commit.remove ? 'hermes-legacy' : commit.value
      if (proposedProfile !== 'hermes-legacy' && proposedProfile !== 'archon-2026-07') {
        workspaceError = 'Choose a supported workflow profile before applying Language compatibility.'
        return
      }
      const proposedContract = activeContractForProfile(proposedProfile)
      if (!proposedContract || proposedContract.profile !== proposedProfile) {
        workspaceError = `Cannot change Language compatibility to ${proposedProfile} because no exact active contract is available. Activate the ${proposedProfile} contract in Settings and try again.`
        return
      }
      if (
        proposedContract.contract_digest !== contract.contract_digest &&
        !(await documentWorkspace.activateContract(proposedContract))
      ) {
        workspaceError = `Cannot change Language compatibility to ${proposedProfile} because its active contract could not be prepared. Reactivate the contract in Settings and try again.`
        return
      }
      mutationContract = proposedContract
    }

    const result = await applyWorkflowMutation(session.pair, mutation, mutationContract)
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

  async function choosePaletteNode(descriptor: NodeKindDescriptor): Promise<void> {
    const position = graphCanvas?.viewportCenterPosition() ?? { x: 0, y: 0 }
    const result = await canvasAuthoring.add(descriptor, { viewportCenter: position })
    if (result.status !== 'committed') workspaceError = result.message
  }

  async function dropPaletteNode(kind: string, position: { readonly x: number; readonly y: number }): Promise<void> {
    const contract = inspectorContract
    const profile = canvasProjection?.profile
    const descriptor = contract?.node_kinds.find((candidate) => candidate.id === kind)
    if (!descriptor || !profile || !nodeKindAvailable(descriptor, profile) || nodesPaletteDisabled) return
    const result = await canvasAuthoring.add(descriptor, { viewportCenter: position })
    if (result.status !== 'committed') workspaceError = result.message
  }

  async function chooseCanvasChord(kind: NodeChordKind, afterSelection: boolean): Promise<void> {
    const contract = inspectorContract
    if (!contract) return
    const descriptor = contract.node_kinds.find((candidate) => candidate.id === kind)
    if (!descriptor) {
      workspaceError = `The active contract does not support ${kind} nodes.`
      return
    }
    const selected = canvasSelectionStore.get()
    const result = await canvasAuthoring.add(descriptor, {
      ...(afterSelection && selected.length === 1 ? { afterNodeId: selected[0] } : {}),
      viewportCenter: { x: 0, y: 0 },
    })
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

  async function runBrandOperation(operation: () => Promise<unknown>): Promise<boolean> {
    try {
      workspaceError = null
      await operation()
      return true
    } catch (error: unknown) {
      workspaceError = error instanceof Error ? error.message : 'The brand operation could not be completed.'
      return false
    }
  }

  async function refreshRecent(): Promise<void> {
    recent = await actions.recentWorkspaces.list()
  }

  async function openWorkspace(rootPath?: string): Promise<void> {
    const selected = await actions.openWorkspace(rootPath)
    if (selected) {
      gitController.reset()
      void refreshGitRepository()
    }
    await refreshRecent()
  }

  async function initializeGitRepository(): Promise<void> {
    const rootPath = workspace.get().rootPath
    if (!rootPath) throw new Error('Select a workspace before initializing Git.')
    await native.gitInit(rootPath)
    await refreshGit()
  }

  async function setRepositoryIdentity(identity: { userName: string; userEmail: string }): Promise<void> {
    const repository = await native.gitDetect()
    if (!repository) throw new Error('Initialize or open a Git repository first.')
    await native.gitSetLocalIdentity(repository.root, identity.userName, identity.userEmail)
    await refreshGit()
  }

  async function createCurrentPairVersion(message: string): Promise<CreateVersionOutcome> {
    const session = documentSessionStore.get()
    const repository = await native.gitDetect()
    if (!session.pair || !repository) throw new Error('Open a workflow in a Git repository first.')
    const result = await createVersion(native, {
      root: repository.root,
      pair: session.pair,
      analysis: session.analysis,
      message,
      authorizationToken: gitState.get().inspection.diff.authorizationToken ?? '',
    })
    if (result.status === 'blocked') {
      throw new Error(
        result.reason === 'message_required'
          ? 'Enter a version message.'
          : result.reason === 'preview_required'
            ? 'Refresh the Git preview before creating a version.'
            : 'Save the current structurally valid YAML before creating a version.',
      )
    }
    return refreshAfterVersion(result, refreshGit)
  }

  async function refreshWorkspace(): Promise<void> {
    const current = $workspace
    if (!current.id || !current.displayName) return
    loadWorkspaceEntries(current.id, current.displayName, await native.workspaceScan(), current.rootPath)
    void refreshGit()
  }

  function activeGitPair(): GitPairPaths | null {
    const pair = documentSessionStore.get().pair
    return pair ? { definitionPath: pair.definition.path, companionPath: pair.companion?.path ?? null } : null
  }

  async function refreshGit(): Promise<void> {
    const pair = activeGitPair()
    await synchronizeGitLifecycle(gitController, { workspaceId: workspace.get().id, pair })
  }

  async function refreshGitRepository(): Promise<void> {
    await gitController.refreshRepository()
  }

  function loadHistoricalGitPair(oid: string): Promise<GitPairSnapshot> {
    const pair = activeGitPair()
    if (!pair) return Promise.reject(new Error('Open a workflow in a Git repository first.'))
    return gitController.loadCommit(oid, pair).then((snapshot) => {
      if (!snapshot) throw new Error('The selected historical preview changed before it loaded.')
      return snapshot
    })
  }

  async function restoreHistoricalGitPair(snapshot: GitPairSnapshot): Promise<void> {
    const session = documentSessionStore.get()
    if (!session.pair || !session.revision) return
    const contract = contracts.find((candidate) => candidate.contract_digest === session.revision?.contractDigest)
    if (!contract) {
      workspaceError = 'The active authoring contract is unavailable for historical restore.'
      return
    }
    const restored = await loadHistoricalPairAsDraft({
      pair: session.pair,
      snapshot,
      apply: async (pair, mutation) => {
        const result = await applyWorkflowMutation(pair, mutation, contract)
        if (!result.ok) throw new Error(result.message)
        return { pair: result.pair, transaction: result.transaction }
      },
    })
    if (restored.transaction) historyStore.set(recordTransaction(historyStore.get(), restored.transaction))
    documentWorkspace.changed(restored.pair, 'user')
  }

  async function handleExternalWorkspacePath(path: string): Promise<void> {
    await actions.handleExternalPath(path)
    gitController.reset()
    void refreshGit()
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

  async function openEntry(
    entry: WorkflowPairEntry,
    requestToken: number = documentWorkspace.beginActivation(),
  ): Promise<void> {
    let didOpen = false
    await withCanvasLayoutBarrier(async () => {
      await contractReadiness
      const contract = await activeContractFor(entry)
      const workspaceId = $workspace.id
      if (!workspaceId) return
      const opened = await documentWorkspace.activate(workspaceId, entry, contract ?? null, requestToken)
      if (opened) {
        didOpen = true
        exampleDocumentationProfile = undefined
        selectWorkspaceEntry(entry.id)
      }
    })
    if (didOpen) void refreshGit()
  }

  async function createEditableExampleCopy(example: ExampleDescriptor): Promise<void> {
    if (!$workspace.id) {
      throw new WorkspaceActionError('workspace_required', 'Open a workspace before creating an example copy.')
    }
    const requestToken = documentWorkspace.beginActivation()
    await contractReadiness
    const contract = activeContractForProfile(example.profile)
    if (!contract)
      throw new WorkspaceActionError('contract_unavailable', 'The example profile contract is unavailable.')
    await createExampleCopy(example, {
      native,
      workspaceId: $workspace.id,
      contract,
      analyze: analyzeCandidateInWorker,
      open: (entry) => openEntry(entry, requestToken),
    })
    await refreshWorkspace()
  }

  function openExampleDocumentation(
    example: ExampleDescriptor,
    topicId: string,
    opener: HTMLButtonElement,
  ): void {
    rememberPageOpener(opener)
    exampleDocumentationProfile = example.profile
    documentationNavigationSequence += 1
    documentationNavigationRequest = { id: documentationNavigationSequence, topicId: `contract:${topicId}` }
    showActivity('documentation')
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
    if (!setupReady) return
    if (intent.kind === 'open-folder') runWorkspaceOperation(openWorkspace())
    else if (intent.kind === 'quick-open') {
      quickOpenOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      quickOpenVisible = true
    } else if (intent.kind?.startsWith('workflow.')) runWorkspaceOperation(coordinateWorkspaceAction(intent))
  })

  $effect(() => {
    const pair = $documentSessionStore.pair
    const workspaceId = $workspace.id
    const identity = `${workspaceId ?? ''}\0${pair?.definition.path ?? ''}\0${pair?.companion?.path ?? ''}`
    if (identity === gitLifecycleIdentity) return
    gitLifecycleIdentity = identity
    void synchronizeGitLifecycle(gitController, {
      workspaceId,
      pair: pair ? { definitionPath: pair.definition.path, companionPath: pair.companion?.path ?? null } : null,
    })
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
        readOnly: canvasReadOnly,
        staleSource: canvasStaleSource,
      },
      session,
    )
    canvasWorkflowId = synchronized.workflowId
    canvasProjection = synchronized.projection
    canvasStale = synchronized.stale
    canvasReadOnly = synchronized.readOnly
    canvasStaleSource = synchronized.staleSource
  })

  $effect(() => {
    if (canvasCapacity && !canvasCapacity.visual && $activeEditorMode !== 'yaml') showEditorMode('yaml')
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
    void setupController.start()
    void brandController.initialize().catch((error: unknown) => {
      workspaceError = error instanceof Error ? error.message : 'The saved brand could not be loaded.'
    })
    const unbindCanvas = setCanvasCommandHandlers({
      addNode: () => {
        if (graphCanvas) graphCanvas.requestAdd()
        else requestCanvasAdd({ viewportCenter: { x: 0, y: 0 } })
      },
      addAfterSelection: () => {
        const selected = canvasSelectionStore.get()
        if (graphCanvas && selected.length === 1) graphCanvas.requestAdd(selected[0])
        else
          requestCanvasAdd({
            ...(selected.length === 1 ? { afterNodeId: selected[0] } : {}),
            viewportCenter: { x: 0, y: 0 },
          })
      },
      selectAll: () => graphCanvas?.selectAll(),
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
      arrange: () => graphCanvas?.arrange(),
      zoomIn: () => graphCanvas?.zoomIn(),
      zoomOut: () => graphCanvas?.zoomOut(),
      actualSize: () => graphCanvas?.actualSize(),
      fitGraph: () => graphCanvas?.fitGraph(),
      fitSelection: () => graphCanvas?.fitSelection(),
      nudge: (larger, direction) => graphCanvas?.nudge(larger, direction),
      openInspector: () => graphCanvas?.openInspector(),
      cancel: () => graphCanvas?.cancel(),
      createEdge: () => graphCanvas?.requestEdge(),
    })
    let resizeFrame: number | null = null
    let pendingWorkbenchWidth = workbenchWidth
    let pendingEditorWidth = editorWidth
    let pendingPanelMeasurement = false
    let pendingSplitMeasurement = false
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === workbenchHost) {
          pendingWorkbenchWidth = entry.contentRect.width
          pendingPanelMeasurement = true
        } else if (entry.target === editorColumnHost) {
          pendingEditorWidth = entry.contentRect.width
          pendingSplitMeasurement = true
        }
      }
      if (resizeFrame !== null) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        if (pendingPanelMeasurement && !panelPresentationMeasured) {
          previousPanelPresentation = resolveWorkbenchPresentation(pendingWorkbenchWidth, pendingEditorWidth).panels
          panelPresentationMeasured = true
        }
        if (pendingSplitMeasurement && !splitPresentationMeasured) {
          previousSplitPresentation = resolveWorkbenchPresentation(pendingWorkbenchWidth, pendingEditorWidth).split
          splitPresentationMeasured = true
        }
        pendingPanelMeasurement = false
        pendingSplitMeasurement = false
        workbenchWidth = pendingWorkbenchWidth
        editorWidth = pendingEditorWidth
      })
    })
    if (workbenchHost) {
      const measuredWidth = workbenchHost.getBoundingClientRect().width
      if (measuredWidth > 0) {
        previousPanelPresentation = resolveWorkbenchPresentation(measuredWidth, editorWidth).panels
        panelPresentationMeasured = true
        workbenchWidth = measuredWidth
      }
      resizeObserver.observe(workbenchHost)
    }
    if (editorColumnHost) {
      const measuredWidth = editorColumnHost.getBoundingClientRect().width
      if (measuredWidth > 0) {
        previousSplitPresentation = resolveWorkbenchPresentation(workbenchWidth, measuredWidth).split
        splitPresentationMeasured = true
        editorWidth = measuredWidth
      }
      resizeObserver.observe(editorColumnHost)
    }
    let dispose: (() => void) | undefined = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      unbindCanvas()
    }
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
      await setupReadiness
      if (disposed) return
      await contractReadiness
      await examplesReadiness
      if (disposed) return
      await documentWorkspace.start()
      if (disposed) return
      const unlistenGit = await native.onGitChanged(() => refreshGit())
      if (disposed) {
        unlistenGit()
        return
      }
      const unbindSave = setDocumentSaveHandler(async () => {
        await documentWorkspace.save()
      })
      const unbindHistory = setDocumentHistoryHandlers({ undo: undoDocument, redo: redoDocument })
      const unbindDocumentCommands = setDocumentCommandHandlers({
        find: findInCurrentSurface,
        validate: validateCurrentWorkflow,
      })
      const appEscapeCancellations = () => {
        return [
          ...(nodeChordState.pending ? [{ priority: 100, cancel: () => nodeChords.cancel('escape') }] : []),
          ...($commandPaletteOpen ? [{ priority: 90, cancel: closeCommandPalette }] : []),
          ...($keyboardShortcutsOpen ? [{ priority: 80, cancel: closeKeyboardShortcuts }] : []),
          ...(addNodeRequest ? [{ priority: 70, cancel: () => (addNodeRequest = null) }] : []),
          ...(deleteRequest ? [{ priority: 60, cancel: () => (deleteRequest = null) }] : []),
        ]
      }
      const drawerEscapeSnapshot = (): DrawerEscapeSnapshot | undefined => {
        if (document.querySelector('[aria-modal="true"]') !== null || workbenchPresentation.panels !== 'drawers')
          return undefined
        if ($inspectorPanelOpen) {
          return {
            panel: 'inspector',
            restorationTarget:
              inspectorDrawerOwner?.kind === 'resize' ? currentInspectorRestorationTarget() : undefined,
            selectedNode: document.querySelector<HTMLElement>('.svelte-flow__node.selected') ?? undefined,
          }
        }
        return $workspacePanelOpen ? { panel: 'workspace' } : undefined
      }
      const drawerEscapeSnapshots = new WeakMap<KeyboardEvent, DrawerEscapeSnapshot>()
      const escapeKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        const cancellation = appEscapeCancellations().sort((left, right) => right.priority - left.priority)[0]
        if (cancellation) {
          event.preventDefault()
          event.stopPropagation()
          try {
            void Promise.resolve(cancellation.cancel()).catch((error: unknown) => {
              workspaceError = error instanceof Error ? error.message : 'The keyboard command failed.'
            })
          } catch (error: unknown) {
            workspaceError = error instanceof Error ? error.message : 'The keyboard command failed.'
          }
          return
        }

        const snapshot = drawerEscapeSnapshot()
        if (!snapshot) return
        drawerEscapeSnapshots.set(event, snapshot)
        if (snapshot.panel !== 'inspector' || !snapshot.selectedNode || event.target !== snapshot.selectedNode) return
        event.preventDefault()
        event.stopPropagation()
        void closeOpenDrawer(snapshot).catch((error: unknown) => {
          workspaceError = error instanceof Error ? error.message : 'The keyboard command failed.'
        })
      }
      const keydown = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return
        const drawerSnapshot = event.key === 'Escape' ? drawerEscapeSnapshots.get(event) : undefined
        if (drawerSnapshot) {
          event.preventDefault()
          void closeOpenDrawer(drawerSnapshot).catch((error: unknown) => {
            workspaceError = error instanceof Error ? error.message : 'The keyboard command failed.'
          })
          return
        }
        const context = keyboardContext(event.target)
        const keyboardOpener =
          event.target instanceof HTMLElement
            ? event.target
            : document.activeElement instanceof HTMLElement
              ? document.activeElement
              : undefined
        const workspacePanelWasOpen = $workspacePanelOpen
        if (
          context.surface === 'canvas' &&
          (nodeChordState.pending || (!event.shiftKey && event.key.toLowerCase() === 'n'))
        ) {
          const result = nodeChords.handleKey(event)
          if (result.status !== 'unhandled') {
            event.preventDefault()
            return
          }
        }
        void dispatchKeybinding(event, { registry: commandSurface, context })
          .then(async (result) => {
            if (
              result.status === 'executed' &&
              result.commandId.startsWith('view.activity.') &&
              workbenchPresentation.panels === 'drawers'
            ) {
              if ($workspacePanelOpen) await focusWorkspaceDrawer(keyboardOpener)
              else if (workspacePanelWasOpen) await closeWorkspaceDrawer()
            }
            if (result.status === 'disabled') workspaceError = result.reason
            else if (result.status === 'collision') {
              const labels = result.commandIds.map(
                (id) => commandSurface.listCommands().find((command) => command.id === id)?.label ?? id,
              )
              workspaceError = `Shortcut collision: ${labels.join(', ')}.`
            }
          })
          .catch((error: unknown) => {
            workspaceError = error instanceof Error ? error.message : 'The keyboard command failed.'
          })
      }
      const blur = () => nodeChords.cancel('focus-loss')
      const focusin = (event: FocusEvent) => {
        const target = event.target
        if (nodeChordState.pending && target instanceof Element && !target.closest('.graph-canvas')) {
          nodeChords.cancel('focus-loss')
        }
      }
      window.addEventListener('keydown', escapeKeydown, true)
      window.addEventListener('keydown', keydown)
      window.addEventListener('blur', blur)
      window.addEventListener('focusin', focusin)
      const disposeClose = dispose
      dispose = () => {
        unlistenGit()
        unbindSave()
        unbindHistory()
        unbindDocumentCommands()
        window.removeEventListener('keydown', escapeKeydown, true)
        window.removeEventListener('keydown', keydown)
        window.removeEventListener('blur', blur)
        window.removeEventListener('focusin', focusin)
        disposeClose?.()
      }
      await refreshRecent()
      if (disposed) return
      try {
        await actions.handleStartupPaths()
        if (activeGitPair()) void refreshGit()
        else if ($workspace.id) void refreshGitRepository()
      } catch (error: unknown) {
        workspaceError = error instanceof Error ? error.message : 'The startup workflow could not be opened.'
      }
      if (disposed || !currentWindow) return
      const disposeDragDrop = await currentWindow.onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return
        for (const path of event.payload.paths) runWorkspaceOperation(handleExternalWorkspacePath(path))
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
  <title>{activeRuntimeBrand.manifest.displayName}</title>
</svelte:head>

<main class="application-shell" data-viewport-shell>
  <header class="titlebar">
    <div class="brand-lockup">
      <img src={activeRuntimeBrand.assetUrls.mark} alt="" />
      <div class="title-copy">
        <p class="eyebrow">{activeRuntimeBrand.builtIn ? 'LOOP24' : 'CUSTOM BRAND'}</p>
        <h1 aria-label={activeRuntimeBrand.manifest.displayName}>
          {activeRuntimeBrand.builtIn ? 'Workflow Studio' : activeRuntimeBrand.manifest.displayName}
        </h1>
      </div>
    </div>
    <div class="title-actions">
      <button
        type="button"
        data-variant="primary"
        disabled={!contractsLoaded || contracts.length === 0}
        onclick={(event) => {
          newDialogOpener = event.currentTarget
          newDialogVisible = true
        }}>New Workflow</button
      >
      <button
        type="button"
        class="open-folder"
        data-variant="secondary"
        disabled={!setupReady}
        onclick={() => setupReady && void runCommand('workspace.open-folder')}>Open Folder</button
      >
    </div>
  </header>

  {#if contractsLoaded && contracts.length === 0}
    <p class="contract-unavailable" aria-live="polite">
      No validated production authoring contract is bundled. Contract-dependent creation and import are disabled.
    </p>
  {/if}
  {#if contractCacheAdvisories.length > 0}
    <p class="contract-cache-advisory" role="status" aria-label="Contract cache advisory">
      {contractCacheAdvisories.map(({ message }) => message).join(' ')}
    </p>
  {/if}
  {#if workspaceError}
    <p class="workspace-error" role="alert">{workspaceError}</p>
  {/if}

  <div
    bind:this={workbenchHost}
    class="workbench"
    data-scroll-owner="workbench"
    data-panel-presentation={workbenchPresentation.panels}
    data-split-presentation={workbenchPresentation.split}
    style={`--left-panel-width: ${clampedPanels.left}px; --right-panel-width: ${clampedPanels.right}px`}
  >
    <ActivityRail
      {commandSurface}
      workspacePanelExpanded={workbenchPresentation.panels === 'docked' || $workspacePanelOpen}
      onActivityInvoke={rememberActivityOpener}
    />
    {#if workbenchSurface === 'authoring' && workbenchPresentation.panels === 'drawers' && ($workspacePanelOpen || $inspectorPanelOpen)}
      <button type="button" class="drawer-scrim" aria-label="Close open panels" onclick={() => void closeOpenDrawer()}
      ></button>
    {/if}
    <aside
      bind:this={workspacePanelHost}
      class="panel left-panel"
      class:drawer-open={!workspacePanelHidden}
      hidden={authoringHidden}
      {...(workspacePanelHidden ? { inert: true } : {})}
      aria-label="Workspace panel"
      aria-hidden={workspacePanelHidden ? 'true' : undefined}
    >
      {#if workbenchPresentation.panels === 'drawers'}
        <button
          type="button"
          class="drawer-close"
          data-variant="ghost"
          aria-label="Close workspace panel"
          title="Close workspace panel"
          onclick={() => void closeWorkspaceDrawer()}><X size={16} aria-hidden="true" /></button
        >
      {/if}
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
      {:else if $activeActivity === 'nodes'}
        <NodePalette
          descriptors={inspectorContract?.node_kinds ?? []}
          profile={canvasProjection?.profile ?? inspectorContract?.profile ?? 'hermes-legacy'}
          disabledReason={nodesPaletteDisabled}
          onChoose={choosePaletteNode}
        />
      {/if}
    </aside>
    <section
      bind:this={editorColumnHost}
      class="editor-column"
      aria-label="Workflow workspace"
      hidden={authoringHidden}
      {...(authoringHidden ? { inert: true } : {})}
      aria-hidden={authoringHidden ? 'true' : undefined}
    >
      <div class="editor-tabs" role="group" aria-label="Editor mode">
        {#each editorModes as mode (mode)}
          {@const command = resolveCommand(commandSurface, `view.editor.${mode}`, globalContext)}
          {#if command}
            <button
              type="button"
              data-variant="ghost"
              aria-pressed={$activeEditorMode === mode}
              class:active={$activeEditorMode === mode}
              title={command.title}
              disabled={!command.enabled}
              onclick={() => void commandSurface.executeCommand(command.id, globalContext)}
            >
              {command.label}
            </button>
          {/if}
        {/each}
        {#if $activeEditorMode === 'split' && workbenchPresentation.split === 'tabs'}
          <div class="split-pane-tabs" role="group" aria-label="Split pane">
            <button
              type="button"
              data-variant="ghost"
              aria-pressed={compactSplitPane === 'canvas'}
              class:active={compactSplitPane === 'canvas'}
              onclick={() => (compactSplitPane = 'canvas')}>Canvas</button
            >
            <button
              type="button"
              data-variant="ghost"
              aria-pressed={compactSplitPane === 'yaml'}
              class:active={compactSplitPane === 'yaml'}
              onclick={() => (compactSplitPane = 'yaml')}>YAML</button
            >
          </div>
        {/if}
      </div>
      <section class="editor-region" aria-label="Workflow editor">
        {#if $workspace.id !== null}
          <div
            class="editor-surfaces"
            class:split={$activeEditorMode === 'split'}
            class:split-tabs={$activeEditorMode === 'split' && workbenchPresentation.split === 'tabs'}
            class:yaml-only={$activeEditorMode === 'yaml'}
            class:no-canvas={!canvasProjection || !$activeLayoutStore || canvasCapacity?.visual === false}
            data-split-pane={compactSplitPane}
          >
            {#if canvasCapacity?.advisory}
              <p class="canvas-capacity-advisory" role="status">{canvasCapacity.advisory}</p>
            {/if}
            {#if canvasProjection && $activeLayoutStore && canvasCapacity?.visual !== false}
              <div class="canvas-pane">
                <GraphCanvas
                  bind:this={graphCanvas}
                  {commandSurface}
                  projection={canvasProjection}
                  layout={$activeLayoutStore}
                  workflowIdentity={`${$workspace.id}\0${$documentSessionStore.pair?.workflowId ?? ''}\0${$documentSessionStore.pair?.definition.path ?? ''}`}
                  transitionLocked={canvasTransitionLocked}
                  surfaceActive={!authoringHidden}
                  issues={$documentSessionStore.analysis?.issues ?? []}
                  stale={canvasStale}
                  staleSource={canvasStaleSource}
                  inspectorControls={inspectorPanelId}
                  inspectorExpanded={!inspectorPanelHidden}
                  readOnly={canvasReadOnly ||
                    $workspace.entries.find((entry) => entry.id === $documentSessionStore.pair?.workflowId)
                      ?.readOnly === true}
                  onPersistLayout={persistCanvasLayout}
                  onPersistenceError={surfaceCanvasPersistenceError}
                  onConnect={(source, target) => canvasAuthoring.connect(source, target)}
                  onDisconnect={(source, target) => canvasAuthoring.disconnect(source, target)}
                  onRequestAdd={requestCanvasAdd}
                  onRequestDelete={requestCanvasDelete}
                  onOpenInspector={focusInspector}
                  onToggleInspector={(expanded, invoker) =>
                    expanded ? focusInspector(invoker) : closeInspectorDrawer(invoker)}
                  onDropNodeKind={dropPaletteNode}
                />
              </div>
            {/if}
            {#if $documentSessionStore.pair && $documentSessionStore.revision}
              <div class="yaml-pane">
                {#key $documentSessionStore.pair.workflowId}
                  <EditorModes
                    bind:this={editorModesHost}
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
          onDocumentation={(id, opener) => {
            rememberPageOpener(opener)
            exampleDocumentationProfile = undefined
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
              <button
                type="button"
                data-variant="primary"
                onclick={() => runWorkspaceOperation(documentWorkspace.recreateMissing())}>Keep Mine / Recreate</button
              >
              <button
                type="button"
                data-variant="secondary"
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
    <aside
      id={inspectorPanelId}
      bind:this={inspectorPanelHost}
      class="panel inspector-panel"
      class:drawer-open={!inspectorPanelHidden}
      hidden={authoringHidden}
      {...(inspectorPanelHidden ? { inert: true } : {})}
      aria-label="Inspector"
      aria-hidden={inspectorPanelHidden ? 'true' : undefined}
    >
      {#if workbenchPresentation.panels === 'drawers'}
        <button
          type="button"
          class="drawer-close"
          data-variant="ghost"
          aria-label="Close inspector"
          title="Close inspector"
          onclick={() => void closeInspectorDrawer()}><X size={16} aria-hidden="true" /></button
        >
      {/if}
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
        documentationIndex={activeDocumentDocumentationIndex ?? undefined}
        documentationTopicId={inspectorDocumentationTopicId}
        onDocumentationTopic={(id) => (inspectorDocumentationTopicId = id)}
        onCommit={commitInspectorField}
      />
    </aside>
    {#if workbenchSurface === 'welcome'}
      <ActivityPage
        activity="welcome"
        title="Welcome"
        description="Open a local folder to begin authoring workflows."
      >
        <OpenWorkspace
          {recent}
          disabled={!setupReady}
          onOpen={(rootPath) => runWorkspaceOperation(openWorkspace(rootPath))}
          onDropPath={(path) => runWorkspaceOperation(handleExternalWorkspacePath(path))}
        />
      </ActivityPage>
    {:else if workbenchSurface === 'settings'}
      <ActivityPage
        activity="settings"
        title="Settings"
        description="Manage the application."
        showBack
        onBack={returnToAuthoringSurface}
      >
        <div class="settings-stack">
          <BrandSettings
            packs={$brandState.packs}
            reports={$brandState.reports}
            activeId={$brandState.activeId}
            pending={$brandState.pending}
            warning={$brandState.warning}
            onImport={async () => {
              await runBrandOperation(() => brandController.importPack())
            }}
            onPreview={(id) => {
              brandPreviewId = id
              brandPreviewOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
            }}
            onActivate={async (id) => {
              await runBrandOperation(() => brandController.activate(id))
            }}
            onRemove={async (id, revertActive) => {
              await runBrandOperation(() => brandController.remove(id, revertActive))
            }}
          />
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
          {#if hostInfo}
            <AboutView
              host={hostInfo}
              contracts={contracts.map((contract) => ({
                profile: contract.profile,
                schemaVersion: contract.schema_version,
                digest: contract.contract_digest,
              }))}
              {startupCheckEnabled}
              updateState={updateProgress}
              oncheck={() => updateController.check(false)}
              onstartupchange={(enabled) => updateController.setStartupCheck(enabled)}
              ondownload={(runId) => updateController.downloadInstall(runId)}
              onopenlog={(runId) => updateController.openLog(runId)}
              onrelaunch={() => updateController.relaunch()}
            />
          {/if}
        </div>
      </ActivityPage>
    {:else if workbenchSurface === 'git'}
      <ActivityPage
        activity="git"
        title="Git"
        description="Inspect local repository status, history, and workflow versions."
        showBack
        onBack={returnToAuthoringSurface}
      >
        <GitView
          embedded
          onSelectCommit={loadHistoricalGitPair}
          currentDefinition={$documentSessionStore.pair?.definition.text}
          currentCompanion={$documentSessionStore.pair?.companion?.text}
          onRestoreDraft={restoreHistoricalGitPair}
          workspaceRoot={$workspace.rootPath ?? undefined}
          versionReady={Boolean(
            $documentSessionStore.pair &&
              pairIsSavedCurrentValid($documentSessionStore.pair, $documentSessionStore.analysis),
          )}
          findings={$documentSessionStore.analysis?.issues.map(({ message }) => message) ?? []}
          onInitialize={initializeGitRepository}
          onSetIdentity={setRepositoryIdentity}
          onCreateVersion={createCurrentPairVersion}
        />
      </ActivityPage>
    {:else if workbenchSurface === 'documentation'}
      <ActivityPage
        activity="documentation"
        title="Documentation"
        description="Browse the bundled offline workflow reference."
        showBack
        onBack={returnToAuthoringSurface}
      >
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
      </ActivityPage>
    {:else if workbenchSurface === 'examples'}
      <ActivityPage
        activity="examples"
        title="Examples"
        description="Explore validated bundled workflows and create editable copies."
        showBack
        onBack={returnToAuthoringSurface}
      >
        {#if examples.length > 0}
          <ExampleGallery
            embedded
            {examples}
            topicLabels={exampleTopicLabels}
            onCreateEditableCopy={(example) => runWorkspaceOperation(createEditableExampleCopy(example))}
            onOpenDocumentation={openExampleDocumentation}
          />
        {:else}
          <p>Loading validated examples…</p>
        {/if}
      </ActivityPage>
    {/if}
  </div>

  <StatusBar />
  {#if previewRuntimeBrand}
    <BrandPreview
      pack={previewRuntimeBrand}
      mode={resolveThemeMode($themePreference)}
      pending={$brandState.pending}
      opener={brandPreviewOpener}
      onClose={() => (brandPreviewId = null)}
      onActivate={async () => {
        if (await runBrandOperation(() => brandController.activate(previewRuntimeBrand.manifest.id))) {
          brandPreviewId = null
        }
      }}
    />
  {/if}
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
      <button
        type="button"
        data-variant="primary"
        onclick={() => documentWorkspace.recoverDraft($documentWorkspaceState.recoveryOffers[0]!)}>Recover</button
      >
      <button
        type="button"
        data-variant="danger"
        onclick={() => void documentWorkspace.discardRecovery($documentWorkspaceState.recoveryOffers[0]!.workflowId)}
        >Discard</button
      >
    </div>
  {/if}
  {#if contextEntryId}
    <div class="context-layer">
      <WorkflowContextMenu
        commands={commandSurface.listCommands()}
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
  {#if nodeChordState.pending}
    <div class="node-chord-overlay" role="status" aria-live="polite">
      Add node: {#each nodeChordState.choices as choice, index (choice)}<kbd>{choice}</kbd>{index <
        nodeChordState.choices.length - 1
          ? ' '
          : ''}{/each}
      <span>Choose kind within 1.5 seconds{nodeChordState.afterSelection ? ' after selection' : ''}.</span>
    </div>
  {/if}
  {#if $commandPaletteOpen}
    <CommandPalette
      registry={commandSurface}
      context={keyboardContext(document.activeElement)}
      onClose={closeCommandPalette}
    />
  {/if}
  {#if $keyboardShortcutsOpen}
    <div class="shortcuts-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button type="button" data-variant="ghost" aria-label="Close keyboard shortcuts" onclick={closeKeyboardShortcuts}
        >Close</button
      >
      <KeyboardShortcuts registry={commandSurface} />
    </div>
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

{#if setupProgress && setupProgress.status !== 'succeeded'}
  <SetupOverlay
    state={setupProgress}
    oncancel={(runId) => setupController.cancel(runId)}
    onretry={() => setupController.retry()}
    onopenlog={(runId) => setupController.openLog(runId)}
    copyText={(text) => navigator.clipboard.writeText(text)}
  />
{/if}

{#if updateProgress && ['available', 'downloading', 'verifying', 'cancelling', 'installing', 'restart-required', 'recheck-required', 'failed'].includes(updateProgress.phase)}
  <UpdateOverlay
    state={updateProgress}
    ondownload={(runId) => updateController.downloadInstall(runId)}
    onlater={(runId) => updateController.defer(runId)}
    oncancel={(runId) => updateController.cancel(runId)}
    onretry={() => updateController.check(false)}
    onopenlog={(runId) => updateController.openLog(runId)}
    onrelaunch={() => updateController.relaunch()}
    copyText={(text) => navigator.clipboard.writeText(text)}
  />
{/if}

<style>
  .application-shell {
    display: grid;
    gap: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    max-width: none;
    height: 100vh;
    height: 100dvh;
    min-height: 0;
    align-content: stretch;
    padding: 0;
    overflow: hidden;
    color: var(--color-text);
    background: var(--color-background);
  }
  .node-chord-overlay {
    position: fixed;
    z-index: 72;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.35rem;
    align-items: center;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--color-focus);
    border-radius: 0.4rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 0.5rem 1.5rem var(--color-shadow);
  }
  .node-chord-overlay kbd {
    padding: 0.1rem 0.28rem;
    border: 1px solid var(--color-border);
    border-radius: 0.2rem;
    font-family: var(--font-mono);
  }
  .node-chord-overlay span {
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }
  .shortcuts-dialog {
    position: fixed;
    z-index: 71;
    inset: 10vh 15vw;
    overflow: auto;
    border: 1px solid var(--color-edge);
    border-radius: 0.6rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 1rem 3rem var(--color-shadow);
  }
  .shortcuts-dialog > button {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
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
    border-color: var(--color-error);
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  .brand-lockup {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .title-actions {
    display: flex;
    gap: var(--space-2);
  }

  .brand-lockup img {
    width: var(--control-md);
    height: var(--control-md);
    object-fit: contain;
    object-position: left center;
  }

  .title-copy {
    padding-left: var(--space-3);
    border-left: 1px solid var(--color-border);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.2;
  }

  .title-actions button,
  .editor-tabs button {
    min-height: var(--control-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .title-actions button {
    padding-inline: var(--space-3);
  }

  .workbench {
    display: grid;
    position: relative;
    isolation: isolate;
    grid-template-columns: 3rem var(--left-panel-width) minmax(0, 1fr) var(--right-panel-width);
    min-height: 0;
    overflow: hidden;
  }

  .panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-surface);
  }

  .left-panel[hidden],
  .inspector-panel[hidden] {
    display: block;
    pointer-events: none;
  }

  .drawer-close,
  .drawer-scrim {
    display: none;
  }

  .workbench[data-panel-presentation='drawers'] {
    grid-template-columns: 3rem minmax(0, 1fr);
  }

  .workbench[data-panel-presentation='drawers'] .panel {
    position: absolute;
    z-index: 20;
    top: 0;
    bottom: 0;
    display: block;
    transition: transform 120ms ease-out;
    box-shadow: 0 1rem 3rem var(--color-shadow);
  }

  .workbench[data-panel-presentation='drawers'] .left-panel {
    left: 3rem;
    width: min(var(--left-panel-width), calc(100% - 3rem));
    transform: translateX(-100%);
  }

  .workbench[data-panel-presentation='drawers'] .inspector-panel {
    right: 0;
    width: min(var(--right-panel-width), calc(100% - 3rem));
    transform: translateX(100%);
  }

  .workbench[data-panel-presentation='drawers'] .panel.drawer-open {
    transform: translateX(0);
  }

  .workbench[data-panel-presentation='drawers'] .drawer-close {
    position: absolute;
    z-index: 2;
    top: var(--space-2);
    right: var(--space-2);
    display: grid;
    width: var(--control-sm);
    min-width: var(--control-sm);
    height: var(--control-sm);
    min-height: var(--control-sm);
    padding: 0;
    place-items: center;
  }

  .workbench[data-panel-presentation='drawers'] .drawer-scrim {
    position: absolute;
    z-index: 10;
    inset: 0 0 0 3rem;
    display: block;
    width: auto;
    min-width: 0;
    height: auto;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: color-mix(in srgb, var(--color-background) 64%, transparent);
  }

  .left-panel {
    border-right: 1px solid var(--color-border);
  }

  .settings-stack {
    display: grid;
    align-content: start;
    height: 100%;
    overflow: auto;
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

  .editor-column[hidden] {
    display: grid;
    pointer-events: none;
  }

  .editor-tabs {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  .split-pane-tabs {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
  }

  .split-pane-tabs button {
    transition:
      border-color 100ms ease-out,
      color 100ms ease-out,
      background-color 100ms ease-out;
  }

  .editor-tabs button {
    padding: var(--space-1) var(--space-3);
    border: 1px solid transparent;
    color: var(--color-text-muted);
    background: transparent;
  }

  .editor-tabs button.active {
    border-color: var(--color-accent);
    color: var(--color-accent-strong);
    background: var(--color-node-selected);
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
    position: relative;
    grid-template-columns: minmax(0, 1fr);
  }

  .canvas-capacity-advisory {
    position: absolute;
    z-index: 2;
    top: 0.5rem;
    right: 0.75rem;
    max-width: 38rem;
    padding: 0.45rem 0.65rem;
    border: 1px solid var(--color-warning);
    border-radius: 0.35rem;
    background: var(--color-surface);
    font-size: 0.72rem;
  }

  .editor-surfaces.split:not(.no-canvas) {
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.72fr);
  }

  .editor-surfaces.split.split-tabs:not(.no-canvas) {
    grid-template-columns: minmax(0, 1fr);
  }

  .editor-surfaces.split-tabs[data-split-pane='canvas'] .yaml-pane,
  .editor-surfaces.split-tabs[data-split-pane='yaml'] .canvas-pane {
    display: none;
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

  @media (prefers-reduced-motion: reduce) {
    .workbench[data-panel-presentation='drawers'] .panel,
    .split-pane-tabs button {
      transition: none !important;
      animation: none !important;
    }
  }

  @media (forced-colors: active) {
    .drawer-close:focus-visible,
    .split-pane-tabs button:focus-visible {
      outline: 2px solid ButtonText;
      outline-offset: 2px;
      box-shadow: none;
    }
  }
</style>
