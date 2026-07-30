import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '$src/lib/updates/types'
import UpdateOverlay from './UpdateOverlay.svelte'

const state = (overrides: Partial<UpdateState> = {}): UpdateState => ({
  runId: 'update-run',
  sequence: 3,
  startedAt: 1_000,
  phase: 'downloading',
  cancellable: true,
  release: {
    version: '1.2.3',
    notes: 'Security fixes.\nNo remote markup.',
    date: '2026-07-30T12:00:00Z',
    size: 4_096,
    platform: 'linux-x86_64',
  },
  downloadedBytes: 1_024,
  totalBytes: 4_096,
  speedBytesPerSecond: 512,
  logs: ['Downloaded 1024 bytes.'],
  failure: null,
  savedLogAvailable: true,
  message: null,
  logExpanded: false,
  progressPercent: 25,
  ...overrides,
})

describe('UpdateOverlay', () => {
  it('renders real byte progress, plain release notes, a true modal, and safe cancellation', async () => {
    const cancel = vi.fn()
    render(UpdateOverlay, { props: { state: state(), oncancel: cancel } })
    expect(screen.getByRole('dialog', { name: 'Update Workflow Studio' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('1.0 KiB of 4.0 KiB · 512 B/s')).toBeVisible()
    expect(screen.getByText('Security fixes. No remote markup.')).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel update' }))
    expect(cancel).toHaveBeenCalledWith('update-run')
  })

  it('uses indeterminate progress when total size is unknown', () => {
    render(UpdateOverlay, { props: { state: state({ totalBytes: null, progressPercent: null }) } })
    expect(screen.getByRole('progressbar', { name: 'Update download progress' })).not.toHaveAttribute('value')
    expect(screen.getByText('1.0 KiB downloaded · 512 B/s')).toBeVisible()
  })

  it('makes installation non-cancellable and offers relaunch only after restart is required', async () => {
    const relaunch = vi.fn()
    const view = render(UpdateOverlay, {
      props: { state: state({ phase: 'installing', cancellable: false }), onrelaunch: relaunch },
    })
    expect(screen.queryByRole('button', { name: 'Cancel update' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Installing update. Do not close Workflow Studio.')
    await view.rerender({ state: state({ phase: 'restart-required', cancellable: false }), onrelaunch: relaunch })
    await fireEvent.click(screen.getByRole('button', { name: 'Relaunch' }))
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('auto-expands bounded failure output and offers retry and saved-log actions', async () => {
    const retry = vi.fn()
    const open = vi.fn()
    const later = vi.fn()
    render(UpdateOverlay, {
      props: {
        state: state({
          phase: 'failed',
          cancellable: false,
          failure: { code: 'update_signature_invalid', message: 'The update signature is invalid.' },
          logExpanded: true,
        }),
        onretry: retry,
        onopenlog: open,
        onlater: later,
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('The update signature is invalid.')
    expect(screen.getByRole('textbox', { name: 'Update output' })).toHaveValue('Downloaded 1024 bytes.')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open Saved Log' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('update-run')
    expect(later).toHaveBeenCalledWith('update-run')
  })

  it('requires a fresh check after cancellation instead of offering to resume a consumed update', async () => {
    const retry = vi.fn()
    const later = vi.fn()
    render(UpdateOverlay, {
      props: {
        state: state({
          phase: 'recheck-required',
          cancellable: false,
          message: 'The cancelled download requires a fresh update check.',
        }),
        onretry: retry,
        onlater: later,
      },
    })

    expect(screen.queryByRole('button', { name: 'Download / Install' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Check Again' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(later).toHaveBeenCalledWith('update-run')
  })

  it('withholds Check Again until the native worker releases while keeping Later available', async () => {
    const later = vi.fn()
    const retry = vi.fn()
    const view = render(UpdateOverlay, {
      props: {
        state: state({ phase: 'cancelling', cancellable: false }),
        onlater: later,
        onretry: retry,
      },
    })

    expect(screen.queryByRole('button', { name: 'Check Again' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(later).toHaveBeenCalledWith('update-run')

    await view.rerender({
      state: state({ phase: 'recheck-required', sequence: 4, cancellable: false }),
      onlater: later,
      onretry: retry,
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Check Again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('defers an available release', async () => {
    const later = vi.fn()
    render(UpdateOverlay, { props: { state: state({ phase: 'available' }), onlater: later } })
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(later).toHaveBeenCalledWith('update-run')
  })
})
