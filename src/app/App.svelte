<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { executeCommand, listCommands, setDocumentSaveHandler } from '$src/lib/commands/registry'
  import type { CommandContext, EditorMode } from '$src/lib/commands/types'
  import { getBundledBrandAssetUrl, loadBundledBrand } from '$src/lib/branding/load-brand'
  import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
  import type { AuthoringContract } from '$src/lib/contract/types'
  import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
  import { activeEditorMode } from '$src/stores/shell'
  import { activeActivity, workspaceIntent } from '$src/stores/shell'
  import { loadWorkspaceEntries, workspace } from '$src/stores/workspace'
  import { selectWorkspaceEntry } from '$src/stores/workspace'
  import { getNativeBridge } from '$src/lib/native/bridge'
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'
  import type { WorkflowPairEntry } from '$src/lib/workspace/types'
  import { createLayoutStore, LayoutPersistenceController } from '$src/lib/layout/layout-store'
  import { createWorkspaceActions, WorkspaceActionError } from '$src/features/workspace/workspace-actions'
  import { $documentSession as documentSessionStore, openDocumentSession } from '$src/stores/documents'
  import { createRecoveryDraft, createRecoveryStore, RecoveryDraftController } from '$src/lib/recovery/recovery-store'
  import { watchWorkspaceChanges } from '$src/lib/native/workspace-api'
  import { DocumentClient } from '$src/workers/document-client'
  import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
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
  const recoveryDrafts = new RecoveryDraftController(recoveryStore)
  const draftDigest = `sha256:${'0'.repeat(64)}` as const
  const availableContracts: AuthoringContract[] = []
  let contracts = $state<readonly AuthoringContract[]>([])
  let contractsLoaded = $state(false)
  const contractReadiness = loadBundledAuthoringContracts().then((loaded) => {
    availableContracts.splice(0, availableContracts.length, ...loaded)
    contracts = loaded
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
  let exportConfirmation = $state<{
    paths: readonly string[]
    resolve: (confirmed: boolean) => void
    opener: HTMLElement | undefined
  } | null>(null)
  let handledIntent = 0
  const documentWorkspace = new DocumentWorkspaceController({
    read: (path) => native.workspaceRead(path),
    write: (request) => native.workspaceWrite(request),
    trash: (requests) => native.workspaceTrashPaths(requests),
    createAnalysisClient: (onAnalysis, onError) => {
      if (typeof Worker === 'undefined') {
        return {
          schedule: () => onError('Document analysis worker is unavailable.'),
          dispose: () => undefined,
        }
      }
      const worker = new Worker(new URL('../workers/document-worker.ts', import.meta.url), { type: 'module' })
      const client = new DocumentClient(worker, { onAnalysis, onError: (error) => onError(error.message) })
      return {
        schedule: (pair, contract, reason) => client.schedule(pair, contract, reason),
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
  })
  const actions = createWorkspaceActions({
    native,
    contracts: availableContracts,
    analyze: analyzeCandidateInWorker,
    activate: openEntry,
    openDraft: async (pair, contract) => {
      const workspaceId = $workspace.id
      if (workspaceId) await documentWorkspace.openDraft(workspaceId, pair, contract)
      else openDocumentSession(pair, draftDigest)
    },
    currentDocument: () => documentSessionStore.get().pair,
    flushRecovery: (pair) => documentWorkspace.flushRecovery(pair),
    closeWorkspace: () => documentWorkspace.closeWorkspace(),
    closeDocument: (workflowId) => documentWorkspace.close(workflowId),
    renameDocument: (workspaceId, from, to, companionMoved) =>
      documentWorkspace.renameActivePair(workspaceId, from, to, companionMoved),
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

  function runCommand(id: string, context: CommandContext = globalContext): Promise<void> {
    return executeCommand(id, context)
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
    await contractReadiness
    const contract = await activeContractFor(entry)
    selectWorkspaceEntry(entry.id)
    const workspaceId = $workspace.id
    if (workspaceId) await documentWorkspace.activate(workspaceId, entry, contract ?? null)
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
      contractAvailable: contextProfile !== null && contracts.some(({ profile }) => profile === contextProfile),
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
    promptCompanion: async () => {
      const contract = contracts[0]
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

  onMount(() => {
    let dispose: (() => void) | undefined
    let disposed = false
    void (async () => {
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
      dispose = () => {
        unbindSave()
        window.removeEventListener('keydown', keydown)
      }
      await refreshRecent()
      if (disposed) return
      try {
        await actions.handleStartupPaths()
      } catch (error: unknown) {
        workspaceError = error instanceof Error ? error.message : 'The startup workflow could not be opened.'
      }
      if (disposed || !('__TAURI_INTERNALS__' in window)) return
      const disposeDragDrop = await getCurrentWindow().onDragDropEvent((event) => {
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
    void documentWorkspace.dispose()
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
  {#if workspaceError}
    <p class="workspace-error" role="alert">{workspaceError}</p>
  {/if}

  <div class="workbench">
    <ActivityRail />
    <aside class="panel left-panel" aria-label="Workspace panel">
      {#if $activeActivity === 'explorer' && $workspace.id !== null}
        <Explorer
          contractAvailable={contracts.length > 0}
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
        {/if}
      </section>
      {#if $documentSessionStore.pair}
        <ProblemsPanel
          issues={$documentSessionStore.analysis?.issues ?? []}
          paths={{
            definition: $documentSessionStore.pair.definition.path,
            companion: $documentSessionStore.pair.companion?.path ?? null,
          }}
        />
        {#if $documentWorkspaceState.analysisError}
          <p class="document-outcome" role="alert">{$documentWorkspaceState.analysisError}</p>
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
    <aside class="panel inspector-panel" aria-label="Inspector"></aside>
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
  {#if importDialogVisible && contracts[0]}
    <ImportExportDialog
      mode="import"
      opener={importDialogOpener}
      onCancel={() => (importDialogVisible = false)}
      onConfirm={async () => {
        const outcome = await actions.importWorkflow({ profile: contracts[0]!.profile })
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

  .context-layer {
    position: fixed;
    z-index: 40;
    top: 8rem;
    left: 17rem;
  }
</style>
