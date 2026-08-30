<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { DeleteImpact } from './canvas-actions'

  interface Props {
    impact: DeleteImpact
    onConfirm?: () => void | Promise<void>
    onCancel?: () => void
    opener?: HTMLElement | undefined
  }

  let { impact, onConfirm, onCancel, opener }: Props = $props()
  const requiresResolution = $derived(impact.references.length > 0)

  function cancel(): void {
    onCancel?.()
  }

  async function confirm(): Promise<void> {
    if (requiresResolution) return
    const focusTarget = opener
    await onConfirm?.()
    focusTarget?.focus()
  }
</script>

<ModalShell
  titleId="delete-impact-title"
  opener={opener ?? null}
  onCancel={cancel}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <div class="delete-impact-body">
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
  </div>
  {#snippet actions()}
    <button data-modal-initial-focus type="button" data-variant="secondary" onclick={cancel}>Cancel</button>
    <button type="button" data-variant="danger" disabled={requiresResolution} onclick={() => void confirm()}
      >Delete nodes</button
    >
  {/snippet}
</ModalShell>

<style>
  .delete-impact-body {
    min-width: 0;
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
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
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

  button {
    min-height: 2rem;
  }
  button:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
