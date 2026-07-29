<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { NodeKindDescriptor, WorkflowProfile } from '$src/lib/contract/types'

  interface Props {
    descriptors: readonly NodeKindDescriptor[]
    profile: WorkflowProfile
    onChoose?: (descriptor: NodeKindDescriptor) => void | Promise<void>
    onClose?: () => void
    opener?: HTMLElement | undefined
  }

  let { descriptors, profile, onChoose, onClose, opener }: Props = $props()
  let dialog = $state<HTMLDivElement>()
  let search = $state<HTMLInputElement>()
  let closeButton = $state<HTMLButtonElement>()
  let query = $state('')
  let activeIndex = $state(0)
  let retainedOpener: HTMLElement | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  const results = $derived(
    descriptors
      .filter((descriptor) =>
        `${descriptor.label}\n${descriptor.description}`.toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (left, right) =>
          Number(!available(left)) - Number(!available(right)) ||
          left.order - right.order ||
          left.label.localeCompare(right.label),
      ),
  )
  const active = $derived(results[activeIndex])
  const activeId = $derived(active ? `add-node-${safeId(active.id)}` : undefined)

  function available(descriptor: NodeKindDescriptor): boolean {
    return descriptor.status === 'supported' && descriptor.applicability.profiles.includes(profile)
  }

  function statusLabel(descriptor: NodeKindDescriptor): string {
    if (!descriptor.applicability.profiles.includes(profile)) return `not available in ${profile}`
    return descriptor.status
  }

  function safeId(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '-')
  }

  function restoreOpener(): void {
    if (retainedOpener?.isConnected) retainedOpener.focus()
  }

  function close(): void {
    onClose?.()
    restoreOpener()
  }

  async function choose(descriptor: NodeKindDescriptor | undefined): Promise<void> {
    if (!descriptor || !available(descriptor)) return
    await onChoose?.(descriptor)
    restoreOpener()
  }

  function nextAvailable(start: number, direction: 1 | -1): number {
    if (results.length === 0) return 0
    let index = start
    for (let offset = 0; offset < results.length; offset += 1) {
      index = (index + direction + results.length) % results.length
      if (available(results[index]!)) return index
    }
    return start
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeIndex = nextAvailable(activeIndex, 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex = nextAvailable(activeIndex, -1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void choose(active)
    }
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const options = [...(dialog?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])]
    const focusable = [search, ...options, closeButton].filter((element): element is HTMLElement => Boolean(element))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMount(() => {
    retainedOpener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    search?.focus()
    focusTimer = setTimeout(() => search?.focus(), 0)
  })
  onDestroy(() => {
    if (focusTimer) clearTimeout(focusTimer)
    restoreOpener()
  })
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && close()}>
  <div
    bind:this={dialog}
    class="picker"
    role="dialog"
    aria-modal="true"
    aria-labelledby="add-node-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}
  >
    <header>
      <div>
        <h2 id="add-node-title">Add node</h2>
        <p>Choose a node kind published by the active contract.</p>
      </div>
      <button bind:this={closeButton} type="button" aria-label="Close node picker" onclick={close}>×</button>
    </header>
    <input
      bind:this={search}
      role="combobox"
      aria-label="Search node kinds"
      aria-controls="add-node-results"
      aria-expanded="true"
      aria-autocomplete="list"
      aria-activedescendant={activeId}
      bind:value={query}
      oninput={() => (activeIndex = 0)}
      onkeydown={handleSearchKeydown}
      placeholder="Search node kinds"
    />
    <div id="add-node-results" role="listbox" aria-label="Node kinds">
      {#each results as descriptor, index (descriptor.id)}
        <button
          id={`add-node-${safeId(descriptor.id)}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          aria-disabled={!available(descriptor)}
          disabled={!available(descriptor)}
          onmouseenter={() => (activeIndex = index)}
          onclick={() => void choose(descriptor)}
        >
          <span class="title"><strong>{descriptor.label}</strong><small>{statusLabel(descriptor)}</small></span>
          <span class="description">{descriptor.description}</span>
        </button>
      {/each}
      {#if results.length === 0}<p role="status">No contract node kinds match “{query}”.</p>{/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    z-index: 54;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-shadow) 64%, transparent);
  }

  .picker {
    width: min(36rem, calc(100% - 2rem));
    padding: 0.75rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 1rem 3rem var(--color-shadow);
  }

  header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: start;
  }
  h2 {
    margin: 0;
  }
  header p {
    margin: 0.2rem 0 0.7rem;
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }
  header button {
    width: 2rem;
    min-height: 2rem;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.625rem;
  }
  [role='listbox'] {
    max-height: 22rem;
    overflow: auto;
    margin-top: 0.4rem;
  }
  [role='option'] {
    display: grid;
    width: 100%;
    gap: 0.2rem;
    padding: 0.6rem;
    border: 0;
    color: var(--color-text);
    background: transparent;
    text-align: left;
  }
  [role='option'][aria-selected='true'] {
    background: var(--color-node-selected);
  }
  [role='option']:disabled {
    opacity: 0.62;
  }
  .title {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  small {
    color: var(--color-text-muted);
    text-transform: capitalize;
  }
  .description {
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
</style>
