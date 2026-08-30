<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte'
  import type { CanvasNodeData } from './types'

  let {
    data,
    selected = false,
    isConnectable = true,
  }: { data: CanvasNodeData; selected?: boolean; isConnectable?: boolean } = $props()
</script>

<article
  class="workflow-node"
  class:selected
  class:stale={data.stale}
  class:read-only={data.readOnly}
  aria-label={`${data.kind || 'workflow'} node ${data.id}`}
>
  <Handle
    id="dependency-in"
    type="target"
    position={Position.Left}
    class="workflow-port"
    style="width: 32px; height: 32px;"
    role="button"
    tabindex={data.readOnly ? -1 : 0}
    aria-label={`Dependencies entering ${data.id}`}
    isConnectable={isConnectable && !data.readOnly}
  />
  <header>
    <strong>{data.id}</strong>
    <span class="kind">{data.kind || 'unknown'}</span>
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
    role="button"
    tabindex={data.readOnly ? -1 : 0}
    aria-label={`Dependencies leaving ${data.id}`}
    isConnectable={isConnectable && !data.readOnly}
  />
</article>

<style>
  .workflow-node {
    position: relative;
    width: 13.5rem;
    min-height: 6.5rem;
    overflow: visible;
    border: 1px solid var(--color-border);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface-elevated, var(--color-surface));
    box-shadow: 0 0.55rem 1.35rem var(--color-shadow);
  }

  .workflow-node.selected,
  .workflow-node:focus-within {
    border-color: var(--color-accent);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--color-focus) 30%, transparent),
      0 0.55rem 1.35rem var(--color-shadow);
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
    border-bottom: 1px solid var(--color-border);
  }

  strong,
  p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    min-width: 0;
    font-size: 0.78rem;
  }

  .kind {
    flex: none;
    color: var(--color-accent-strong);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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
    border-radius: 999px;
    font-size: 0.58rem;
    font-weight: 700;
  }

  .required {
    color: var(--color-background);
    background: var(--color-warning);
  }

  .error {
    color: var(--color-background);
    background: var(--color-error);
  }

  :global(.workflow-port) {
    width: 2rem !important;
    height: 2rem !important;
    border: 0 !important;
    background: transparent !important;
  }

  :global(.workflow-port::after) {
    position: absolute;
    inset: 0.65rem;
    border: 2px solid var(--color-edge);
    border-radius: 50%;
    background: var(--color-surface);
    content: '';
  }

  :global(.workflow-port:focus-visible) {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }

  @media (forced-colors: active) {
    .workflow-node,
    :global(.workflow-port::after) {
      border-color: CanvasText;
    }
  }
</style>
