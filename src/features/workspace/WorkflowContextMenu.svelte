<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { AppCommand, CommandContext } from '$src/lib/commands/types'

  interface Props {
    commands: readonly AppCommand[]
    context?: CommandContext
    onRun?: (id: string) => void | Promise<void>
    onClose?: () => void
    opener?: HTMLElement | undefined
  }

  const workflowCommandOrder = [
    'workflow.open',
    'workflow.duplicate',
    'workflow.rename',
    'workflow.create-companion',
    'workflow.remove-companion',
    'workflow.export',
    'workflow.trash',
  ] as const
  const defaultContext: CommandContext = { surface: 'global', canMutate: true, hasSelection: true }
  let { commands, context = defaultContext, onRun, onClose, opener }: Props = $props()
  const visibleCommands = $derived(
    workflowCommandOrder.flatMap((id) => {
      const command = commands.find((candidate) => candidate.id === id)
      return command ? [command] : []
    }),
  )
  let focusedIndex = $state(0)
  let menu: HTMLDivElement

  function enabledIndexes(): number[] {
    return visibleCommands.flatMap((command, index) => (command.enabled(context) ? [index] : []))
  }

  async function focus(index: number): Promise<void> {
    focusedIndex = index
    await tick()
    menu.querySelector<HTMLButtonElement>(`[data-workflow-menu-index="${focusedIndex}"]`)?.focus()
  }

  function moveFocus(direction: 1 | -1): void {
    const enabled = enabledIndexes()
    if (enabled.length === 0) return
    const current = enabled.indexOf(focusedIndex)
    const next =
      current < 0 ? (direction === 1 ? 0 : enabled.length - 1) : (current + direction + enabled.length) % enabled.length
    void focus(enabled[next]!)
  }

  function close(): void {
    onClose?.()
    void tick().then(() => opener?.focus())
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const first = enabledIndexes()[0]
      if (first !== undefined) void focus(first)
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = enabledIndexes().at(-1)
      if (last !== undefined) void focus(last)
    }
  }

  onMount(() => {
    const first = enabledIndexes()[0]
    if (first !== undefined) {
      focusedIndex = first
      menu.querySelector<HTMLButtonElement>(`[data-workflow-menu-index="${first}"]`)?.focus()
    }
  })
</script>

<div
  bind:this={menu}
  class="context-menu"
  role="menu"
  aria-label="Workflow actions"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#each visibleCommands as command, index (command.id)}
    <button
      type="button"
      role="menuitem"
      data-workflow-menu-index={index}
      tabindex={index === focusedIndex ? 0 : -1}
      disabled={!command.enabled(context)}
      onclick={() => void onRun?.(command.id)}
      onfocus={() => (focusedIndex = index)}>{command.label}</button
    >
  {/each}
</div>

<style>
  .context-menu {
    display: grid;
    min-width: 13rem;
    padding: 0.25rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.375rem;
    background: var(--color-surface);
    box-shadow: 0 0.75rem 2rem var(--color-shadow);
  }

  button {
    width: 100%;
    min-height: 2rem;
    border: 0;
    color: var(--color-text);
    background: transparent;
    text-align: left;
  }

  button:hover,
  button:focus-visible {
    background: var(--color-node-selected);
  }
</style>
