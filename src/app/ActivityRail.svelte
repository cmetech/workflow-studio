<script lang="ts">
  import { executeCommand } from '$src/lib/commands/registry'
  import type { ActivityId, CommandContext } from '$src/lib/commands/types'
  import { activeActivity } from '$src/stores/shell'

  const activityContext: CommandContext = {
    surface: 'global',
    canMutate: false,
    hasSelection: false,
  }

  const activities: readonly { id: ActivityId; label: string; symbol: string }[] = [
    { id: 'explorer', label: 'Explorer', symbol: '▤' },
    { id: 'nodes', label: 'Nodes', symbol: '◇' },
    { id: 'examples', label: 'Examples', symbol: '☆' },
    { id: 'git', label: 'Git', symbol: '⑂' },
    { id: 'settings', label: 'Settings', symbol: '⚙' },
  ]

  function activateActivity(activity: ActivityId): void {
    void executeCommand(`view.activity.${activity}`, activityContext)
  }
</script>

<nav class="activity-rail" aria-label="Activities">
  {#each activities as activity (activity.id)}
    {#if activity.id === 'settings'}
      <span class="spacer" aria-hidden="true"></span>
    {/if}
    <button
      type="button"
      aria-label={activity.label}
      aria-pressed={$activeActivity === activity.id}
      class:active={$activeActivity === activity.id}
      title={activity.label}
      onclick={() => activateActivity(activity.id)}
    >
      <span aria-hidden="true">{activity.symbol}</span>
    </button>
  {/each}
</nav>

<style>
  .activity-rail {
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
    align-items: center;
    min-height: 0;
    padding: 0.5rem 0.375rem;
    border-right: 1px solid #292e3b;
    background: #0d0f14;
  }

  button {
    display: grid;
    width: 2.125rem;
    min-width: 2.125rem;
    height: 2.125rem;
    min-height: 2.125rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    color: #8a91a3;
    background: transparent;
  }

  button:hover {
    color: #fafafa;
    background: #151821;
  }

  button.active {
    border-color: #78651e;
    color: #fad22d;
    background: #2b260d;
  }

  button:focus-visible {
    outline: 3px solid #4d97ed;
    outline-offset: 1px;
  }

  .spacer {
    flex: 1;
  }
</style>
