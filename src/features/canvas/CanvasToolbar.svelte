<script lang="ts">
  import { tick } from 'svelte'
  import Copy from 'lucide-svelte/icons/copy'
  import Ellipsis from 'lucide-svelte/icons/ellipsis'
  import Link from 'lucide-svelte/icons/link'
  import Maximize from 'lucide-svelte/icons/maximize'
  import Network from 'lucide-svelte/icons/network'
  import Plus from 'lucide-svelte/icons/plus'
  import Scan from 'lucide-svelte/icons/scan'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import ZoomIn from 'lucide-svelte/icons/zoom-in'
  import ZoomOut from 'lucide-svelte/icons/zoom-out'
  import type { ResolvedCommand } from '$src/lib/commands/surface'

  interface Props {
    commands: readonly ResolvedCommand[]
    onExecute: (id: string) => unknown | Promise<unknown>
  }

  let { commands, onExecute }: Props = $props()
  let moreOpen = $state(false)
  let moreTrigger: HTMLButtonElement
  let moreActions = $state<HTMLDivElement>()
  let moreMenu = $state<HTMLDivElement>()

  const directCommandIds = ['canvas.add-node', 'canvas.create-edge'] as const
  const overflowCommandIds = [
    'canvas.duplicate-selection',
    'canvas.delete-selection',
    'canvas.arrange',
    'canvas.zoom-in',
    'canvas.zoom-out',
    'canvas.actual-size',
    'canvas.fit-graph',
  ] as const

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
            : id === 'canvas.arrange'
              ? Network
              : id === 'canvas.zoom-in'
                ? ZoomIn
                : id === 'canvas.zoom-out'
                  ? ZoomOut
                  : id === 'canvas.actual-size'
                    ? Scan
                    : Maximize
  }

  function executeDirect(command: ResolvedCommand): void {
    if (command.enabled) void onExecute(command.id)
  }

  async function closeMore(): Promise<void> {
    moreOpen = false
    await tick()
    moreTrigger?.focus({ preventScroll: true })
  }

  async function openMore(): Promise<void> {
    moreOpen = true
    await tick()
    menuItems()[0]?.focus({ preventScroll: true })
  }

  function menuItems(): HTMLElement[] {
    return moreMenu ? Array.from(moreMenu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')) : []
  }

  function toggleMore(): void {
    if (moreOpen) void closeMore()
    else void openMore()
  }

  async function executeOverflow(command: ResolvedCommand): Promise<void> {
    if (!command.enabled) return
    await closeMore()
    await onExecute(command.id)
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      void closeMore()
      return
    }
    const items = menuItems()
    if (!items.length) return
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : event.key === 'ArrowUp'
              ? (currentIndex - 1 + items.length) % items.length
              : null
    if (nextIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    items[nextIndex]?.focus({ preventScroll: true })
    items[nextIndex]?.scrollIntoView?.({ block: 'nearest' })
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    if (!moreOpen || !(event.target instanceof Node) || moreActions?.contains(event.target)) return
    moreOpen = false
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

<div class="canvas-toolbar" aria-label="Canvas tools" data-canvas-chrome>
  {#each directCommandIds as id (id)}
    {@const command = resolved(id)}
    {#if command}
      {@const Icon = commandIcon(command.id)}
      <button
        type="button"
        data-variant={id === 'canvas.add-node' ? 'secondary' : 'ghost'}
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

  <div class="more-actions" bind:this={moreActions}>
    <button
      bind:this={moreTrigger}
      class="more-trigger"
      type="button"
      data-variant="ghost"
      aria-label="More canvas actions"
      title="More canvas actions"
      aria-haspopup="menu"
      aria-expanded={moreOpen}
      onclick={toggleMore}
    >
      <Ellipsis size={16} aria-hidden="true" />
    </button>
    {#if moreOpen}
      <div
        bind:this={moreMenu}
        class="more-menu"
        role="menu"
        aria-label="More canvas actions"
        tabindex="-1"
        onkeydown={handleMenuKeydown}
      >
        {#each overflowCommandIds as id (id)}
          {@const command = resolved(id)}
          {#if command}
            {@const Icon = commandIcon(command.id)}
            <button
              type="button"
              data-variant={command.id === 'canvas.delete-selection' ? 'danger' : 'ghost'}
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
    align-items: flex-start;
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
    border-radius: var(--radius-sm);
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
    display: grid;
    flex: none;
    justify-items: end;
  }

  .more-trigger {
    justify-content: center;
    width: 2rem;
    padding-inline: 0;
  }

  .more-menu {
    position: static;
    display: grid;
    gap: 0.2rem;
    width: max-content;
    min-width: 12rem;
    max-width: min(18rem, calc(100vw - 2rem));
    max-height: min(13rem, max(2.5rem, calc(100cqh - 6.25rem)));
    margin-top: 0.35rem;
    padding: 0.35rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-elevated);
    box-shadow: 0 0.65rem 1.4rem var(--color-shadow);
  }

  .more-menu button {
    justify-content: flex-start;
    width: 100%;
  }

  @media (max-width: 28rem) {
    .canvas-toolbar {
      justify-content: flex-start;
    }

    .canvas-toolbar > button {
      padding-inline: 0.45rem;
    }
  }

  @media (max-height: 25rem) {
    .canvas-toolbar {
      padding-block: 0;
    }

    .more-menu {
      max-height: 2.5rem;
      margin-top: 0;
      padding: 0.15rem;
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
