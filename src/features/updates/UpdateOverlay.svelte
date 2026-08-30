<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import ExpandableLog from '$src/features/setup/ExpandableLog.svelte'
  import { formatBytes } from '$src/lib/updates/format'
  import type { UpdateState } from '$src/lib/updates/types'

  interface Props {
    state: UpdateState
    copyText?: (text: string) => Promise<void>
    ondownload?: (runId: string) => void | Promise<void>
    onlater?: (runId: string) => void | Promise<void>
    oncancel?: (runId: string) => void | Promise<void>
    onretry?: () => void | Promise<void>
    onopenlog?: (runId: string) => void | Promise<void>
    onrelaunch?: () => void | Promise<void>
  }
  let {
    state: update,
    copyText = (text) => navigator.clipboard.writeText(text),
    ondownload = () => undefined,
    onlater = () => undefined,
    oncancel = () => undefined,
    onretry = () => undefined,
    onopenlog = () => undefined,
    onrelaunch = () => undefined,
  }: Props = $props()
  let dialog: HTMLDialogElement
  let detailsButton: HTMLButtonElement
  let expanded = $state(false)
  let fallbackModal = $state(false)
  let actionIdentity = $state('')
  let actionGeneration = 0
  const pending = new SvelteSet<string>()
  const notes = $derived(update.release?.notes.replace(/\s+/g, ' ').trim() ?? '')
  const byteSummary = $derived(
    update.totalBytes === null
      ? `${formatBytes(update.downloadedBytes)} downloaded${update.speedBytesPerSecond === null ? '' : ` · ${formatBytes(update.speedBytesPerSecond)}/s`}`
      : `${formatBytes(update.downloadedBytes)} of ${formatBytes(update.totalBytes)}${update.speedBytesPerSecond === null ? '' : ` · ${formatBytes(update.speedBytesPerSecond)}/s`}`,
  )

  $effect(() => {
    if (update.logExpanded) expanded = true
    const next = `${update.runId}\0${update.phase}`
    if (next === actionIdentity) return
    actionIdentity = next
    actionGeneration += 1
    pending.clear()
  })

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let restoreFallback: () => void = () => undefined
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal()
      } catch {
        restoreFallback = isolateFallbackModal(dialog)
      }
    } else restoreFallback = isolateFallbackModal(dialog)
    detailsButton.focus()
    return () => {
      restoreFallback()
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      if (opener?.isConnected) opener.focus()
    }
  })

  function isolateFallbackModal(node: HTMLDialogElement): () => void {
    const snapshots: { node: HTMLElement; inert: boolean; ariaHidden: string | null }[] = []
    let branch: HTMLElement = node
    while (branch !== document.body && branch.parentElement) {
      const parent = branch.parentElement
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue
        snapshots.push({
          node: sibling,
          inert: sibling.hasAttribute('inert'),
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
        if (!snapshot.inert) snapshot.node.removeAttribute('inert')
        if (snapshot.ariaHidden === null) snapshot.node.removeAttribute('aria-hidden')
        else snapshot.node.setAttribute('aria-hidden', snapshot.ariaHidden)
      }
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      return
    }
    if (event.key !== 'Tab') return
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')]
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

  async function act(key: string, action: () => void | Promise<void>): Promise<void> {
    if (pending.has(key)) return
    pending.add(key)
    const generation = actionGeneration
    try {
      await action()
    } catch {
      /* Controller surfaces native failures. */
    } finally {
      if (generation === actionGeneration) {
        pending.delete(key)
      }
    }
  }

  const statusText = (phase: UpdateState['phase']): string =>
    ({
      idle: 'Ready to check for updates.',
      checking: 'Checking for updates.',
      current: 'Workflow Studio is current.',
      available: 'An update is available.',
      downloading: `Downloading update. ${byteSummary}`,
      verifying: 'Verifying the signed update.',
      installing: 'Installing update. Do not close Workflow Studio.',
      'restart-required': 'Update installed. Relaunch to finish.',
      deferred: 'Update deferred until later.',
      cancelling: 'Finishing update cancellation safely.',
      'recheck-required': 'Download cancelled. Check again before installing.',
      dismissed: 'Update notification dismissed.',
      failed: 'Update failed.',
      offline: 'Update check unavailable while offline.',
    })[phase]
</script>

<dialog
  bind:this={dialog}
  class:fallback-modal={fallbackModal}
  aria-modal="true"
  aria-labelledby="update-title"
  onkeydown={keydown}
  oncancel={(event) => event.preventDefault()}
>
  <section class="update-card modal-shell" data-modal-shell>
    <header>
      <span class="loop-mark" aria-hidden="true">L24</span>
      <div>
        <p>LOOP24</p>
        <h2 id="update-title">Update Workflow Studio</h2>
      </div>
    </header>
    <div class="modal-body" data-modal-body>
      <p role="status" aria-live="polite">{statusText(update.phase)}</p>
      {#if update.phase === 'downloading'}
        {#if update.progressPercent === null}
          <progress aria-label="Update download progress"></progress>
        {:else}
          <progress
            max="100"
            value={update.progressPercent}
            aria-valuenow={update.progressPercent}
            aria-label="Update download progress">{update.progressPercent}%</progress
          >
        {/if}
        <p class="bytes">{byteSummary}</p>
      {/if}
      {#if update.release}
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{update.release.version}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{update.release.platform}</dd>
          </div>
        </dl>
        {#if notes}<p class="notes">{notes}</p>{/if}
      {/if}
      {#if update.failure}<p role="alert" class="failure">
          <strong>Update failed.</strong>
          {update.failure.message}
        </p>{/if}
      <button bind:this={detailsButton} type="button" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
        {expanded ? 'Hide update log' : 'Show update log'}
      </button>
      <ExpandableLog {expanded} lines={update.logs} label="Update output" dataAttribute="update" />
    </div>
    <footer data-modal-actions>
      {#if expanded}<button
          type="button"
          disabled={pending.has('copy')}
          onclick={() => void act('copy', () => copyText(update.logs.join('\n')))}>Copy Output</button
        >{/if}
      {#if update.savedLogAvailable}<button
          type="button"
          disabled={pending.has('open')}
          onclick={() => void act('open', () => onopenlog(update.runId))}>Open Saved Log</button
        >{/if}
      {#if update.phase === 'available' || update.phase === 'deferred'}<button
          type="button"
          disabled={pending.has('download')}
          onclick={() => void act('download', () => ondownload(update.runId))}>Download / Install</button
        >{/if}
      {#if update.phase === 'available' || update.phase === 'failed' || update.phase === 'cancelling' || update.phase === 'recheck-required'}<button
          type="button"
          disabled={pending.has('later')}
          onclick={() => void act('later', () => onlater(update.runId))}>Later</button
        >{/if}
      {#if update.phase === 'failed' || update.phase === 'offline'}<button
          type="button"
          disabled={pending.has('retry')}
          onclick={() => void act('retry', onretry)}>Retry</button
        >{/if}
      {#if update.phase === 'recheck-required'}<button
          type="button"
          disabled={pending.has('retry')}
          onclick={() => void act('retry', onretry)}>Check Again</button
        >{/if}
      {#if update.cancellable}<button
          type="button"
          disabled={pending.has('cancel')}
          onclick={() => void act('cancel', () => oncancel(update.runId))}>Cancel update</button
        >{/if}
      {#if update.phase === 'restart-required'}<button
          type="button"
          disabled={pending.has('relaunch')}
          onclick={() => void act('relaunch', onrelaunch)}>Relaunch</button
        >{/if}
    </footer>
  </section>
</dialog>

<style>
  dialog {
    width: min(44rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    max-block-size: calc(100dvh - 2rem);
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 0.75rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 1.5rem 5rem var(--color-shadow);
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--color-background) 78%, transparent);
  }
  dialog.fallback-modal {
    position: fixed;
    inset: 0;
    margin: auto;
    box-shadow: 0 0 0 100vmax color-mix(in srgb, var(--color-background) 78%, transparent);
  }
  .update-card {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    max-height: calc(100vh - 2rem);
    max-block-size: calc(100dvh - 2rem);
    min-width: 0;
    min-height: 0;
  }
  .modal-body {
    display: grid;
    gap: 1rem;
    min-width: 0;
    min-height: 0;
    padding: 1rem 1.25rem;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  header,
  footer {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  header {
    min-width: 0;
    padding: 1rem 1.25rem 0;
  }
  header p,
  header h2,
  .modal-body > p {
    margin: 0;
  }
  header p {
    color: var(--color-accent);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.12em;
  }
  header h2 {
    font-size: 1.15rem;
  }
  .loop-mark {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.5rem;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    font-weight: 800;
  }
  progress {
    width: 100%;
    accent-color: var(--color-accent);
  }
  .bytes,
  .notes,
  dd {
    overflow-wrap: anywhere;
    white-space: normal;
  }
  dl {
    display: flex;
    gap: 1rem;
    margin: 0;
  }
  dl div {
    display: flex;
    gap: 0.35rem;
  }
  dd {
    margin: 0;
  }
  .failure {
    padding: 0.75rem;
    border-left: 3px solid var(--color-error);
    background: color-mix(in srgb, var(--color-error) 10%, transparent);
  }
  footer {
    justify-content: flex-end;
    flex-wrap: wrap;
    min-width: 0;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  button {
    min-height: 2.25rem;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.375rem;
    color: var(--color-text);
    background: transparent;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.5;
  }
  @media (prefers-reduced-motion: reduce) {
    dialog {
      scroll-behavior: auto;
    }
  }
  @media (max-width: 32rem) {
    dl {
      display: grid;
    }

    footer button {
      flex: 1 1 10rem;
    }
  }
</style>
