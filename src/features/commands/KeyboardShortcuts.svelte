<script lang="ts">
  import type { CommandSurface } from '$src/lib/commands/registry'
  import { displayKeybindings, type KeybindingPlatform } from '$src/lib/commands/keybindings'

  interface Props {
    registry: CommandSurface
    platform?: KeybindingPlatform
  }
  let { registry, platform }: Props = $props()
  let query = $state('')
  const commands = $derived(
    registry
      .listCommands()
      .filter(
        (command) => command.defaultBindings.length > 0 && command.label.toLowerCase().includes(query.toLowerCase()),
      ),
  )
</script>

<section class="shortcuts" aria-label="Keyboard shortcuts">
  <label
    >Search keyboard shortcuts <input type="search" aria-label="Search keyboard shortcuts" bind:value={query} /></label
  >
  <div role="list">
    {#each commands as command (command.id)}
      <div role="listitem">
        <span>{command.label}</span><kbd>{displayKeybindings(command.defaultBindings, platform).join(' / ')}</kbd>
      </div>
    {:else}<p role="status">No keyboard shortcuts match “{query}”.</p>
    {/each}
  </div>
</section>

<style>
  .shortcuts {
    padding: 1rem;
  }
  label {
    display: grid;
    gap: 0.35rem;
  }
  input {
    min-height: 2rem;
  }
  [role='list'] {
    margin-top: 0.8rem;
  }
  [role='listitem'] {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  kbd {
    font-family: ui-monospace, monospace;
  }
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
</style>
