import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '$src/lib/updates/types'
import UpdateSettings from './UpdateSettings.svelte'

const state = (overrides: Partial<UpdateState> = {}): UpdateState => ({
  runId: 'update-run',
  sequence: 2,
  startedAt: 1_000,
  phase: 'available',
  cancellable: false,
  release: {
    version: '1.2.3',
    notes: 'Security fixes.\nNo remote markup.',
    date: '2026-08-30T12:00:00Z',
    size: 4_096,
    platform: 'windows-x86_64-with-a-very-long-technical-identity',
  },
  downloadedBytes: 0,
  totalBytes: 4_096,
  speedBytesPerSecond: null,
  logs: ['Update package is ready.'],
  failure: null,
  savedLogAvailable: true,
  message: null,
  logExpanded: false,
  progressPercent: 0,
  ...overrides,
})

describe('UpdateSettings', () => {
  it('owns startup preference and manual update checks', async () => {
    const check = vi.fn()
    const preference = vi.fn()
    render(UpdateSettings, {
      startupCheckEnabled: true,
      updateState: null,
      oncheck: check,
      onstartupchange: preference,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Check for updates at startup' }))

    expect(check).toHaveBeenCalledOnce()
    expect(preference).toHaveBeenCalledWith(false)
  })

  it('preserves update details, logs, and release actions', async () => {
    const download = vi.fn()
    const openLog = vi.fn()
    render(UpdateSettings, {
      startupCheckEnabled: false,
      updateState: state(),
      oncheck: vi.fn(),
      onstartupchange: vi.fn(),
      ondownload: download,
      onopenlog: openLog,
    })

    expect(screen.getByRole('status')).toHaveTextContent('Update status: available')
    expect(screen.getByText('1.2.3')).toHaveClass('technical-value')
    expect(screen.getByText('1.2.3').tagName).toBe('CODE')
    expect(screen.getByText('windows-x86_64-with-a-very-long-technical-identity')).toHaveClass('technical-value')
    expect(screen.getByText('windows-x86_64-with-a-very-long-technical-identity').tagName).toBe('CODE')
    await fireEvent.click(screen.getByRole('button', { name: 'Show update log' }))
    expect(screen.getByRole('textbox', { name: 'Update output' })).toHaveValue('Update package is ready.')
    await fireEvent.click(screen.getByRole('button', { name: 'Download / Install' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open Saved Log' }))

    expect(download).toHaveBeenCalledWith('update-run')
    expect(openLog).toHaveBeenCalledWith('update-run')
  })

  it('surfaces failures and offers relaunch after installation', async () => {
    const relaunch = vi.fn()
    const view = render(UpdateSettings, {
      startupCheckEnabled: false,
      updateState: state({ phase: 'failed', failure: { code: 'signature', message: 'Signature check failed.' } }),
      oncheck: vi.fn(),
      onstartupchange: vi.fn(),
      onrelaunch: relaunch,
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Signature check failed.')
    await view.rerender({
      startupCheckEnabled: false,
      updateState: state({ phase: 'restart-required' }),
      oncheck: vi.fn(),
      onstartupchange: vi.fn(),
      onrelaunch: relaunch,
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Relaunch' }))
    expect(relaunch).toHaveBeenCalledOnce()
  })
})
