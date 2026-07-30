<script lang="ts">
  import type { ProgressStage } from '$src/lib/progress/types'

  interface Props {
    stages: readonly ProgressStage[]
    label?: string
  }

  let { stages, label = 'Setup stages' }: Props = $props()

  const statusLabel = (status: ProgressStage['status']): string =>
    ({ pending: 'Pending', running: 'Running', succeeded: 'Complete', skipped: 'Skipped', failed: 'Failed' })[status]
</script>

<ol aria-label={label}>
  {#each stages as stage (stage.id)}
    <li class:active={stage.status === 'running'} class:failed={stage.status === 'failed'}>
      <span aria-hidden="true" class="indicator"></span>
      <span class="label">{stage.label}</span>
      <span class="status">{statusLabel(stage.status)}</span>
      {#if stage.durationMs !== undefined}<span class="duration">{(stage.durationMs / 1_000).toFixed(1)}s</span>{/if}
      {#if stage.message}<span class="message">{stage.message}</span>{/if}
    </li>
  {/each}
</ol>

<style>
  ol {
    display: grid;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 0.75rem 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
  }
  .indicator {
    width: 0.625rem;
    height: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: var(--color-yaml-gutter);
  }
  .active .indicator {
    border-color: var(--color-accent);
    background: var(--color-accent);
  }
  .failed .indicator {
    border-color: var(--color-error);
    background: var(--color-error);
  }
  .label {
    font-weight: 650;
  }
  .status,
  .duration,
  .message {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  .message {
    grid-column: 2 / -1;
  }
</style>
