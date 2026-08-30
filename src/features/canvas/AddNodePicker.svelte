<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { NodeKindDescriptor, WorkflowProfile } from '$src/lib/contract/types'
  import { nodeKindAvailable, nodeKindStatus } from './node-kind-options'

  interface Props {
    descriptors: readonly NodeKindDescriptor[]
    profile: WorkflowProfile
    onChoose?: (descriptor: NodeKindDescriptor) => void | Promise<void>
    onClose?: () => void
    opener?: HTMLElement | undefined
  }

  let { descriptors, profile, onChoose, onClose, opener }: Props = $props()
  let query = $state('')
  let activeIndex = $state(0)
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
    return nodeKindAvailable(descriptor, profile)
  }

  function statusLabel(descriptor: NodeKindDescriptor): string {
    return nodeKindStatus(descriptor, profile)
  }

  function safeId(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '-')
  }

  function close(): void {
    onClose?.()
  }

  async function choose(descriptor: NodeKindDescriptor | undefined): Promise<void> {
    if (!descriptor || !available(descriptor)) return
    const focusTarget = opener
    await onChoose?.(descriptor)
    focusTarget?.focus()
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
</script>

<ModalShell
  titleId="add-node-title"
  opener={opener ?? null}
  onCancel={close}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <div class="picker-body">
    <header>
      <div>
        <h2 id="add-node-title">Add node</h2>
        <p>Choose a node kind published by the active contract.</p>
      </div>
    </header>
    <input
      data-modal-initial-focus
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
  {#snippet actions()}
    <button type="button" aria-label="Close node picker" onclick={close}>Close</button>
  {/snippet}
</ModalShell>

<style>
  .picker-body {
    min-width: 0;
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
  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.625rem;
  }
  [role='listbox'] {
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
    overflow-wrap: anywhere;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
</style>
