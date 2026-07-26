<script lang="ts">
  import { onMount } from 'svelte'
  import type { WorkspaceEntry } from '$src/lib/workspace/types'

  interface Props {
    entries: readonly WorkspaceEntry[]
    onOpen?: (entry: WorkspaceEntry) => void
    onClose?: () => void
  }

  let { entries, onOpen, onClose }: Props = $props()
  let query = $state('')
  let activeIndex = $state(0)
  let searchInput: HTMLInputElement
  const results = $derived(
    entries.filter((entry) =>
      `${entry.name}\n${entry.relativePath}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ),
  )

  function open(index: number): void {
    const entry = results[index]
    if (entry) onOpen?.(entry)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeIndex = Math.min(activeIndex + 1, results.length - 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex = Math.max(activeIndex - 1, 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      open(activeIndex)
    }
  }

  onMount(() => searchInput.focus())
</script>

<section class="quick-open" aria-label="Quick Open">
  <input
    bind:this={searchInput}
    role="combobox"
    aria-label="Quick Open workflows"
    aria-controls="quick-open-results"
    aria-expanded="true"
    aria-autocomplete="list"
    bind:value={query}
    oninput={() => (activeIndex = 0)}
    onkeydown={handleKeydown}
    placeholder="Search workflow name or path"
  />
  <div id="quick-open-results" role="listbox" aria-label="Workflow matches">
    {#each results as entry, index (entry.id)}
      <button
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        onmouseenter={() => (activeIndex = index)}
        onclick={() => open(index)}
      >
        <strong>{entry.name}</strong><span>{entry.relativePath}</span>
      </button>
    {/each}
  </div>
</section>

<style>
  .quick-open {
    position: absolute;
    z-index: 30;
    top: 4rem;
    left: 50%;
    width: min(38rem, calc(100% - 2rem));
    padding: 0.5rem;
    transform: translateX(-50%);
    border: 1px solid var(--color-edge);
    border-radius: 0.5rem;
    background: var(--color-surface);
    box-shadow: 0 1rem 3rem var(--color-shadow);
  }

  input,
  button {
    width: 100%;
  }

  input {
    box-sizing: border-box;
    min-height: 2.5rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-background);
  }

  [role='listbox'] {
    max-height: 20rem;
    overflow: auto;
  }

  [role='option'] {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    gap: 1rem;
    justify-items: start;
    min-height: 2.25rem;
    border: 0;
    color: var(--color-text);
    background: transparent;
    text-align: left;
  }

  [role='option'][aria-selected='true'] {
    background: var(--color-node-selected);
  }

  [role='option'] span {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .quick-open {
      scroll-behavior: auto;
    }
  }
</style>
