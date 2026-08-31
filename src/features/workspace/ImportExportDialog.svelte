<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'

  interface Props {
    mode: 'import' | 'export'
    blockingIssues?: readonly string[]
    paths?: readonly string[]
    collision?: boolean
    onConfirm?: () => void | Promise<void>
    onCancel?: () => void
    opener?: HTMLElement | undefined
  }

  let { mode, blockingIssues = [], paths = [], collision = false, onConfirm, onCancel, opener }: Props = $props()
  const buttonLabel = $derived(
    mode === 'import' ? 'Import YAML Pair' : collision ? 'Replace YAML Pair' : 'Export YAML Pair',
  )

  function cancel(): void {
    onCancel?.()
  }

  async function confirm(): Promise<void> {
    const focusTarget = opener
    await onConfirm?.()
    focusTarget?.focus()
  }
</script>

<ModalShell
  titleId="import-export-title"
  opener={opener ?? null}
  onCancel={cancel}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <div class="import-export-body">
    <h2 id="import-export-title">{mode === 'import' ? 'Import workflow' : 'Export workflow'}</h2>
    {#if blockingIssues.length > 0}
      <div role="alert">
        <strong>Resolve structural issues before export.</strong>
        <ul>
          {#each blockingIssues as issue, occurrence (`${issue}\0${occurrence}`)}<li>{issue}</li>{/each}
        </ul>
      </div>
    {:else}
      {#if paths.length > 0}
        <p>{collision ? 'These exact files already exist:' : 'Only these YAML files will be written:'}</p>
        <ul>
          {#each paths as path (path)}<li><code>{path}</code></li>{/each}
        </ul>
      {/if}
    {/if}
  </div>
  {#snippet actions()}
    {#if blockingIssues.length > 0}
      <button data-modal-initial-focus type="button" data-variant="secondary" onclick={cancel}>Close</button>
    {:else}
      <button data-modal-initial-focus type="button" data-variant="secondary" onclick={cancel}>Cancel</button>
      <button type="button" data-variant={collision ? 'danger' : 'primary'} onclick={() => void confirm()}
        >{buttonLabel}</button
      >
    {/if}
  {/snippet}
</ModalShell>

<style>
  .import-export-body {
    min-width: 0;
  }

  h2 {
    margin-top: 0;
  }

  [role='alert'] {
    padding: 0.75rem;
    border-left: 0.25rem solid var(--color-error);
    background: var(--color-node);
  }

  code {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
</style>
