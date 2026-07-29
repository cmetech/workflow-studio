<script lang="ts">
  import type { GitPairSnapshot } from '$src/lib/git/types'
  import { gitState } from '$src/stores/git'
  import DiffView from './DiffView.svelte'
  import HistoryView from './HistoryView.svelte'

  interface Props {
    onSelectCommit: (oid: string) => Promise<GitPairSnapshot>
  }
  let { onSelectCommit }: Props = $props()
  let selected = $state<GitPairSnapshot | null>(null)
  let selectedOid = $state<string | undefined>()
  let previewError = $state<string | null>(null)

  async function selectCommit(oid: string): Promise<void> {
    selectedOid = oid
    previewError = null
    try {
      selected = await onSelectCommit(oid)
    } catch (error: unknown) {
      selected = null
      previewError = error instanceof Error ? error.message : 'The historical workflow could not be loaded.'
    }
  }
</script>

<section class="git-view" aria-labelledby="git-view-title">
  <h2 id="git-view-title">Git</h2>
  {#if $gitState.phase === 'loading'}
    <p role="status">Refreshing local Git…</p>
  {:else if $gitState.phase === 'error'}
    <p role="alert">{$gitState.error}</p>
  {:else if $gitState.phase === 'idle'}
    <p>Open a workflow to inspect its local history.</p>
  {:else if !$gitState.inspection.repository}
    <p>This workspace is not a Git repository.</p>
  {:else}
    {@const repository = $gitState.inspection.repository}
    <p class="repository">
      {repository.branch ? `Branch: ${repository.branch}` : `Detached: ${repository.detachedHead ?? 'unknown'}`}
    </p>
    <section aria-labelledby="git-status-title">
      <h3 id="git-status-title">{$gitState.inspection.pair ? 'Pair status' : 'Workspace status'}</h3>
      {#if $gitState.inspection.status.entries.length === 0}
        <p>No {$gitState.inspection.pair ? 'pair' : 'workspace'} changes.</p>
      {:else}
        <ul>
          {#each $gitState.inspection.status.entries as entry (`${entry.path}:${entry.originalPath ?? ''}`)}
            <li>{entry.index}{entry.worktree} {entry.originalPath ? `${entry.originalPath} → ` : ''}{entry.path}</li>
          {/each}
        </ul>
      {/if}
    </section>
    {#if $gitState.inspection.pair}
      <DiffView diff={$gitState.inspection.diff} />
      <HistoryView history={$gitState.inspection.history} {selectedOid} onSelect={selectCommit} />
    {:else}
      <p>Open a workflow to inspect its exact diff and history.</p>
    {/if}
    {#if previewError}<p role="alert">{previewError}</p>{/if}
    {#if selected && $gitState.inspection.pair}
      <section class="preview" aria-labelledby="historical-preview-title">
        <h3 id="historical-preview-title">Historical preview</h3>
        <h4>Definition</h4>
        <pre aria-label="Historical definition">{selected.definition ?? 'Not present in this commit'}</pre>
        <h4>Companion</h4>
        <pre aria-label="Historical companion">{selected.companion ?? 'Not present in this commit'}</pre>
      </section>
    {/if}
  {/if}
</section>

<style>
  .git-view {
    height: 100%;
    overflow: auto;
    padding: 0.75rem;
  }
  h2,
  h3 {
    margin-top: 0;
  }
  .repository {
    color: var(--color-focus);
  }
  ul {
    padding-left: 1.25rem;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
  .preview {
    display: grid;
    gap: 0.375rem;
  }
  .preview {
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .preview pre {
    min-height: 4rem;
    margin: 0;
    overflow: auto;
    padding: 0.5rem;
    color: var(--color-text);
    background: var(--color-yaml-gutter);
    font-family: ui-monospace, monospace;
    white-space: pre-wrap;
  }
</style>
