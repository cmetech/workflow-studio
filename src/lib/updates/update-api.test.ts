import { describe, expect, it, vi } from 'vitest'
import type { UpdateNativeBridge } from '$src/lib/native/types'
import { applyUpdateEvent, createUpdateController, replaceUpdateSnapshot } from './update-api'
import type { UpdateEvent, UpdateSnapshot } from './types'

const release = {
  version: '1.2.3',
  notes: 'A focused release.\nNo remote markup.',
  date: '2026-07-30T12:00:00Z',
  size: 4_096,
  platform: 'linux-x86_64',
} as const

const snapshot = (overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot => ({
  runId: 'update-run-a',
  sequence: 1,
  startedAt: 100,
  phase: 'checking',
  cancellable: true,
  release: null,
  downloadedBytes: 0,
  totalBytes: null,
  speedBytesPerSecond: null,
  logs: [],
  failure: null,
  savedLogAvailable: false,
  message: null,
  ...overrides,
})

describe('update state protocol', () => {
  it.each([
    'idle',
    'checking',
    'current',
    'available',
    'downloading',
    'verifying',
    'installing',
    'restart-required',
    'deferred',
    'cancelling',
    'recheck-required',
    'dismissed',
    'failed',
    'offline',
  ] as const)('restores the %s snapshot exactly', (phase) => {
    const restored = replaceUpdateSnapshot(null, snapshot({ phase, release: phase === 'available' ? release : null }))
    expect(restored?.phase).toBe(phase)
  })

  it('rejects stale runs, duplicate sequences, decreasing bytes, and changing known totals', () => {
    let state = replaceUpdateSnapshot(null, snapshot({ phase: 'downloading', release, totalBytes: 4_096 }))
    state = applyUpdateEvent(state, download(2, 1_024, 4_096))
    state = applyUpdateEvent(state, download(3, 512, 4_096))
    state = applyUpdateEvent(state, download(4, 2_048, 8_192))
    state = applyUpdateEvent(state, { ...download(99, 3_000, 4_096), runId: 'stale-run' })
    state = applyUpdateEvent(state, download(2, 4_096, 4_096))
    expect(state).toMatchObject({ sequence: 2, downloadedBytes: 1_024, totalBytes: 4_096 })
  })

  it('keeps an unknown total indeterminate while bytes and speed advance', () => {
    let state = replaceUpdateSnapshot(null, snapshot({ phase: 'downloading', release }))
    state = applyUpdateEvent(state, download(2, 512, null, 128))
    state = applyUpdateEvent(state, download(3, 1_024, null, 256))
    expect(state).toMatchObject({ downloadedBytes: 1_024, totalBytes: null, speedBytesPerSecond: 256 })
    expect(state?.progressPercent).toBeNull()
  })

  it('contains signature failure so a later installing event cannot be applied', () => {
    let state = replaceUpdateSnapshot(null, snapshot({ phase: 'verifying', release, cancellable: false }))
    state = applyUpdateEvent(state, {
      type: 'failed',
      runId: 'update-run-a',
      sequence: 2,
      timestamp: 120,
      code: 'update_signature_invalid',
      message: 'The update signature could not be verified.',
    })
    state = applyUpdateEvent(state, {
      type: 'phase',
      runId: 'update-run-a',
      sequence: 3,
      timestamp: 121,
      phase: 'installing',
      cancellable: false,
    })
    expect(state).toMatchObject({ phase: 'failed', sequence: 2, logExpanded: true })
  })

  it('ignores late download work while cancelling but accepts the native worker-release transition', () => {
    let state = replaceUpdateSnapshot(
      null,
      snapshot({ phase: 'cancelling', release, cancellable: false, downloadedBytes: 1_024, totalBytes: 4_096 }),
    )
    state = applyUpdateEvent(state, download(2, 2_048, 4_096))
    expect(state).toMatchObject({ phase: 'cancelling', sequence: 1, downloadedBytes: 1_024 })
    state = applyUpdateEvent(state, {
      type: 'phase',
      runId: 'update-run-a',
      sequence: 2,
      timestamp: 120,
      phase: 'recheck-required',
      cancellable: false,
      message: 'Cancellation finished. Run a fresh update check.',
    })
    expect(state).toMatchObject({ phase: 'recheck-required', sequence: 2 })
  })

  it('treats offline checks as non-destructive and retains the usable current version', () => {
    const state = applyUpdateEvent(replaceUpdateSnapshot(null, snapshot()), {
      type: 'offline',
      runId: 'update-run-a',
      sequence: 2,
      timestamp: 120,
      message: 'No network connection is available.',
    })
    expect(state).toMatchObject({ phase: 'offline', cancellable: false, failure: null })
    expect(state?.message).toBe('No network connection is available.')
  })
})

describe('update controller', () => {
  it('subscribes before reading status and reconciles buffered events', async () => {
    const order: string[] = []
    let handler: (event: UpdateEvent) => void = () => undefined
    const controller = createUpdateController(
      bridge({
        onUpdateEvent: async (next) => {
          order.push('subscribe')
          handler = next
          return () => undefined
        },
        updateStatus: async () => {
          order.push('status')
          await handler({
            type: 'phase',
            runId: 'update-run-a',
            sequence: 2,
            timestamp: 110,
            phase: 'available',
            cancellable: true,
            release,
          })
          return { snapshot: snapshot(), startupCheckEnabled: true }
        },
      }),
    )
    await controller.start()
    expect(order).toEqual(['subscribe', 'status'])
    expect(controller.state()).toMatchObject({ phase: 'available', sequence: 2, release })
  })

  it('atomically suppresses duplicate actions and rejects actions for stale run IDs', async () => {
    const pending = deferred<UpdateSnapshot>()
    const check = vi.fn(() => pending.promise)
    const install = vi.fn(() => pending.promise)
    const cancel = vi.fn(async () => true)
    const open = vi.fn(async () => undefined)
    const preference = vi.fn(async () => false)
    const relaunch = vi.fn(async () => undefined)
    const controller = createUpdateController(
      bridge({
        updateCheck: check,
        updateDownloadInstall: install,
        updateCancel: cancel,
        updateOpenLog: open,
        updateSetStartupCheck: preference,
        updateRelaunch: relaunch,
      }),
    )
    await controller.start()
    const actions = [
      controller.check(false),
      controller.check(false),
      controller.downloadInstall('stale'),
      controller.downloadInstall('stale'),
      controller.cancel('stale'),
      controller.cancel('stale'),
      controller.openLog('stale'),
      controller.openLog('stale'),
      controller.setStartupCheck(false),
      controller.setStartupCheck(false),
      controller.relaunch(),
      controller.relaunch(),
    ]
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce())
    pending.resolve(snapshot({ runId: 'next-run', phase: 'available', release }))
    await Promise.all(actions)
    expect(install).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(preference).toHaveBeenCalledOnce()
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('runs a bounded startup check independently and turns timeout into a quiet offline state', async () => {
    vi.useFakeTimers()
    const controller = createUpdateController(
      bridge({ updateCheck: () => new Promise<UpdateSnapshot>(() => undefined) }),
      {
        startupTimeoutMs: 25,
      },
    )
    await controller.start()
    const checking = controller.check(true)
    await vi.advanceTimersByTimeAsync(25)
    await checking
    expect(controller.state()).toMatchObject({ phase: 'offline', failure: null })
    vi.useRealTimers()
  })

  it('persists Later natively so deferred state survives reconnect', async () => {
    const defer = vi.fn(async () => snapshot({ phase: 'deferred', release, cancellable: false }))
    const controller = createUpdateController(
      bridge({
        updateStatus: async () => ({ snapshot: snapshot({ phase: 'available', release }), startupCheckEnabled: true }),
        updateDefer: defer,
      }),
    )
    await controller.start()
    await controller.defer('update-run-a')
    expect(defer).toHaveBeenCalledWith('update-run-a')
    expect(controller.state().phase).toBe('deferred')
  })

  it('requires a fresh check after download cancellation and never resumes a consumed update', async () => {
    const install = vi.fn(async () => snapshot({ phase: 'downloading', release }))
    const check = vi.fn(async () => snapshot({ runId: 'fresh-check', phase: 'checking' }))
    const controller = createUpdateController(
      bridge({
        updateStatus: async () => ({
          snapshot: snapshot({ phase: 'recheck-required', release, cancellable: false }),
          startupCheckEnabled: true,
        }),
        updateDownloadInstall: install,
        updateCheck: check,
      }),
    )
    await controller.start()

    await controller.downloadInstall('update-run-a')
    expect(install).not.toHaveBeenCalled()
    await controller.check(false)
    expect(check).toHaveBeenCalledOnce()
    expect(controller.state()).toMatchObject({ runId: 'fresh-check', phase: 'checking' })
  })

  it('starts one fresh check after native worker release publishes recheck-required', async () => {
    let handler: (event: UpdateEvent) => void = () => undefined
    const check = vi.fn(async () => snapshot({ runId: 'fresh-run', phase: 'checking' }))
    const controller = createUpdateController(
      bridge({
        onUpdateEvent: async (next) => {
          handler = next
          return () => undefined
        },
        updateStatus: async () => ({
          snapshot: snapshot({ phase: 'cancelling', release, cancellable: false }),
          startupCheckEnabled: true,
        }),
        updateCheck: check,
      }),
    )
    await controller.start()
    handler({
      type: 'phase',
      runId: 'update-run-a',
      sequence: 2,
      timestamp: 120,
      phase: 'recheck-required',
      cancellable: false,
      message: 'Cancellation finished. Run a fresh update check.',
    })

    await controller.check(false)
    expect(check).toHaveBeenCalledOnce()
    expect(controller.state()).toMatchObject({ runId: 'fresh-run', phase: 'checking' })
  })

  it('dismisses a failed modal natively while preserving failure and saved-log details', async () => {
    const failed = snapshot({
      phase: 'failed',
      cancellable: false,
      failure: { code: 'update_signature_invalid', message: 'The signature is invalid.' },
      logs: ['Signature verification failed.'],
      savedLogAvailable: true,
    })
    const dismiss = vi.fn(async () => snapshot({ ...failed, sequence: 2, phase: 'dismissed' }))
    const controller = createUpdateController(
      bridge({ updateStatus: async () => ({ snapshot: failed, startupCheckEnabled: true }), updateDefer: dismiss }),
    )
    await controller.start()

    await controller.defer('update-run-a')
    expect(dismiss).toHaveBeenCalledWith('update-run-a')
    expect(controller.state()).toMatchObject({
      phase: 'dismissed',
      failure: failed.failure,
      logs: failed.logs,
      savedLogAvailable: true,
    })
  })

  it('publishes the claimed checking snapshot and replays new-run events emitted before the command returns', async () => {
    let handler: (event: UpdateEvent) => void = () => undefined
    const controller = createUpdateController(
      bridge({
        onUpdateEvent: async (next) => {
          handler = next
          return () => undefined
        },
        updateCheck: async () => {
          await handler({
            type: 'phase',
            runId: 'check-run',
            sequence: 2,
            timestamp: 120,
            phase: 'available',
            cancellable: true,
            release,
          })
          return snapshot({ runId: 'check-run', sequence: 1, phase: 'checking' })
        },
      }),
    )
    await controller.start()
    await controller.check(false)
    expect(controller.state()).toMatchObject({ runId: 'check-run', phase: 'available', sequence: 2 })
  })

  it('replays real download progress emitted while a deferred release resumes', async () => {
    let handler: (event: UpdateEvent) => void = () => undefined
    const controller = createUpdateController(
      bridge({
        onUpdateEvent: async (next) => {
          handler = next
          return () => undefined
        },
        updateStatus: async () => ({ snapshot: snapshot({ phase: 'deferred', release }), startupCheckEnabled: true }),
        updateDownloadInstall: async () => {
          await handler({ ...download(3, 1_024, 4_096), runId: 'update-run-a' })
          return snapshot({ phase: 'downloading', release, sequence: 2, totalBytes: 4_096 })
        },
      }),
    )
    await controller.start()
    await controller.downloadInstall('update-run-a')
    expect(controller.state()).toMatchObject({ phase: 'downloading', sequence: 3, downloadedBytes: 1_024 })
  })
})

function download(sequence: number, downloadedBytes: number, totalBytes: number | null, speed = 64): UpdateEvent {
  return {
    type: 'download',
    runId: 'update-run-a',
    sequence,
    timestamp: 110 + sequence,
    downloadedBytes,
    totalBytes,
    speedBytesPerSecond: speed,
  }
}

function bridge(overrides: Partial<UpdateNativeBridge> = {}): UpdateNativeBridge {
  return {
    updateStatus: async () => ({ snapshot: snapshot({ runId: 'idle', phase: 'idle' }), startupCheckEnabled: true }),
    updateCheck: async () => snapshot({ phase: 'current' }),
    updateDownloadInstall: async () => snapshot({ phase: 'restart-required', cancellable: false }),
    updateCancel: async () => true,
    updateDefer: async () => snapshot({ phase: 'deferred', cancellable: false }),
    updateOpenLog: async () => undefined,
    updateSetStartupCheck: async (enabled) => enabled,
    updateRelaunch: async () => undefined,
    onUpdateEvent: async () => () => undefined,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
