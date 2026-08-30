<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte'
  import { getContext } from 'svelte'
  import { CANVAS_INSPECTOR_RELATIONSHIP, type CanvasInspectorRelationship, type CanvasNodeData } from './types'

  let {
    data,
    selected = false,
    isConnectable = true,
  }: { data: CanvasNodeData; selected?: boolean; isConnectable?: boolean } = $props()

  const inspectorRelationship = getContext<CanvasInspectorRelationship | undefined>(CANVAS_INSPECTOR_RELATIONSHIP)
  const inspectorControls = $derived(inspectorRelationship?.controls())
  const inspectorExpanded = $derived(Boolean(selected && inspectorRelationship?.expanded()))
</script>

<article
  class="workflow-node"
  class:selected
  class:stale={data.stale}
  class:read-only={data.readOnly}
  data-node-id={data.id}
  aria-label={`${data.kind || 'workflow'} node ${data.id}`}
>
  <Handle
    id="dependency-in"
    type="target"
    position={Position.Left}
    class="workflow-port"
    style="width: 32px; height: 32px;"
    data-port="input"
    role={undefined}
    aria-label={`Dependencies entering ${data.id}`}
    aria-disabled={data.readOnly}
    title={`Dependencies entering ${data.id}`}
    isConnectable={isConnectable && !data.readOnly}
  />
  <header>
    <strong>{data.id}</strong>
    <span class="kind">{data.kind || 'unknown'}</span>
    {#if inspectorControls && inspectorRelationship}
      <button
        type="button"
        class="inspector-trigger nodrag nopan"
        aria-label={`Inspector for ${data.id}`}
        aria-controls={inspectorControls}
        aria-expanded={inspectorExpanded}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
        }}
        onclick={(event) => inspectorRelationship.toggle(data.id, event.currentTarget)}>Inspect</button
      >
    {/if}
  </header>
  <p title={data.summary}>{data.summary || 'No summary'}</p>
  {#if data.errorCount > 0 || data.requiredIssueCount > 0}
    <footer aria-label="Node issues">
      {#if data.requiredIssueCount > 0}
        <span class="badge required">{data.requiredIssueCount} required</span>
      {/if}
      {#if data.errorCount > 0}
        <span class="badge error">{data.errorCount} error{data.errorCount === 1 ? '' : 's'}</span>
      {/if}
    </footer>
  {/if}
  <Handle
    id="dependency-out"
    type="source"
    position={Position.Right}
    class="workflow-port"
    style="width: 32px; height: 32px;"
    data-port="output"
    role={undefined}
    aria-label={`Dependencies leaving ${data.id}`}
    aria-disabled={data.readOnly}
    title={`Dependencies leaving ${data.id}`}
    isConnectable={isConnectable && !data.readOnly}
  />
</article>

<style>
  .workflow-node {
    position: relative;
    width: 13.5rem;
    min-height: 6.5rem;
    overflow: visible;
    border: 1px solid var(--color-edge);
    border-radius: 0.625rem;
    background: var(--color-node);
    box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--color-edge) 16%, transparent);
    font-family: var(--font-sans);
    transition:
      border-color 120ms ease-out,
      background-color 120ms ease-out,
      box-shadow 120ms ease-out;
  }

  .workflow-node.selected,
  .workflow-node:focus-within {
    border-color: var(--color-edge-selected);
    background: var(--color-node-selected);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--color-edge-selected) 30%, transparent),
      0 0.25rem 0.75rem color-mix(in srgb, var(--color-edge) 16%, transparent);
  }

  .workflow-node.stale {
    border-style: dashed;
    opacity: 0.78;
  }

  header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    min-height: 2.25rem;
    padding: 0.45rem 0.7rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-edge) 55%, transparent);
  }

  strong,
  p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }

  .kind {
    flex: none;
    color: var(--color-edge-selected);
    font-size: 0.68rem;
    font-weight: 650;
  }

  .inspector-trigger {
    flex: none;
    min-height: 1.75rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.65rem;
  }

  p {
    margin: 0;
    padding: 0.65rem 0.7rem;
    color: var(--color-text-muted);
    font-size: 0.72rem;
  }

  footer {
    display: flex;
    gap: 0.35rem;
    padding: 0 0.7rem 0.55rem;
  }

  .badge {
    padding: 0.1rem 0.32rem;
    border: 1px solid currentColor;
    border-radius: 0.35rem;
    font-size: 0.58rem;
    font-weight: 700;
  }

  .required,
  .error {
    color: var(--color-error);
  }

  :global(.workflow-port) {
    width: 2rem !important;
    height: 2rem !important;
    border: 0 !important;
    background: transparent !important;
  }

  :global(.workflow-port::after) {
    position: absolute;
    inset: 11px;
    border: 2px solid var(--color-edge);
    border-radius: 50%;
    background: var(--color-node);
    content: '';
  }

  :global(.workflow-port:focus-visible) {
    outline: 3px solid var(--color-edge-selected);
    outline-offset: 1px;
  }

  @media (forced-colors: active) {
    .workflow-node,
    :global(.workflow-port::after) {
      border-color: CanvasText;
    }

    .workflow-node.selected,
    .workflow-node:focus-within {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .workflow-node,
    :global(.workflow-port) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
