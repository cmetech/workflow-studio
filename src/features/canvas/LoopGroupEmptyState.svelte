<script lang="ts">
  let {
    groupId,
    onAddNode,
    onEditGroupSettings,
  }: {
    groupId: string
    onAddNode: () => void | Promise<void>
    onEditGroupSettings: (invoker: HTMLElement) => void | Promise<void>
  } = $props()
</script>

<section class="empty-state" aria-label={`Empty loop body for ${groupId}`}>
  <h3>This loop body has no nodes</h3>
  <p>The repairable draft is preserved exactly as:</p>
  <pre><code
      ><span>loop_group:</span>
  <span>nodes: []</span></code
    ></pre>
  <p>Save and export remain blocked until the group has the required settings and a valid body.</p>
  <div class="actions">
    <button type="button" data-variant="primary" onclick={() => void onAddNode()}>Add First Node</button>
    <button type="button" data-variant="secondary" onclick={(event) => void onEditGroupSettings(event.currentTarget)}
      >Edit Group Settings</button
    >
  </div>
</section>

<style>
  .empty-state {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(32rem, calc(100% - 2rem));
    min-width: 0;
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  h3 {
    margin-top: 0;
  }
  pre {
    overflow: auto;
    padding: var(--space-3);
    background: var(--color-canvas);
  }
  code {
    display: grid;
    font-family: var(--font-mono);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  @media (forced-colors: active) {
    .empty-state {
      border-color: CanvasText;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .empty-state,
    .empty-state * {
      scroll-behavior: auto !important;
    }
  }
</style>
