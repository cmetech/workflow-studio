<script lang="ts">
  import { executeCommand } from '$src/lib/commands/registry'
  import type { CommandContext, EditorMode } from '$src/lib/commands/types'
  import { activeEditorMode } from '$src/stores/shell'
  import ActivityRail from './ActivityRail.svelte'
  import StatusBar from './StatusBar.svelte'

  const globalContext: CommandContext = {
    surface: 'global',
    canMutate: false,
    hasSelection: false,
  }

  const editorModes: readonly { id: EditorMode; label: string }[] = [
    { id: 'visual', label: 'Visual' },
    { id: 'split', label: 'Split' },
    { id: 'yaml', label: 'YAML' },
  ]

  function runCommand(id: string): void {
    void executeCommand(id, globalContext)
  }
</script>

<svelte:head>
  <title>Workflow Studio</title>
</svelte:head>

<main class="application-shell">
  <header class="titlebar">
    <div>
      <p class="eyebrow">LOOP24</p>
      <h1>Workflow Studio</h1>
    </div>
    <button type="button" class="open-folder" onclick={() => runCommand('workspace.open-folder')}>Open Folder</button>
  </header>

  <div class="workbench">
    <ActivityRail />
    <aside class="panel left-panel" aria-label="Workspace panel"></aside>
    <section class="editor-column" aria-label="Workflow workspace">
      <div class="editor-tabs" role="tablist" aria-label="Editor mode">
        {#each editorModes as mode (mode.id)}
          <button
            type="button"
            role="tab"
            aria-selected={$activeEditorMode === mode.id}
            class:active={$activeEditorMode === mode.id}
            onclick={() => runCommand(`view.editor.${mode.id}`)}
          >
            {mode.label}
          </button>
        {/each}
      </div>
      <section class="editor-region" aria-label="Workflow editor"></section>
    </section>
    <aside class="panel inspector-panel" aria-label="Inspector"></aside>
  </div>

  <StatusBar />
</main>

<style>
  .application-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    max-width: none;
    min-height: 100vh;
    padding: 0;
    overflow: hidden;
    color: #fafafa;
    background: radial-gradient(circle at 80% 0, #4d97ed18, transparent 35%), #090a0d;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
    padding: 0.5rem 0.875rem;
    border-bottom: 1px solid #292e3b;
    background: #0d0f14;
  }

  .eyebrow {
    margin: 0;
    color: #fad22d;
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
    border: 1px solid #78651e;
    color: #ffe463;
    background: #2b260d;
  }

  .workbench {
    display: grid;
    grid-template-columns: 3rem minmax(10rem, 16.875rem) minmax(0, 1fr) minmax(11rem, 18.875rem);
    min-height: 0;
  }

  .panel {
    min-width: 0;
    background: #101218;
  }

  .left-panel {
    border-right: 1px solid #292e3b;
  }

  .inspector-panel {
    border-left: 1px solid #292e3b;
  }

  .editor-column {
    display: grid;
    grid-template-rows: 2.625rem minmax(0, 1fr);
    min-width: 0;
    background: #0c0e13;
  }

  .editor-tabs {
    display: flex;
    gap: 0.1875rem;
    align-items: center;
    padding: 0 0.625rem;
    border-bottom: 1px solid #292e3b;
    background: #101218;
  }

  .editor-tabs button {
    padding: 0.25rem 0.625rem;
    border: 1px solid transparent;
    color: #8a91a3;
    background: transparent;
  }

  .editor-tabs button.active {
    border-color: #78651e;
    color: #fad22d;
    background: #2b260d;
  }

  button:focus-visible {
    outline: 3px solid #4d97ed;
    outline-offset: 1px;
  }

  .editor-region {
    min-width: 0;
    min-height: 0;
    background-color: #0c0e13;
    background-image: radial-gradient(#2c3140 1px, transparent 1px);
    background-size: 1.25rem 1.25rem;
  }
</style>
