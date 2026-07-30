<script lang="ts">
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
</script>

<footer
  class="status-bar"
  role="status"
  aria-label="Application status"
  style:background-color="var(--color-node-selected)"
>
  <span>{gitLabel}</span>
  <span>YAML: pending</span>
  <span>DAG: pending</span>
  <span class="update">{updateLabel}</span>
</footer>

<style>
  .status-bar {
    display: flex;
    gap: 1rem;
    align-items: center;
    min-height: 1.75rem;
    padding: 0 0.75rem;
    border-top: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-node-selected);
    font-size: 0.6875rem;
  }

  .update {
    margin-left: auto;
    color: var(--color-focus);
  }
</style>
