import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { tick } from 'svelte'
import SetupOverlay from './SetupOverlay.svelte'
import type { ProgressState } from '$src/lib/progress/types'

const state = (overrides: Partial<ProgressState> = {}): ProgressState => ({
  runId: 'opaque-run-a',
  sequence: 4,
  startedAt: 1_000,
  status: 'running',
  cancellable: true,
  currentStageId: 'resources',
  stages: [
    { id: 'app-data', label: 'Prepare application data', status: 'succeeded', durationMs: 12 },
    { id: 'resources', label: 'Verify bundled resources', status: 'running' },
  ],
  logs: ['Prepared private app data.', 'Verifying bundled resources.'],
  failure: null,
  savedLogAvailable: true,
  logExpanded: false,
  completedStages: 1,
  totalStages: 2,
  progressPercent: 50,
  ...overrides,
})

describe('SetupOverlay', () => {
  it('makes fallback modal siblings inert and restores focus and attributes on close', () => {
    const background = document.createElement('button')
    background.textContent = 'Background action'
    document.body.append(background)
    background.focus()
    const view = render(SetupOverlay, { props: { state: state(), now: 3_500 } })

    expect(background).toHaveAttribute('inert')
    expect(background).toHaveAttribute('aria-hidden', 'true')
    view.unmount()
    expect(background).not.toHaveAttribute('inert')
    expect(background).not.toHaveAttribute('aria-hidden')
    expect(document.activeElement).toBe(background)
    background.remove()
  })

  it('renders a true labelled modal with real stage progress and a quiet status summary', () => {
    render(SetupOverlay, { props: { state: state(), now: 3_500 } })

    const dialog = screen.getByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.querySelector('[data-modal-body]')).not.toBeNull()
    expect(dialog.querySelector('[data-modal-actions]')).not.toBeNull()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('Verify bundled resources')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Verify bundled resources, 50% complete')
    expect(screen.getByText('Elapsed 2.5s')).toBeInTheDocument()
  })

  it('updates elapsed time while setup is running', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const view = render(SetupOverlay, { props: { state: state({ startedAt }) } })
    expect(screen.getByText('Elapsed 0.0s')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(1_000)
    await tick()
    expect(screen.getByText('Elapsed 1.0s')).toBeInTheDocument()
    view.unmount()
    vi.useRealTimers()
  })

  it('automatically exposes failure details and offers retry, copy, and opaque log opening', async () => {
    const copyText = vi.fn(async () => undefined)
    const retry = vi.fn()
    const openLog = vi.fn()
    render(SetupOverlay, {
      props: {
        state: state({
          status: 'failed',
          cancellable: false,
          logExpanded: true,
          failure: { code: 'setup_resources_invalid', message: 'Bundled resources could not be verified.' },
        }),
        now: 3_500,
        copyText,
        onretry: retry,
        onopenlog: openLog,
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Bundled resources could not be verified.')
    expect(screen.getByRole('textbox', { name: 'Setup output' })).toHaveValue(
      'Prepared private app data.\nVerifying bundled resources.',
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Copy Output' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open Saved Log' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(copyText).toHaveBeenCalledWith('Prepared private app data.\nVerifying bundled resources.')
    expect(openLog).toHaveBeenCalledWith('opaque-run-a')
    expect(retry).toHaveBeenCalledOnce()
  })

  it('guards Escape cancellation while a stage is running and traps Tab focus', async () => {
    const cancel = vi.fn()
    render(SetupOverlay, { props: { state: state(), now: 3_500, oncancel: cancel } })
    const dialog = screen.getByRole('dialog')
    const details = screen.getByRole('button', { name: 'Show setup log' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel setup' })
    cancelButton.focus()

    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(cancel).not.toHaveBeenCalled()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(details)
    await fireEvent.click(cancelButton)
    expect(cancel).toHaveBeenCalledWith('opaque-run-a')
  })

  it('disables retry, open, and copy while pending and suppresses repeated activation', async () => {
    const retryResult = deferred<void>()
    const openResult = deferred<void>()
    const copyResult = deferred<void>()
    const retry = vi.fn(() => retryResult.promise)
    const openLog = vi.fn(() => openResult.promise)
    const copyText = vi.fn(() => copyResult.promise)
    render(SetupOverlay, {
      props: {
        state: state({
          status: 'failed',
          cancellable: false,
          logExpanded: true,
          failure: { code: 'setup_failed', message: 'Setup failed.' },
        }),
        now: 3_500,
        onretry: retry,
        onopenlog: openLog,
        copyText,
      },
    })

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    const openButton = screen.getByRole('button', { name: 'Open Saved Log' })
    const copyButton = screen.getByRole('button', { name: 'Copy Output' })
    await fireEvent.click(retryButton)
    await fireEvent.click(openButton)
    await fireEvent.click(copyButton)
    await fireEvent.click(retryButton)
    await fireEvent.click(openButton)
    await fireEvent.click(copyButton)

    expect(retry).toHaveBeenCalledOnce()
    expect(openLog).toHaveBeenCalledOnce()
    expect(copyText).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Retrying setup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Opening saved log' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Copying output' })).toBeDisabled()

    retryResult.resolve()
    openResult.resolve()
    copyResult.resolve()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled())
  })

  it('guards cancellation while pending and clears the guard when the run becomes terminal', async () => {
    const cancellation = deferred<void>()
    const cancel = vi.fn(() => cancellation.promise)
    const view = render(SetupOverlay, { props: { state: state(), now: 3_500, oncancel: cancel } })

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel setup' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelling setup' }))

    expect(cancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Cancelling setup' })).toBeDisabled()

    await view.rerender({
      state: state({ status: 'cancelled', cancellable: false, sequence: 5 }),
      now: 3_500,
      oncancel: cancel,
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    cancellation.resolve()
  })

  it('clears copy pending state when the clipboard rejects', async () => {
    render(SetupOverlay, {
      props: {
        state: state({ logExpanded: true }),
        now: 3_500,
        copyText: async () => {
          throw new Error('clipboard unavailable')
        },
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Copy Output' }))

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy Output' })).toBeEnabled())
  })

  it('clears open and copy guards when retry replaces the run', async () => {
    const opening = deferred<void>()
    const copying = deferred<void>()
    const view = render(SetupOverlay, {
      props: {
        state: state({ status: 'failed', logExpanded: true }),
        now: 3_500,
        onopenlog: () => opening.promise,
        copyText: () => copying.promise,
      },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Open Saved Log' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Copy Output' }))

    await view.rerender({
      state: state({ runId: 'opaque-run-b', status: 'failed', logExpanded: true }),
      now: 3_500,
      onopenlog: () => opening.promise,
      copyText: () => copying.promise,
    })

    expect(screen.getByRole('button', { name: 'Open Saved Log' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeEnabled()
    opening.resolve()
    copying.resolve()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
