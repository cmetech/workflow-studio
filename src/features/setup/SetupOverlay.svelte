<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProgressState } from '$src/lib/progress/types'
  import ProgressStageList from './ProgressStageList.svelte'
  import ExpandableLog from './ExpandableLog.svelte'

  interface Props {
    state: ProgressState
    now?: number
    copyText?: (text: string) => Promise<void>
    oncancel?: (runId: string) => void
    onretry?: () => void
    onopenlog?: (runId: string) => void
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
  const currentStage = $derived(progress.stages.find(({ id }) => id === progress.currentStageId))
  const elapsed = $derived(Math.max(0, (fixedNow ?? clock) - progress.startedAt))

  $effect(() => {
    if (progress.logExpanded) expanded = true
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
</script>

<dialog
  bind:this={dialog}
  class:fallback-modal={fallbackModal}
  aria-modal="true"
  aria-labelledby="setup-title"
  onkeydown={keydown}
  oncancel={(event) => event.preventDefault()}
>
  <section class="setup-card">
    <header>
      <span class="loop-mark" aria-hidden="true">L24</span>
      <div>
        <p>LOOP24</p>
        <h2 id="setup-title">Setting up LOOP24 Workflow Studio</h2>
      </div>
      <span>Elapsed {(elapsed / 1_000).toFixed(1)}s</span>
    </header>
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
    <footer>
      {#if expanded}<button type="button" onclick={() => void copyText(progress.logs.join('\n'))}>Copy Output</button
        >{/if}
      {#if progress.savedLogAvailable}<button type="button" onclick={() => onopenlog(progress.runId)}
          >Open Saved Log</button
        >{/if}
      {#if progress.status === 'failed' || progress.status === 'cancelled'}<button type="button" onclick={onretry}
          >Retry</button
        >{/if}
      {#if progress.status === 'running'}<button
          type="button"
          disabled={!progress.cancellable}
          onclick={() => oncancel(progress.runId)}>Cancel setup</button
        >{/if}
    </footer>
  </section>
</dialog>

<style>
  dialog {
    width: min(44rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    padding: 0;
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
    gap: 1rem;
    padding: 1.25rem;
  }
  header,
  footer {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  header > span:last-child {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  header p,
  header h2,
  .setup-card > p {
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
</style>
