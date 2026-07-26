<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { executeCommand, listCommands } from '$src/lib/commands/registry'
  import type { CommandContext, EditorMode } from '$src/lib/commands/types'
  import { getBundledBrandAssetUrl, loadBundledBrand } from '$src/lib/branding/load-brand'
  import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
  import type { AuthoringContract } from '$src/lib/contract/types'
  import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
  import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
  import { activeEditorMode } from '$src/stores/shell'
  import { activeActivity, workspaceIntent } from '$src/stores/shell'
  import { loadWorkspaceEntries, workspace } from '$src/stores/workspace'
  import { selectWorkspaceEntry } from '$src/stores/workspace'
  import { getNativeBridge } from '$src/lib/native/bridge'
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'
  import type { WorkflowPairEntry } from '$src/lib/workspace/types'
  import { createLayoutStore } from '$src/lib/layout/layout-store'
  import { createWorkspaceActions } from '$src/features/workspace/workspace-actions'
  import { openWorkflowPair } from '$src/features/documents/document-actions'
  import {
    $documentSession as documentSessionStore,
    openDocumentSession,
    closeDocumentSession,
    receiveDocumentAnalysis,
    renameOpenDocumentPath,
  } from '$src/stores/documents'
  import { createRecoveryDraft, createRecoveryStore } from '$src/lib/recovery/recovery-store'
  import { createWorkspaceActionCoordinator } from '$src/features/workspace/workspace-action-coordinator'
  import Explorer from '$src/features/workspace/Explorer.svelte'
  import OpenWorkspace from '$src/features/workspace/OpenWorkspace.svelte'
  import QuickOpen from '$src/features/workspace/QuickOpen.svelte'
  import WorkflowContextMenu from '$src/features/workspace/WorkflowContextMenu.svelte'
  import NewWorkflowDialog from '$src/features/workspace/NewWorkflowDialog.svelte'
  import ImportExportDialog from '$src/features/workspace/ImportExportDialog.svelte'
  import ActivityRail from './ActivityRail.svelte'
  import StatusBar from './StatusBar.svelte'

  const globalContext: CommandContext = {
    surface: 'global',
    canMutate: false,
    hasSelection: false,
  }

  const brand = loadBundledBrand()
  const brandMarkUrl = getBundledBrandAssetUrl(brand, 'mark')
  const native = getNativeBridge()
  const layoutStore = createLayoutStore(native)
  const recoveryStore = createRecoveryStore(native)
  const draftDigest = `sha256:${'0'.repeat(64)}` as const
  const availableContracts: AuthoringContract[] = []
  let contracts = $state<readonly AuthoringContract[]>([])
  let contractsLoaded = $state(false)
  let recent = $state<readonly RecentWorkspace[]>([])
  let quickOpenVisible = $state(false)
  let contextEntryId = $state<string | null>(null)
  let contextOpener = $state<HTMLElement | undefined>()
  let newDialogOpener = $state<HTMLElement | undefined>()
  let newDialogVisible = $state(false)
  let importDialogOpener = $state<HTMLElement | undefined>()
  let importDialogVisible = $state(false)
  let exportConfirmation = $state<{
    paths: readonly string[]
    resolve: (confirmed: boolean) => void
  } | null>(null)
  let handledIntent = 0
  const actions = createWorkspaceActions({
    native,
    contracts: availableContracts,
    analyze: ({ definitionText, companionText, contract }) =>
      analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: crypto.randomUUID(),
          workflowId: 'candidate',
          pairGeneration: 0,
          definition: { path: 'candidate.yaml', text: definitionText, revision: 0 },
          companion:
            companionText === null ? null : { path: 'candidate.hermes.yaml', text: companionText, revision: 0 },
          profile: contract.profile,
          contractDigest: contract.contract_digest,
          reason: 'explicit-validate',
        },
        contract,
      ),
    activate: (entry) => void openEntry(entry),
    openDraft: (pair) => openDocumentSession(pair, draftDigest),
    closeDocument: closeDocumentSession,
    renameDocument: renameOpenDocumentPath,
    renameLayout: (workspaceId, from, to) => layoutStore.renameWorkflowPath(workspaceId, from, to),
    recoverDraft: async (pair) => {
      await recoveryStore.save(createRecoveryDraft(pair, new Date().toISOString()))
    },
  })

  const editorModes: readonly { id: EditorMode; label: string }[] = [
    { id: 'visual', label: 'Visual' },
    { id: 'split', label: 'Split' },
    { id: 'yaml', label: 'YAML' },
  ]

  function runCommand(id: string, context: CommandContext = globalContext): void {
    void executeCommand(id, context)
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
    if (!entry.companionPath) return contracts.find(({ profile }) => profile === 'hermes-legacy')
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
    return contracts.find((contract) => contract.profile === profile)
  }

  async function openEntry(entry: WorkflowPairEntry): Promise<void> {
    const contract = await activeContractFor(entry)
    if (!contract) return
    selectWorkspaceEntry(entry.id)
    let scheduledAnalysis: Promise<void> = Promise.resolve()
    await openWorkflowPair({
      workflowId: entry.id,
      definitionPath: entry.definitionPath,
      companionPath: entry.companionPath,
      contractDigest: contract.contract_digest,
      native,
      scheduleAnalysis: (pair) => {
        scheduledAnalysis = analyzeWorkflowPair(
          {
            type: 'analyze',
            requestId: crypto.randomUUID(),
            workflowId: pair.workflowId,
            pairGeneration: pair.generation,
            definition: {
              path: pair.definition.path,
              text: pair.definition.text,
              revision: pair.definition.revision,
            },
            companion: pair.companion
              ? { path: pair.companion.path, text: pair.companion.text, revision: pair.companion.revision }
              : null,
            profile: contract.profile,
            contractDigest: contract.contract_digest,
            reason: 'open',
          },
          contract,
        ).then(receiveDocumentAnalysis)
      },
    })
    await scheduledAnalysis
  }

  function confirmExact(action: 'remove-companion' | 'trash', paths: readonly string[]): Promise<boolean> {
    const verb = action === 'trash' ? 'Move to Trash' : 'Remove companion'
    return Promise.resolve(window.confirm(`${verb} exactly these files?\n\n${paths.join('\n')}`))
  }

  function confirmExportCollision(paths: readonly string[]): Promise<boolean> {
    return new Promise((resolve) => {
      exportConfirmation = { paths, resolve }
    })
  }

  const coordinateWorkspaceAction = createWorkspaceActionCoordinator({
    actions,
    getEntry: (id) => $workspace.entries.find((entry) => entry.id === id),
    getWorkspaceId: () => $workspace.id,
    read: (path) => native.workspaceRead(path),
    open: openEntry,
    refresh: refreshWorkspace,
    promptRename: async (entry) => window.prompt('Rename workflow definition to:', entry.definitionPath),
    promptCompanion: async () => {
      const contract = contracts[0]
      return contract ? { profile: contract.profile, metadata: {} } : null
    },
    confirm: confirmExact,
    currentDocument: () => documentSessionStore.get(),
    confirmExportCollision,
  })

  $effect(() => {
    const intent = $workspaceIntent
    if (intent.revision === 0 || intent.revision === handledIntent) return
    handledIntent = intent.revision
    if (intent.kind === 'open-folder') void openWorkspace()
    else if (intent.kind === 'quick-open') quickOpenVisible = true
    else if (intent.kind?.startsWith('workflow.')) void coordinateWorkspaceAction(intent)
  })

  onMount(() => {
    void loadBundledAuthoringContracts().then((loaded) => {
      availableContracts.splice(0, availableContracts.length, ...loaded)
      contracts = loaded
      contractsLoaded = true
    })
    void refreshRecent()
    void actions.handleStartupPaths()
    if (!('__TAURI_INTERNALS__' in window)) return
    let dispose: (() => void) | undefined
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return
        for (const path of event.payload.paths) void actions.handleExternalPath(path)
      })
      .then((unlisten) => (dispose = unlisten))
    return () => dispose?.()
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
        disabled={contracts.length === 0}
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

  <div class="workbench">
    <ActivityRail />
    <aside class="panel left-panel" aria-label="Workspace panel">
      {#if $activeActivity === 'explorer' && $workspace.tree.length > 0}
        <Explorer
          contractAvailable={contracts.length > 0}
          onOpen={(entry) => entry.kind === 'workflow' && void openEntry(entry)}
          onContext={(entry) => {
            contextEntryId = entry.id
            contextOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
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
          <OpenWorkspace {recent} onOpen={openWorkspace} onDropPath={(path) => actions.handleExternalPath(path)} />
        {/if}
      </section>
    </section>
    <aside class="panel inspector-panel" aria-label="Inspector"></aside>
  </div>

  <StatusBar />
  {#if quickOpenVisible}
    <QuickOpen
      entries={$workspace.entries}
      onOpen={(entry) => {
        quickOpenVisible = false
        if (entry.kind === 'workflow') void openEntry(entry)
      }}
      onClose={() => (quickOpenVisible = false)}
    />
  {/if}
  {#if contextEntryId}
    <div class="context-layer">
      <WorkflowContextMenu
        commands={listCommands()}
        opener={contextOpener}
        onRun={(id) => {
          const targetEntryId = contextEntryId
          const entry = $workspace.entries.find(({ id }) => id === targetEntryId)
          contextEntryId = null
          runCommand(id, {
            surface: 'global',
            canMutate: entry?.readOnly === false,
            hasSelection: Boolean(entry),
            targetEntryId,
            contractAvailable: contracts.length > 0,
          })
        }}
        onClose={() => (contextEntryId = null)}
      />
    </div>
  {/if}
  {#if newDialogVisible && contracts.length > 0}
    <NewWorkflowDialog
      {contracts}
      opener={newDialogOpener}
      onCancel={() => (newDialogVisible = false)}
      onCreate={async (input) => {
        await actions.createWorkflow(input)
        await refreshWorkspace()
        newDialogVisible = false
      }}
    />
  {/if}
  {#if importDialogVisible && contracts[0]}
    <ImportExportDialog
      mode="import"
      opener={importDialogOpener}
      onCancel={() => (importDialogVisible = false)}
      onConfirm={async () => {
        await actions.importWorkflow({ profile: contracts[0]!.profile })
        await refreshWorkspace()
        importDialogVisible = false
      }}
    />
  {/if}
  {#if exportConfirmation}
    <ImportExportDialog
      mode="export"
      paths={exportConfirmation.paths}
      collision={true}
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

  .contract-unavailable {
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

  .context-layer {
    position: fixed;
    z-index: 40;
    top: 8rem;
    left: 17rem;
  }
</style>
