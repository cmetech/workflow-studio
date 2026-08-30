<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProgressState } from '$src/lib/progress/types'
  import ProgressStageList from './ProgressStageList.svelte'
  import ExpandableLog from './ExpandableLog.svelte'

  interface Props {
    state: ProgressState
    now?: number
    copyText?: (text: string) => Promise<void>
    oncancel?: (runId: string) => void | Promise<void>
    onretry?: () => void | Promise<void>
    onopenlog?: (runId: string) => void | Promise<void>
  }

  let {
    state: progress,
    now: fixedNow,
    copyText = (text) => navigator.clipboard.writeText(text),
    oncancel = () => undefined,
    onretry = () => undefined,
    onopenlog = () => undefined,
  }: Props = $props()
  let dialog: HTMLDialogElement
  let detailsButton: HTMLButtonElement
  let expanded = $state(false)
  let fallbackModal = $state(false)
  let clock = $state(Date.now())
  let retryPending = $state(false)
  let openLogPending = $state(false)
  let copyPending = $state(false)
  let cancelPending = $state(false)
  let actionGeneration = 0
  let observedActionIdentity = ''
  const currentStage = $derived(progress.stages.find(({ id }) => id === progress.currentStageId))
  const elapsed = $derived(Math.max(0, (fixedNow ?? clock) - progress.startedAt))
  const actionIdentity = $derived(`${progress.runId}\0${progress.status}`)

  $effect(() => {
    if (progress.logExpanded) expanded = true
  })

  $effect(() => {
    if (actionIdentity === observedActionIdentity) return
    observedActionIdentity = actionIdentity
    actionGeneration += 1
    retryPending = false
    openLogPending = false
    copyPending = false
    cancelPending = false
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
    const timer = fixedNow === undefined ? window.setInterval(() => (clock = Date.now()), 250) : undefined
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
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

  async function retry(): Promise<void> {
    if (retryPending) return
    retryPending = true
    const generation = actionGeneration
    try {
      await onretry()
    } catch {
      // The controller surfaces native setup failures in the setup state.
    } finally {
      if (generation === actionGeneration) retryPending = false
    }
  }

  async function openLog(): Promise<void> {
    if (openLogPending) return
    openLogPending = true
    const generation = actionGeneration
    try {
      await onopenlog(progress.runId)
    } catch {
      // The application error surface reports native open failures.
    } finally {
      if (generation === actionGeneration) openLogPending = false
    }
  }

  async function copyOutput(): Promise<void> {
    if (copyPending) return
    copyPending = true
    const generation = actionGeneration
    try {
      await copyText(progress.logs.join('\n'))
    } catch {
      // The application clipboard surface may be unavailable.
    } finally {
      if (generation === actionGeneration) copyPending = false
    }
  }

  async function cancel(): Promise<void> {
    if (cancelPending) return
    cancelPending = true
    const generation = actionGeneration
    try {
      await oncancel(progress.runId)
    } catch {
      // The application error surface reports native cancellation failures.
    } finally {
      if (generation === actionGeneration) cancelPending = false
    }
  }
</script>

<dialog
  bind:this={dialog}
  class:fallback-modal={fallbackModal}
  aria-modal="true"
  aria-labelledby="setup-title"
  onkeydown={keydown}
  oncancel={(event) => event.preventDefault()}
>
  <section class="setup-card modal-shell" data-modal-shell>
    <header>
      <span class="loop-mark" aria-hidden="true">L24</span>
      <div>
        <p>LOOP24</p>
        <h2 id="setup-title">Setting up LOOP24 Workflow Studio</h2>
      </div>
      <span>Elapsed {(elapsed / 1_000).toFixed(1)}s</span>
    </header>
    <div class="modal-body" data-modal-body>
      <progress
        max="100"
        value={progress.progressPercent}
        aria-valuenow={progress.progressPercent}
        aria-label="Setup progress">{progress.progressPercent}%</progress
      >
      <p role="status" aria-live="polite">
        {currentStage?.label ?? (progress.status === 'succeeded' ? 'Setup complete' : 'Preparing setup')}, {progress.progressPercent}%
        complete
      </p>
      <ProgressStageList stages={progress.stages} />
      {#if progress.failure}<p role="alert" class="failure">
          <strong>Setup failed.</strong>
          {progress.failure.message}
        </p>{/if}
      <button bind:this={detailsButton} type="button" aria-expanded={expanded} onclick={() => (expanded = !expanded)}
        >{expanded ? 'Hide setup log' : 'Show setup log'}</button
      >
      <ExpandableLog {expanded} lines={progress.logs} />
    </div>
    <footer data-modal-actions>
      {#if expanded}<button
          type="button"
          disabled={copyPending}
          aria-busy={copyPending}
          onclick={() => void copyOutput()}>{copyPending ? 'Copying output' : 'Copy Output'}</button
        >{/if}
      {#if progress.savedLogAvailable}<button
          type="button"
          disabled={openLogPending}
          aria-busy={openLogPending}
          onclick={() => void openLog()}>{openLogPending ? 'Opening saved log' : 'Open Saved Log'}</button
        >{/if}
      {#if progress.status === 'failed' || progress.status === 'cancelled'}<button
          type="button"
          disabled={retryPending}
          aria-busy={retryPending}
          onclick={() => void retry()}>{retryPending ? 'Retrying setup' : 'Retry'}</button
        >{/if}
      {#if progress.status === 'running'}<button
          type="button"
          disabled={!progress.cancellable || cancelPending}
          aria-busy={cancelPending}
          onclick={() => void cancel()}>{cancelPending ? 'Cancelling setup' : 'Cancel setup'}</button
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
  .setup-card {
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
  header > span:last-child {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: 0.75rem;
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
    header {
      align-items: flex-start;
    }

    header > span:last-child {
      margin-left: 0;
    }

    footer button {
      flex: 1 1 10rem;
    }
  }
</style>
