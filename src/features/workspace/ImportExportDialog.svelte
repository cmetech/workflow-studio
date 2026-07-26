<script lang="ts">
  interface Props {
    mode: 'import' | 'export'
    blockingIssues?: readonly string[]
    paths?: readonly string[]
    collision?: boolean
    onConfirm?: () => void | Promise<void>
    onCancel?: () => void
  }

  let { mode, blockingIssues = [], paths = [], collision = false, onConfirm, onCancel }: Props = $props()
  const buttonLabel = $derived(
    mode === 'import' ? 'Import YAML Pair' : collision ? 'Replace YAML Pair' : 'Export YAML Pair',
  )
</script>

<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="import-export-title">
  <h2 id="import-export-title">{mode === 'import' ? 'Import workflow' : 'Export workflow'}</h2>
  {#if blockingIssues.length > 0}
    <div role="alert">
      <strong>Resolve structural issues before export.</strong>
      <ul>
        {#each blockingIssues as issue (issue)}<li>{issue}</li>{/each}
      </ul>
    </div>
  {:else}
    {#if paths.length > 0}
      <p>{collision ? 'These exact files already exist:' : 'Only these YAML files will be written:'}</p>
      <ul>
        {#each paths as path (path)}<li><code>{path}</code></li>{/each}
      </ul>
    {/if}
    <footer>
      <button type="button" class="secondary" onclick={onCancel}>Cancel</button>
      <button type="button" onclick={() => void onConfirm?.()}>{buttonLabel}</button>
    </footer>
  {/if}
</div>

<style>
  .dialog {
    width: min(34rem, calc(100% - 2rem));
    padding: 1rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
  }

  h2 {
    margin-top: 0;
  }

  [role='alert'] {
    padding: 0.75rem;
    border-left: 0.25rem solid var(--color-danger);
    background: var(--color-node);
  }

  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .secondary {
    color: var(--color-text);
    background: var(--color-node);
  }
</style>
