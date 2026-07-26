<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { executeCommand, listCommands } from '$src/lib/commands/registry'
  import type { CommandContext, EditorMode } from '$src/lib/commands/types'
  import { getBundledBrandAssetUrl, loadBundledBrand } from '$src/lib/branding/load-brand'
  import { activeEditorMode } from '$src/stores/shell'
  import { activeActivity, workspaceIntent } from '$src/stores/shell'
  import { workspace } from '$src/stores/workspace'
  import { selectWorkspaceEntry } from '$src/stores/workspace'
  import { getNativeBridge } from '$src/lib/native/bridge'
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'
  import { createLayoutStore } from '$src/lib/layout/layout-store'
  import { createWorkspaceActions } from '$src/features/workspace/workspace-actions'
  import { openDocumentSession, closeDocumentSession } from '$src/stores/documents'
  import Explorer from '$src/features/workspace/Explorer.svelte'
  import OpenWorkspace from '$src/features/workspace/OpenWorkspace.svelte'
  import QuickOpen from '$src/features/workspace/QuickOpen.svelte'
  import WorkflowContextMenu from '$src/features/workspace/WorkflowContextMenu.svelte'
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
  const draftDigest = `sha256:${'0'.repeat(64)}` as const
  let recent = $state<readonly RecentWorkspace[]>([])
  let quickOpenVisible = $state(false)
  let contextEntryId = $state<string | null>(null)
  let handledIntent = 0
  const actions = createWorkspaceActions({
    native,
    contracts: [],
    analyze: async () => ({
      workflowId: 'unavailable',
      pairGeneration: 0,
      definitionRevision: 0,
      companionRevision: null,
      contractDigest: draftDigest,
      issues: [],
      structurallyValid: false,
    }),
    activate: () => undefined,
    openDraft: (pair) => openDocumentSession(pair, draftDigest),
    closeDocument: closeDocumentSession,
    renameDocument: () => undefined,
    renameLayout: (workspaceId, from, to) => layoutStore.renameWorkflowPath(workspaceId, from, to),
    recoverDraft: async (pair) => {
      await native.recoveryWrite({ key: pair.workflowId, content: JSON.stringify(pair) })
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

  $effect(() => {
    const intent = $workspaceIntent
    if (intent.revision === 0 || intent.revision === handledIntent) return
    handledIntent = intent.revision
    if (intent.kind === 'open-folder') void openWorkspace()
    else if (intent.kind === 'quick-open') quickOpenVisible = true
  })

  onMount(() => {
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
    <button type="button" class="open-folder" onclick={() => runCommand('workspace.open-folder')}>Open Folder</button>
  </header>

  <div class="workbench">
    <ActivityRail />
    <aside class="panel left-panel" aria-label="Workspace panel">
      {#if $activeActivity === 'explorer' && $workspace.tree.length > 0}
        <Explorer onContext={(entry) => (contextEntryId = entry.id)} />
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
        selectWorkspaceEntry(entry.id)
      }}
      onClose={() => (quickOpenVisible = false)}
    />
  {/if}
  {#if contextEntryId}
    <div class="context-layer">
      <WorkflowContextMenu
        commands={listCommands()}
        onRun={(id) => {
          const entry = $workspace.entries.find(({ id }) => id === contextEntryId)
          contextEntryId = null
          runCommand(id, {
            surface: 'global',
            canMutate: entry?.readOnly === false,
            hasSelection: Boolean(entry),
          })
        }}
        onClose={() => (contextEntryId = null)}
      />
    </div>
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
