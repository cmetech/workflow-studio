<script lang="ts">
  import { onDestroy, onMount, tick, type Snippet } from 'svelte'

  interface Props {
    titleId: string
    describedBy?: string
    busy?: boolean
    dismissible?: boolean
    initialFocusSelector?: string
    opener?: HTMLElement | null
    onCancel: () => void | Promise<void>
    children?: Snippet
    actions?: Snippet
  }

  let {
    titleId,
    describedBy,
    busy = false,
    dismissible = true,
    initialFocusSelector,
    opener,
    onCancel,
    children,
    actions,
  }: Props = $props()
  let dialog: HTMLDialogElement
  let retainedOpener: HTMLElement | null = null
  let cancelling = false
  let destroyed = false

  const focusableSelector = [
    'a[href]',
    'button:not(:disabled)',
    'input:not(:disabled)',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')

  function focusableElements(): HTMLElement[] {
    return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((element) => !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true')
      .sort((left, right) => (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  }

  function focusInitialTarget(): void {
    const requested = initialFocusSelector
      ? dialog.querySelector<HTMLElement>(initialFocusSelector)
      : focusableElements()[0]
    ;(requested ?? focusableElements()[0] ?? dialog).focus()
  }

  function closeDialog(): void {
    if (dialog.open && typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  function isTopmostOpenModal(): boolean {
    return [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) === dialog
  }

  async function restoreOpener(): Promise<void> {
    await tick()
    const topmostOpenDialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)
    if (topmostOpenDialog && retainedOpener && !topmostOpenDialog.contains(retainedOpener)) return
    if (retainedOpener?.isConnected) retainedOpener.focus()
  }

  async function cancel(): Promise<void> {
    if (!dismissible || cancelling) return
    cancelling = true
    closeDialog()
    try {
      await onCancel()
    } finally {
      await restoreOpener()
      if (!destroyed) cancelling = false
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!isTopmostOpenModal()) return
      event.preventDefault()
      event.stopPropagation()
      void cancel()
      return
    }
    if (event.key !== 'Tab') return
    const controls = focusableElements()
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialog.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleNativeCancel(event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    if (!isTopmostOpenModal()) return
    void cancel()
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target !== dialog || !dismissible || !isTopmostOpenModal()) return
    event.preventDefault()
    event.stopPropagation()
    void cancel()
  }

  onMount(() => {
    retainedOpener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    void tick().then(() => {
      if (!destroyed && dialog.open) focusInitialTarget()
    })
  })

  onDestroy(() => {
    destroyed = true
    closeDialog()
    void restoreOpener()
  })
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={titleId}
  aria-modal="true"
  aria-describedby={describedBy}
  aria-busy={busy ? 'true' : undefined}
  data-dialog-backdrop
  tabindex="-1"
  onkeydown={handleKeydown}
  oncancel={handleNativeCancel}
  onclick={handleBackdropClick}
>
  <section class="modal-shell">
    <div class="modal-body" data-modal-body>
      {@render children?.()}
    </div>
    {#if actions}
      <footer class="modal-actions" data-modal-actions>
        {@render actions()}
      </footer>
    {/if}
  </section>
</dialog>

<style>
  dialog {
    box-sizing: border-box;
    width: min(42rem, calc(100vw - 2rem));
    max-width: calc(100vw - 2rem);
    max-height: calc(100vh - 2rem);
    max-block-size: calc(100dvh - 2rem);
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-edge);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 1.25rem 4rem var(--color-shadow);
  }

  dialog::backdrop {
    background: color-mix(in srgb, var(--color-shadow) 68%, transparent);
  }

  .modal-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    max-height: calc(100vh - 2rem);
    max-block-size: calc(100dvh - 2rem);
    min-width: 0;
    min-height: 0;
  }

  .modal-body {
    grid-row: 1 / 3;
    min-width: 0;
    min-height: 0;
    padding: 1rem;
    overflow: auto;
    overflow-wrap: anywhere;
  }

  .modal-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
    min-width: 0;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  @media (max-width: 30rem) {
    .modal-actions {
      align-items: stretch;
    }

    .modal-actions :global(button) {
      flex: 1 1 10rem;
    }
  }

  @media (forced-colors: active) {
    dialog {
      border: 2px solid CanvasText;
    }

    dialog::backdrop {
      background: rgb(0 0 0 / 65%);
    }

    .modal-actions {
      border-color: CanvasText;
    }
  }
</style>
