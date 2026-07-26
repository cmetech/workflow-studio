<footer
  class="status-bar"
  role="status"
  aria-label="Application status"
  style:background-color="var(--color-node-selected)"
>
  <span>Git: no workspace</span>
  <span>YAML: pending</span>
  <span>DAG: pending</span>
  <span class="update">Offline ready</span>
</footer>

<style>
  .status-bar {
    display: flex;
    gap: 1rem;
    align-items: center;
    min-height: 1.75rem;
    padding: 0 0.75rem;
    border-top: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-node-selected);
    font-size: 0.6875rem;
  }

  .update {
    margin-left: auto;
    color: var(--color-focus);
  }
</style>
