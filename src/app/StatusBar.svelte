<script lang="ts">
  import { onMount } from 'svelte'
  import { gitState } from '$src/stores/git'
  import { updateState } from '$src/stores/updates'
  import { formatBytes } from '$src/lib/updates/format'

  const gitLabel = $derived.by(() => {
    if ($gitState.phase === 'idle') return 'Git: no workspace'
    if ($gitState.phase === 'loading') return 'Git: refreshing…'
    if ($gitState.phase === 'error') return 'Git: unavailable'
    const repository = $gitState.inspection.repository
    if (!repository) return 'Git: not a repository'
    const location = repository.branch ?? `detached ${repository.detachedHead ?? 'unknown'}`
    const changes = $gitState.inspection.status.entries.length
    const scope = $gitState.inspection.pair ? 'pair' : 'workspace'
    return `Git: ${location}${changes === 0 ? '' : ` · ${changes} ${scope} ${changes === 1 ? 'change' : 'changes'}`}`
  })
  const updateLabel = $derived.by(() => {
    const update = $updateState
    if (!update || update.phase === 'idle' || update.phase === 'current' || update.phase === 'offline') {
      return 'Updates: Current'
    }
    if (update.phase === 'checking') return 'Updates: Checking…'
    if (update.phase === 'available') return `Update Available: ${update.version}`
    if (update.phase === 'downloading') {
      const total = update.totalBytes === null ? 'unknown size' : formatBytes(update.totalBytes)
      return `Updating: ${formatBytes(update.downloadedBytes)} / ${total}`
    }
    if (update.phase === 'verifying') return 'Update: Verifying'
    if (update.phase === 'installing') return 'Update: Installing'
    if (update.phase === 'restart-required') return 'Update: Restart Required'
    if (update.phase === 'cancelling') return 'Update: Cancelling'
    if (update.phase === 'recheck-required') return 'Update: Check Again'
    if (update.phase === 'failed') return 'Update: Failed'
    return 'Update: Later'
  })
  let secondaryOpen = $state(true)

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 42rem)')
    const updatePresentation = (matches: boolean) => {
      secondaryOpen = !matches
    }
    updatePresentation(query.matches)
    const change = (event: MediaQueryListEvent) => updatePresentation(event.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  })
</script>

<footer
  class="status-bar"
  role="status"
  aria-label="Application status"
  style:background-color="var(--color-surface-elevated)"
>
  <span class="primary-status">{gitLabel}</span>
  <details class="secondary-status" aria-label="More application status" bind:open={secondaryOpen}>
    <summary>More application status</summary>
    <div class="secondary-status-panel">
      <span data-secondary-status>YAML: pending</span>
      <span data-secondary-status>DAG: pending</span>
    </div>
  </details>
  <span class="update">{updateLabel}</span>
</footer>

<style>
  .status-bar {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    min-height: var(--control-sm);
    min-width: 0;
    padding: 0 var(--space-3);
    border-top: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-surface-elevated);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
  }

  .primary-status,
  .update,
  .secondary-status,
  .secondary-status span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .secondary-status {
    display: contents;
  }

  .secondary-status-panel {
    display: contents;
  }

  .secondary-status summary {
    display: none;
  }

  .secondary-status span {
    margin-left: var(--space-4);
  }

  .update {
    margin-left: auto;
    color: var(--color-text-muted);
  }

  @media (max-width: 42rem) {
    .status-bar {
      gap: var(--space-2);
    }

    .primary-status,
    .update {
      flex: 1 1 0;
    }

    .secondary-status {
      position: relative;
      display: block;
      flex: 0 0 auto;
      overflow: visible;
    }

    .secondary-status summary {
      display: block;
      min-width: 0;
      cursor: pointer;
      white-space: nowrap;
    }

    .secondary-status[open] .secondary-status-panel {
      position: absolute;
      z-index: 50;
      right: 0;
      bottom: calc(100% + 0.25rem);
      display: grid;
      width: max-content;
      max-width: min(22rem, calc(100vw - 2rem));
      padding: 0.3rem 0;
      overflow: hidden;
      border: 1px solid var(--color-border);
      color: var(--color-text);
      background: var(--color-surface-elevated);
    }

    .secondary-status[open] span {
      display: block;
      margin: 0;
      padding: 0.2rem 0.6rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .update {
      margin-left: 0;
      text-align: right;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .secondary-status summary {
      scroll-behavior: auto;
    }
  }

  @media (forced-colors: active) {
    .secondary-status[open] .secondary-status-panel {
      border-color: CanvasText;
    }
  }
</style>
