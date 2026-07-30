<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { applyBrandTheme } from '$src/lib/branding/load-brand'
  import type { RuntimeBrandPack, ThemeMode } from '$src/lib/branding/types'

  interface Props {
    pack: RuntimeBrandPack
    mode: ThemeMode
    pending?: boolean
    opener?: HTMLElement | undefined
    onClose: () => void
    onActivate: () => void | Promise<void>
  }

  let { pack, mode, pending = false, opener, onClose, onActivate }: Props = $props()
  let dialog: HTMLDialogElement
  let previewRoot: HTMLElement
  let closeButton: HTMLButtonElement

  $effect(() => {
    if (previewRoot) applyBrandTheme(pack.manifest, mode, previewRoot)
  })

  onMount(() => closeButton.focus())
  onDestroy(() => {
    if (opener?.isConnected) opener.focus()
  })

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!pending) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled)')]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
</script>

<dialog
  bind:this={dialog}
  open
  aria-modal="true"
  aria-labelledby="brand-preview-title"
  aria-busy={pending}
  onkeydown={keydown}
>
  <section bind:this={previewRoot} data-testid="brand-preview-root" class="preview-root">
    <header>
      <img src={pack.assetUrls.logo} alt="" />
      <div>
        <p>Runtime brand preview</p>
        <h2 id="brand-preview-title">Preview {pack.manifest.displayName}</h2>
      </div>
    </header>
    <div class="sample-card">
      <strong>Workflow authoring</strong>
      <p>This preview is isolated. It does not change the active application theme.</p>
      <button type="button">Sample focused control</button>
    </div>
    {#each pack.issues as issue (issue.code + issue.mode)}
      <p role={issue.severity === 'error' ? 'alert' : 'status'}>{issue.mode}: {issue.message}</p>
    {/each}
    <footer>
      <button bind:this={closeButton} type="button" disabled={pending} onclick={onClose}>Close preview</button>
      <button type="button" disabled={pending || !pack.canActivate} onclick={() => void onActivate()}>
        Activate {pack.manifest.displayName}
      </button>
    </footer>
  </section>
</dialog>

<style>
  dialog {
    width: min(42rem, calc(100vw - 2rem));
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
  }
  .preview-root {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    color: var(--color-text);
    background: var(--color-background);
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  header,
  footer {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  header img {
    width: 8rem;
    max-height: 3rem;
    object-fit: contain;
  }
  header p,
  header h2 {
    margin: 0;
  }
  .sample-card {
    display: grid;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface);
  }
  footer {
    justify-content: flex-end;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .preview-root {
      transition: none;
    }
  }
</style>
