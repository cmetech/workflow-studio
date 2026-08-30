<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { CommandSurface } from '$src/lib/commands/registry'
  import { displayKeybindings } from '$src/lib/commands/keybindings'
  import type { CommandContext } from '$src/lib/commands/types'

  interface Props {
    registry: CommandSurface
    context: CommandContext
    onClose?: () => void
    opener?: HTMLElement | undefined
  }
  let { registry, context, onClose, opener }: Props = $props()
  let query = $state('')
  let activeIndex = $state(0)
  const commands = $derived(
    registry.listCommands().filter((command) => fuzzy(query, `${command.label} ${command.category}`)),
  )
  const active = $derived(commands[activeIndex])
  const categories = $derived([...new Set(commands.map((command) => command.category))])

  function fuzzy(needle: string, haystack: string): boolean {
    const letters = needle.toLowerCase().replace(/\s+/g, '')
    if (!letters) return true
    let cursor = 0
    for (const letter of haystack.toLowerCase()) if (letter === letters[cursor]) cursor += 1
    return cursor === letters.length
  }
  function enabled(index: number): boolean {
    return Boolean(commands[index]?.enabled(context))
  }
  function next(direction: 1 | -1): void {
    if (!commands.length) return
    let index = activeIndex
    for (let count = 0; count < commands.length; count += 1) {
      index = (index + direction + commands.length) % commands.length
      if (enabled(index)) {
        activeIndex = index
        return
      }
    }
  }
  async function execute(): Promise<void> {
    if (!active || !active.enabled(context)) return
    const result = await registry.executeCommand(active.id, context)
    if (result.commandPalette === 'close') close()
  }
  function close(): void {
    onClose?.()
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      next(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      next(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void execute()
    }
  }
  function reason(index: number): string | undefined {
    const command = commands[index]
    return command && !command.enabled(context)
      ? (command.disabledReason?.(context) ?? `${command.label} is unavailable.`)
      : undefined
  }
</script>

<ModalShell
  titleId="command-palette-title"
  opener={opener ?? null}
  onCancel={close}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <div class="palette-body" role="presentation" onkeydown={keydown}>
    <h2 id="command-palette-title" class="visually-hidden">Command palette</h2>
    <input
      data-modal-initial-focus
      role="combobox"
      aria-label="Search commands"
      aria-controls="palette-results"
      aria-expanded="true"
      bind:value={query}
      oninput={() => (activeIndex = 0)}
      placeholder="Type a command"
    />
    <div id="palette-results" role="listbox" aria-label="Commands">
      {#each categories as category (category)}
        <h2>{category}</h2>
        {#each commands as command, index (command.id)}
          {#if command.category === category}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={!enabled(index)}
              disabled={!enabled(index)}
              onclick={() => {
                activeIndex = index
                void execute()
              }}
            >
              <span><strong>{command.label}</strong></span>
              <span class="binding">{displayKeybindings(command.defaultBindings).join('  ')}</span>
              {#if reason(index)}<em>{reason(index)}</em>{/if}
            </button>
          {/if}
        {/each}
      {:else}
        <p role="status">No commands match “{query}”.</p>
      {/each}
    </div>
  </div>
</ModalShell>

<style>
  .palette-body {
    min-width: 0;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.65rem;
  }
  [role='listbox'] {
    margin-top: 0.4rem;
  }
  [role='option'] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
    gap: 0.2rem 0.8rem;
    padding: 0.55rem;
    border: 0;
    color: var(--color-text);
    background: transparent;
    text-align: left;
  }
  h2 {
    margin: 0.75rem 0.55rem 0.2rem;
    color: var(--color-text-muted);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  [role='option'][aria-selected='true'] {
    background: var(--color-node-selected);
  }
  [role='option']:disabled {
    opacity: 0.65;
  }
  [role='option'] span:first-child {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  em {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-style: normal;
  }
  em {
    grid-column: 1 / -1;
  }
  .binding {
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }
  input:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
</style>
