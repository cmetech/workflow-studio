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
  let fallbackModal = $state(false)

  interface InertSnapshot {
    node: HTMLElement
    hadInert: boolean
    ariaHidden: string | null
  }

  function isolateFallbackModal(node: HTMLDialogElement): () => void {
    const snapshots: InertSnapshot[] = []
    let branch: HTMLElement = node
    while (branch !== document.body && branch.parentElement) {
      const parent = branch.parentElement
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue
        snapshots.push({
          node: sibling,
          hadInert: sibling.hasAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        })
        sibling.setAttribute('inert', '')
        sibling.setAttribute('aria-hidden', 'true')
      }
      branch = parent
    }
    node.setAttribute('open', '')
    fallbackModal = true

    return () => {
      fallbackModal = false
      for (const snapshot of snapshots.reverse()) {
        if (!snapshot.hadInert) snapshot.node.removeAttribute('inert')
        if (snapshot.ariaHidden === null) snapshot.node.removeAttribute('aria-hidden')
        else snapshot.node.setAttribute('aria-hidden', snapshot.ariaHidden)
      }
    }
  }

  $effect(() => {
    if (previewRoot) applyBrandTheme(pack.manifest, mode, previewRoot)
  })

  onMount(() => {
    let restoreFallback = () => {}
    let openedModally = false
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal()
        openedModally = true
      } catch {
        restoreFallback = isolateFallbackModal(dialog)
      }
    } else {
      restoreFallback = isolateFallbackModal(dialog)
    }
    closeButton.focus()

    return () => {
      restoreFallback()
      if ((openedModally || dialog.open) && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  })
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

  function cancel(event: Event): void {
    event.preventDefault()
    if (!pending) onClose()
  }
</script>

<dialog
  bind:this={dialog}
  class:fallback-modal={fallbackModal}
  aria-modal="true"
  aria-labelledby="brand-preview-title"
  aria-busy={pending}
  oncancel={cancel}
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
  dialog::backdrop {
    background: color-mix(in srgb, var(--color-background) 72%, transparent);
  }
  dialog.fallback-modal {
    position: fixed;
    inset: 0;
    margin: auto;
    box-shadow: 0 0 0 100vmax color-mix(in srgb, var(--color-background) 72%, transparent);
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
