<script lang="ts">
  import { tick } from 'svelte'
  import type { AppCommand, CommandContext } from '$src/lib/commands/types'

  interface Props {
    commands: readonly AppCommand[]
    context?: CommandContext
    onRun?: (id: string) => void | Promise<void>
    onClose?: () => void
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
  let { commands, context = defaultContext, onRun, onClose }: Props = $props()
  const visibleCommands = $derived(
    workflowCommandOrder.flatMap((id) => {
      const command = commands.find((candidate) => candidate.id === id)
      return command ? [command] : []
    }),
  )
  let focusedIndex = $state(0)

  async function focus(index: number): Promise<void> {
    focusedIndex = Math.max(0, Math.min(index, visibleCommands.length - 1))
    await tick()
    document.querySelector<HTMLButtonElement>(`[data-workflow-menu-index="${focusedIndex}"]`)?.focus()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      void focus((focusedIndex + 1) % visibleCommands.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      void focus((focusedIndex - 1 + visibleCommands.length) % visibleCommands.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      void focus(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      void focus(visibleCommands.length - 1)
    }
  }
</script>

<div class="context-menu" role="menu" aria-label="Workflow actions" tabindex="-1" onkeydown={handleKeydown}>
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
