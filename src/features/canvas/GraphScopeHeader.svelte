<script lang="ts">
  let {
    workflowName,
    groupId,
    onBack,
    onEditGroupSettings,
  }: {
    workflowName: string
    groupId: string
    onBack: () => void | Promise<void>
    onEditGroupSettings?: (invoker: HTMLElement) => void | Promise<void>
  } = $props()
</script>

<header class="scope-header" data-canvas-chrome>
  <button type="button" data-variant="ghost" aria-label="Back to root workflow" onclick={() => void onBack()}
    >Back</button
  >
  <h2 tabindex="-1" data-scope-heading>{workflowName} / {groupId} loop body</h2>
  {#if onEditGroupSettings}<button
      type="button"
      data-variant="secondary"
      onclick={(event) => void onEditGroupSettings(event.currentTarget)}>Edit Group Settings</button
    >{/if}
</header>

<style>
  .scope-header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  h2 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
  }
  h2:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    .scope-header {
      border-color: CanvasText;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scope-header,
    .scope-header * {
      scroll-behavior: auto !important;
      transition: none !important;
    }
  }
</style>
