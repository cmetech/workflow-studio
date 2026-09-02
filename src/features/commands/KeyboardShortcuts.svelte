<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity'
  import { createShortcutHelp, searchShortcutHelp, type ShortcutHelpRow } from '$src/lib/commands/help'
  import type { CommandSurface } from '$src/lib/commands/registry'
  import { currentKeybindingPlatform, type KeybindingPlatform } from '$src/lib/commands/keybindings'

  interface Props {
    registry: CommandSurface
    platform?: KeybindingPlatform
    variant?: 'compact' | 'documentation'
  }

  interface ShortcutCategory {
    readonly name: string
    readonly rows: readonly ShortcutHelpRow[]
  }

  const categoryOrder = ['File', 'Edit', 'View', 'Navigation', 'Workflow', 'Canvas', 'Help']

  let { registry, platform, variant = 'compact' }: Props = $props()
  let query = $state('')
  const rows = $derived(createShortcutHelp(registry, platform ?? currentKeybindingPlatform()))
  const matchingRows = $derived(searchShortcutHelp(rows, query))
  const categories = $derived(groupShortcutRows(matchingRows))

  function groupShortcutRows(rows: readonly ShortcutHelpRow[]): readonly ShortcutCategory[] {
    const byCategory = new SvelteMap<string, ShortcutHelpRow[]>()
    for (const row of rows) {
      const category = byCategory.get(row.category) ?? []
      category.push(row)
      byCategory.set(row.category, category)
    }
    const names = [...byCategory.keys()].sort(
      (left, right) =>
        (categoryOrder.indexOf(left) === -1 ? Number.MAX_SAFE_INTEGER : categoryOrder.indexOf(left)) -
          (categoryOrder.indexOf(right) === -1 ? Number.MAX_SAFE_INTEGER : categoryOrder.indexOf(right)) ||
        left.localeCompare(right),
    )
    return names.map((name) => ({ name, rows: byCategory.get(name) ?? [] }))
  }
</script>

<section class:documentation={variant === 'documentation'} class="shortcuts" aria-label="Keyboard shortcuts">
  <label>
    Search keyboard shortcuts
    <input type="search" aria-label="Search keyboard shortcuts" bind:value={query} />
  </label>

  <div class="shortcut-groups">
    {#each categories as category (category.name)}
      <section class="shortcut-category" aria-labelledby={`shortcut-category-${category.name}`}>
        <h3 id={`shortcut-category-${category.name}`}>{category.name}</h3>
        <div role="list">
          {#each category.rows as row (row.id)}
            <div class="shortcut-row" role="listitem">
              <div class="shortcut-copy">
                <strong>{row.label}</strong>
                {#if variant === 'documentation'}
                  <p>{row.description}</p>
                {:else}
                  <span class="visually-hidden">{row.description}</span>
                {/if}
                <span class="contexts">
                  {#each row.contexts as context (context)}<span>{context}</span>{/each}
                </span>
              </div>
              <span class="bindings" aria-label={`${row.label} binding`}>
                {#each row.bindings as binding (binding)}<kbd>{binding}</kbd>{/each}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <p role="status">No keyboard shortcuts match “{query}”.</p>
    {/each}
  </div>
</section>

<style>
  .shortcuts {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    padding: 1rem;
  }
  label {
    display: grid;
    gap: 0.35rem;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.25rem;
  }
  .shortcut-groups {
    display: grid;
    gap: var(--space-3);
    max-block-size: min(60vh, 38rem);
    overflow: auto;
    overscroll-behavior: contain;
  }
  .documentation .shortcut-groups {
    max-block-size: min(68vh, 48rem);
  }
  .shortcut-category {
    display: grid;
    gap: var(--space-1);
  }
  h3,
  p {
    margin: 0;
  }
  [role='list'] {
    border-top: 1px solid var(--color-border);
  }
  .shortcut-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: start;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .shortcut-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }
  .shortcut-copy p,
  .contexts {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }
  .contexts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.5rem;
  }
  .bindings {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 0.35rem;
    min-width: 0;
  }
  kbd {
    max-width: 100%;
    padding: 0.15rem 0.35rem;
    overflow-wrap: anywhere;
    color: var(--color-text);
    font-family: var(--font-mono);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
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
  input:focus-visible,
  kbd:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (max-width: 32rem) {
    .shortcut-row {
      grid-template-columns: minmax(0, 1fr);
    }
    .bindings {
      justify-content: start;
    }
  }
  @media (forced-colors: active) {
    [role='list'],
    .shortcut-row,
    kbd {
      border-color: CanvasText;
    }
    kbd {
      color: CanvasText;
      background: Canvas;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
