<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { DeleteImpact } from './canvas-actions'

  interface Props {
    impact: DeleteImpact
    onConfirm?: () => void | Promise<void>
    onCancel?: () => void
    opener?: HTMLElement | undefined
  }

  let { impact, onConfirm, onCancel, opener }: Props = $props()
  let dialog = $state<HTMLDivElement>()
  let cancelButton = $state<HTMLButtonElement>()
  let retainedOpener: HTMLElement | undefined
  const requiresResolution = $derived(impact.references.length > 0)

  function restoreOpener(): void {
    if (retainedOpener?.isConnected) retainedOpener.focus()
  }

  function cancel(): void {
    onCancel?.()
    restoreOpener()
  }

  async function confirm(): Promise<void> {
    if (requiresResolution) return
    await onConfirm?.()
    restoreOpener()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
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
    cancelButton?.focus()
  })
  onDestroy(restoreOpener)
</script>

<div
  class="backdrop"
  role="presentation"
  data-dialog-backdrop
  onclick={(event) => event.target === event.currentTarget && cancel()}
>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-impact-title"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <h2 id="delete-impact-title">Delete selected nodes</h2>
    <p>The following nodes will be removed:</p>
    <ul class="node-list">
      {#each impact.nodeIds as nodeId (nodeId)}<li><code>{nodeId}</code></li>{/each}
    </ul>

    {#if impact.dependencies.length > 0}
      <section aria-labelledby="dependency-impact-title">
        <h3 id="dependency-impact-title">Dependency entries removed</h3>
        <ul>
          {#each impact.dependencies as dependency (dependency.key)}
            <li>
              <strong>{dependency.nodeId} · {dependency.fieldPath.join('.')}</strong> removes
              <code>{dependency.dependencyId}</code>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if impact.references.length > 0}
      <section aria-labelledby="reference-impact-title">
        <h3 id="reference-impact-title">References requiring resolution</h3>
        <ul>
          {#each impact.references as reference (reference.key)}
            <li>
              <strong>{reference.nodeId} · {reference.fieldPath.join('.')}</strong>
              <code>{reference.value}</code>
            </li>
          {/each}
        </ul>
        <p role="status">Resolve every textual reference in YAML before deleting these nodes.</p>
      </section>
    {/if}

    <footer>
      <button bind:this={cancelButton} type="button" class="secondary" onclick={cancel}>Cancel</button>
      <button type="button" disabled={requiresResolution} onclick={() => void confirm()}>Delete nodes</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    z-index: 55;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-shadow) 68%, transparent);
  }

  .dialog {
    width: min(38rem, calc(100% - 2rem));
    max-height: min(42rem, calc(100% - 2rem));
    overflow: auto;
    padding: 1rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
  }

  h2 {
    margin-top: 0;
  }
  h3 {
    margin-bottom: 0.35rem;
    font-size: 0.85rem;
  }
  ul {
    margin-top: 0.25rem;
    padding-left: 1.25rem;
  }
  li {
    margin-block: 0.3rem;
  }
  li code {
    display: block;
    margin-top: 0.15rem;
    color: var(--color-text-muted);
  }
  .node-list code {
    display: inline;
    color: var(--color-text);
  }

  [role='status'] {
    padding: 0.6rem;
    border-left: 0.25rem solid var(--color-warning);
    background: var(--color-node);
  }

  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  button {
    min-height: 2rem;
  }
  .secondary {
    color: var(--color-text);
    background: var(--color-node);
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
