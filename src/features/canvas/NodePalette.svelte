<script module lang="ts">
  export { NODE_KIND_DRAG_TYPE } from './node-kind-options'
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import { nodeChordForKind } from '$src/lib/commands/node-chords'
  import type { NodeKindDescriptor, WorkflowProfile } from '$src/lib/contract/types'
  import { NODE_KIND_DRAG_TYPE, nodeKindAvailable, nodeKindStatus } from './node-kind-options'

  interface Props {
    descriptors: readonly NodeKindDescriptor[]
    profile: WorkflowProfile
    disabledReason?: string | undefined
    onChoose?: (descriptor: NodeKindDescriptor) => void | Promise<void>
  }

  let { descriptors, profile, disabledReason, onChoose }: Props = $props()
  let dragGhost: HTMLElement | null = null
  const ordered = $derived(
    [...descriptors].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
  )

  function available(descriptor: NodeKindDescriptor): boolean {
    return !disabledReason && nodeKindAvailable(descriptor, profile)
  }

  function choose(descriptor: NodeKindDescriptor): void {
    if (available(descriptor)) void onChoose?.(descriptor)
  }

  function startDrag(event: DragEvent, descriptor: NodeKindDescriptor): void {
    if (!available(descriptor) || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    removeDragGhost()
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(NODE_KIND_DRAG_TYPE, descriptor.id)
    dragGhost = document.createElement('div')
    dragGhost.dataset.nodeDragGhost = 'true'
    dragGhost.textContent = descriptor.label
    Object.assign(dragGhost.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      padding: '6px 10px',
      border: '1px solid var(--color-edge)',
      borderRadius: '6px',
      color: 'var(--color-text)',
      background: 'var(--color-node)',
    })
    document.body.append(dragGhost)
    event.dataTransfer.setDragImage(dragGhost, 12, 12)
  }

  function removeDragGhost(): void {
    dragGhost?.remove()
    dragGhost = null
  }

  onDestroy(removeDragGhost)
</script>

<section class="node-palette" aria-labelledby="nodes-palette-title">
  <header>
    <p class="eyebrow">Authoring</p>
    <h2 id="nodes-palette-title">Nodes</h2>
    <p>Choose or drag a node kind published by the active contract.</p>
  </header>

  {#if disabledReason}
    <p class="unavailable" role="status">{disabledReason}</p>
  {/if}

  <div class="node-kinds" aria-label="Contract node kinds">
    {#each ordered as descriptor (descriptor.id)}
      {@const status = nodeKindStatus(descriptor, profile)}
      {@const chord = nodeChordForKind(descriptor.id)}
      <button
        type="button"
        class:supported={available(descriptor)}
        aria-label={available(descriptor)
          ? `Add ${descriptor.label} node`
          : `${descriptor.label} node — ${disabledReason ?? status}`}
        disabled={!available(descriptor)}
        draggable={available(descriptor)}
        onclick={() => choose(descriptor)}
        ondragstart={(event) => startDrag(event, descriptor)}
        ondragend={removeDragGhost}
      >
        <span class="node-kind-title">
          <strong>{descriptor.label}</strong>
          <span class="metadata">
            {#if chord}<kbd>{chord}</kbd>{/if}
            <small>{status}</small>
          </span>
        </span>
        <span class="description">{descriptor.description}</span>
      </button>
    {:else}
      {#if !disabledReason}
        <p class="unavailable" role="status">The active contract publishes no node kinds.</p>
      {/if}
    {/each}
  </div>
</section>

<style>
  .node-palette {
    min-height: 100%;
    color: var(--color-text);
  }
  header,
  .node-kinds {
    padding: 0.75rem;
  }
  header {
    border-bottom: 1px solid var(--color-border);
  }
  h2,
  .eyebrow,
  header p {
    margin: 0;
  }
  .eyebrow {
    color: var(--color-accent);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h2 {
    margin-top: 0.12rem;
    font-size: 1rem;
  }
  header p:last-child,
  .description {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  header p:last-child {
    margin-top: 0.25rem;
  }
  .unavailable {
    margin: 0.75rem;
    padding: 0.65rem;
    border: 1px solid var(--color-border);
    border-radius: 0.4rem;
    color: var(--color-text-muted);
    background: var(--color-node);
    font-size: 0.76rem;
  }
  .node-kinds {
    display: grid;
    gap: 0.45rem;
  }
  button {
    display: grid;
    gap: 0.3rem;
    width: 100%;
    padding: 0.65rem;
    border: 1px solid var(--color-border);
    border-radius: 0.45rem;
    color: var(--color-text);
    background: var(--color-node);
    text-align: left;
  }
  button.supported:hover {
    border-color: var(--color-edge);
    background: var(--color-node-selected);
  }
  button:disabled {
    opacity: 0.64;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  .node-kind-title,
  .metadata {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    justify-content: space-between;
  }
  .metadata {
    justify-content: end;
  }
  kbd {
    padding: 0.08rem 0.3rem;
    border: 1px solid var(--color-border);
    border-radius: 0.22rem;
    font-size: 0.65rem;
  }
  small {
    color: var(--color-text-muted);
    font-size: 0.65rem;
    text-transform: capitalize;
  }
</style>
