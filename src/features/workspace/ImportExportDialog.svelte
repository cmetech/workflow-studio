<script lang="ts">
  import { onDestroy, onMount } from 'svelte'

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
  let retainedOpener: HTMLElement | undefined
  let dialog = $state<HTMLDivElement>()
  let cancelButton = $state<HTMLButtonElement>()
  const buttonLabel = $derived(
    mode === 'import' ? 'Import YAML Pair' : collision ? 'Replace YAML Pair' : 'Export YAML Pair',
  )

  function cancel(): void {
    onCancel?.()
    retainedOpener?.focus()
  }

  async function confirm(): Promise<void> {
    await onConfirm?.()
    retainedOpener?.focus()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMount(() => {
    retainedOpener = opener
    cancelButton?.focus()
  })
  onDestroy(() => retainedOpener?.focus())
</script>

<div
  role="presentation"
  class="backdrop"
  data-dialog-backdrop
  onclick={(event) => event.target === event.currentTarget && cancel()}
>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="import-export-title"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <h2 id="import-export-title">{mode === 'import' ? 'Import workflow' : 'Export workflow'}</h2>
    {#if blockingIssues.length > 0}
      <div role="alert">
        <strong>Resolve structural issues before export.</strong>
        <ul>
          {#each blockingIssues as issue (issue)}<li>{issue}</li>{/each}
        </ul>
      </div>
      <footer>
        <button bind:this={cancelButton} type="button" data-variant="secondary" onclick={cancel}>Close</button>
      </footer>
    {:else}
      {#if paths.length > 0}
        <p>{collision ? 'These exact files already exist:' : 'Only these YAML files will be written:'}</p>
        <ul>
          {#each paths as path (path)}<li><code>{path}</code></li>{/each}
        </ul>
      {/if}
      <footer>
        <button bind:this={cancelButton} type="button" data-variant="secondary" onclick={cancel}>Cancel</button>
        <button type="button" data-variant={collision ? 'danger' : 'primary'} onclick={() => void confirm()}
          >{buttonLabel}</button
        >
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-shadow) 65%, transparent);
  }

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
    border-left: 0.25rem solid var(--color-error);
    background: var(--color-node);
  }

  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  code {
    font-family: var(--font-mono);
  }
</style>
