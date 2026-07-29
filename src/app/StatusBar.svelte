<script lang="ts">
  import { gitState } from '$src/stores/git'

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
  <span class="update">Offline ready</span>
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
