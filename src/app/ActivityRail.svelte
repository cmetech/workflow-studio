<script lang="ts">
  import type { CommandSurface } from '$src/lib/commands/registry'
  import { resolveCommand } from '$src/lib/commands/surface'
  import type { ActivityId, CommandContext } from '$src/lib/commands/types'
  import { activeActivity } from '$src/stores/shell'
  import Files from 'lucide-svelte/icons/files'
  import Workflow from 'lucide-svelte/icons/workflow'
  import GalleryVerticalEnd from 'lucide-svelte/icons/gallery-vertical-end'
  import BookOpen from 'lucide-svelte/icons/book-open'
  import GitBranch from 'lucide-svelte/icons/git-branch'
  import Settings from 'lucide-svelte/icons/settings'

  const activityContext: CommandContext = {
    surface: 'global',
    canMutate: false,
    hasSelection: false,
  }

  interface Props {
    commandSurface: CommandSurface
    workspacePanelExpanded?: boolean
    onActivityInvoke?: (opener: HTMLButtonElement) => void
  }
  let { commandSurface, workspacePanelExpanded = true, onActivityInvoke }: Props = $props()

  const activities: readonly { id: ActivityId; icon: typeof Files }[] = [
    { id: 'explorer', icon: Files },
    { id: 'nodes', icon: Workflow },
    { id: 'examples', icon: GalleryVerticalEnd },
    { id: 'documentation', icon: BookOpen },
    { id: 'git', icon: GitBranch },
    { id: 'settings', icon: Settings },
  ]
</script>

<nav class="activity-rail" aria-label="Activities" style:background-color="var(--color-yaml-gutter)">
  {#each activities as activity (activity.id)}
    {@const command = resolveCommand(commandSurface, `view.activity.${activity.id}`, activityContext)}
    {#if activity.id === 'settings'}
      <span class="spacer" aria-hidden="true"></span>
    {/if}
    {#if command}
      <button
        type="button"
        data-variant="ghost"
        data-activity={activity.id}
        aria-label={command.label}
        aria-pressed={$activeActivity === activity.id}
        aria-expanded={$activeActivity === activity.id ? workspacePanelExpanded : false}
        class:active={$activeActivity === activity.id}
        title={command.title}
        disabled={!command.enabled}
        onclick={(event) => {
          onActivityInvoke?.(event.currentTarget)
          void commandSurface.executeCommand(command.id, activityContext)
        }}
      >
        <activity.icon aria-hidden="true" size={17} strokeWidth={1.75} />
      </button>
    {/if}
  {/each}
</nav>

<style>
  .activity-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: center;
    min-height: 0;
    padding: var(--space-2) var(--space-1);
    background: var(--color-yaml-gutter);
    box-shadow: inset -1px 0 var(--color-border);
  }

  button {
    display: grid;
    place-items: center;
    width: var(--control-md);
    min-width: var(--control-md);
    height: var(--control-md);
    min-height: var(--control-md);
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    background: transparent;
  }

  button:hover {
    color: var(--color-text);
    background: var(--color-surface-elevated);
  }

  button.active {
    border-color: var(--color-edge);
    color: var(--color-accent);
    background: var(--color-node-selected);
  }

  button:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .spacer {
    flex: 1;
  }
</style>
