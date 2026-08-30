<script lang="ts">
  import { tick } from 'svelte'
  import Copy from 'lucide-svelte/icons/copy'
  import Ellipsis from 'lucide-svelte/icons/ellipsis'
  import Link from 'lucide-svelte/icons/link'
  import Map from 'lucide-svelte/icons/map'
  import Network from 'lucide-svelte/icons/network'
  import Plus from 'lucide-svelte/icons/plus'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import type { ResolvedCommand } from '$src/lib/commands/surface'

  interface Props {
    commands: readonly ResolvedCommand[]
    minimapVisible: boolean
    onExecute: (id: string) => unknown | Promise<unknown>
    onToggleMinimap: () => unknown | Promise<unknown>
  }

  let { commands, minimapVisible, onExecute, onToggleMinimap }: Props = $props()
  let moreOpen = $state(false)
  let moreTrigger: HTMLButtonElement

  const directCommandIds = ['canvas.add-node', 'canvas.create-edge'] as const
  const overflowCommandIds = ['canvas.duplicate-selection', 'canvas.delete-selection', 'canvas.arrange'] as const

  function resolved(id: string): ResolvedCommand | undefined {
    return commands.find((command) => command.id === id)
  }

  function commandIcon(id: string) {
    return id === 'canvas.add-node'
      ? Plus
      : id === 'canvas.create-edge'
        ? Link
        : id === 'canvas.duplicate-selection'
          ? Copy
          : id === 'canvas.delete-selection'
            ? Trash2
            : Network
  }

  function executeDirect(command: ResolvedCommand): void {
    if (command.enabled) void onExecute(command.id)
  }

  async function closeMore(): Promise<void> {
    moreOpen = false
    await tick()
    moreTrigger?.focus()
  }

  async function executeOverflow(command: ResolvedCommand): Promise<void> {
    if (!command.enabled) return
    await closeMore()
    await onExecute(command.id)
  }

  async function toggleMinimap(): Promise<void> {
    await closeMore()
    await onToggleMinimap()
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    void closeMore()
  }
</script>

<div class="canvas-toolbar" aria-label="Canvas tools" data-canvas-chrome>
  {#each directCommandIds as id (id)}
    {@const command = resolved(id)}
    {#if command}
      {@const Icon = commandIcon(command.id)}
      <button
        type="button"
        aria-label={command.label}
        title={command.title}
        disabled={!command.enabled}
        onclick={() => executeDirect(command)}
      >
        <Icon size={15} aria-hidden="true" />
        {command.label}
      </button>
    {/if}
  {/each}

  <div class="more-actions">
    <button
      bind:this={moreTrigger}
      class="more-trigger"
      type="button"
      aria-label="More canvas actions"
      title="More canvas actions"
      aria-haspopup="menu"
      aria-expanded={moreOpen}
      onclick={() => (moreOpen = !moreOpen)}
    >
      <Ellipsis size={16} aria-hidden="true" />
    </button>
    {#if moreOpen}
      <div class="more-menu" role="menu" aria-label="More canvas actions" tabindex="-1" onkeydown={handleMenuKeydown}>
        {#each overflowCommandIds as id (id)}
          {@const command = resolved(id)}
          {#if command}
            {@const Icon = commandIcon(command.id)}
            <button
              type="button"
              role="menuitem"
              title={command.title}
              disabled={!command.enabled}
              onclick={() => void executeOverflow(command)}
            >
              <Icon size={15} aria-hidden="true" />
              {command.label}
            </button>
          {/if}
        {/each}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={minimapVisible}
          aria-label={minimapVisible ? 'Hide minimap' : 'Show minimap'}
          title={minimapVisible ? 'Hide minimap' : 'Show minimap'}
          onclick={() => void toggleMinimap()}
        >
          <Map size={15} aria-hidden="true" />
          Map
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .canvas-toolbar {
    position: static;
    z-index: 2;
    display: flex;
    gap: 0.35rem;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-elevated);
  }

  button {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    min-height: 2rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    background: var(--color-surface);
    white-space: nowrap;
    transition:
      border-color 100ms ease-out,
      color 100ms ease-out,
      background-color 100ms ease-out;
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }

  .more-actions {
    position: relative;
    flex: none;
  }

  .more-trigger {
    justify-content: center;
    width: 2rem;
    padding-inline: 0;
  }

  .more-menu {
    position: absolute;
    z-index: 10;
    top: calc(100% + 0.35rem);
    right: 0;
    display: grid;
    gap: 0.2rem;
    width: max-content;
    min-width: 12rem;
    max-width: min(18rem, calc(100vw - 2rem));
    padding: 0.35rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-elevated);
    box-shadow: 0 0.65rem 1.4rem var(--color-shadow);
  }

  .more-menu button {
    justify-content: flex-start;
    width: 100%;
    border-color: transparent;
    background: transparent;
  }

  .more-menu button:hover:not(:disabled) {
    background: var(--color-node-selected);
  }

  @media (max-width: 28rem) {
    .canvas-toolbar {
      justify-content: flex-start;
    }

    .canvas-toolbar > button {
      padding-inline: 0.45rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    button,
    .more-menu {
      transition: none !important;
      animation: none !important;
    }
  }

  @media (forced-colors: active) {
    button:focus-visible {
      outline: 2px solid ButtonText;
      outline-offset: 2px;
      box-shadow: none;
    }
  }
</style>
