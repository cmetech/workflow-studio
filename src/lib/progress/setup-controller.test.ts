import { describe, expect, it, vi } from 'vitest'
import type { SetupNativeBridge } from '$src/lib/native/types'
import type { ProgressEventHandler, ProgressSnapshot } from './types'
import { createSetupController } from './setup-controller'

const snapshot = (overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({
  runId: 'run-new',
  sequence: 1,
  startedAt: 100,
  status: 'running',
  cancellable: true,
  currentStageId: null,
  stages: [{ id: 'app-data', label: 'Prepare application data', status: 'pending' }],
  logs: [],
  failure: null,
  savedLogAvailable: false,
  ...overrides,
})

describe('setup controller', () => {
  it('subscribes before status/start and reconciles an event delivered during start', async () => {
    const order: string[] = []
    let handler: ProgressEventHandler = () => undefined
    const native = bridge({
      onSetupEvent: async (next) => {
        order.push('subscribe')
        handler = next
        return () => undefined
      },
      setupStatus: async () => {
        order.push('status')
        return { ready: false, snapshot: null }
      },
      setupStart: async () => {
        order.push('start')
        await handler({
          type: 'stage',
          runId: 'run-new',
          sequence: 2,
          timestamp: 110,
          stageId: 'app-data',
          status: 'running',
        })
        return snapshot()
      },
    })
    const states: unknown[] = []
    const controller = createSetupController(native, { onState: (state) => states.push(state) })

    await controller.start()

    expect(order).toEqual(['subscribe', 'status', 'start'])
    expect(controller.state()?.sequence).toBe(2)
    expect(controller.state()?.stages[0]?.status).toBe('running')
    expect(states).not.toHaveLength(0)
  })

  it('replaces with reconnect snapshots and suppresses stale runs and duplicate sequences', async () => {
    let handler: ProgressEventHandler = () => undefined
    const native = bridge({
      onSetupEvent: async (next) => {
        handler = next
        return () => undefined
      },
      setupStatus: async () => ({ ready: false, snapshot: snapshot({ sequence: 8 }) }),
    })
    const controller = createSetupController(native)
    await controller.start()
    await handler({ type: 'log', runId: 'old', sequence: 100, timestamp: 120, line: 'stale' })
    await handler({ type: 'log', runId: 'run-new', sequence: 8, timestamp: 120, line: 'duplicate' })

    expect(controller.state()?.sequence).toBe(8)
    expect(controller.state()?.logs).toEqual([])
  })

  it('uses the current run ID for cancellation and replaces terminal state on retry', async () => {
    const cancel = vi.fn(async () => true)
    const native = bridge({
      setupStatus: async () => ({ ready: false, snapshot: snapshot({ status: 'failed', sequence: 9 }) }),
      setupStart: async () => snapshot({ runId: 'retry-run', sequence: 1 }),
      setupCancel: cancel,
    })
    const controller = createSetupController(native)
    await controller.start()
    await controller.cancel('stale-overlay')
    await controller.cancel('run-new')
    await controller.retry()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('run-new')
    expect(controller.state()?.runId).toBe('retry-run')
  })

  it('unlistens a registration that resolves after disposal and never starts native setup', async () => {
    const registration = deferred<() => void>()
    const unlisten = vi.fn()
    const setupStatus = vi.fn(async () => ({ ready: false, snapshot: null }))
    const setupStart = vi.fn(async () => snapshot())
    const controller = createSetupController(
      bridge({ onSetupEvent: async () => registration.promise, setupStatus, setupStart }),
    )

    const starting = controller.start()
    controller.dispose()
    registration.resolve(unlisten)
    await starting

    expect(unlisten).toHaveBeenCalledOnce()
    expect(setupStatus).not.toHaveBeenCalled()
    expect(setupStart).not.toHaveBeenCalled()
  })

  it('reports ready without starting setup when schema/app readiness is current', async () => {
    const ready = vi.fn()
    const setupStart = vi.fn(async () => snapshot())
    const controller = createSetupController(
      bridge({ setupStatus: async () => ({ ready: true, snapshot: null }), setupStart }),
      { onReady: ready },
    )

    await controller.start()

    expect(ready).toHaveBeenCalledOnce()
    expect(setupStart).not.toHaveBeenCalled()
  })

  it('reports terminal readiness once when duplicate or late events arrive', async () => {
    let handler: ProgressEventHandler = () => undefined
    const ready = vi.fn()
    const controller = createSetupController(
      bridge({
        onSetupEvent: async (next) => {
          handler = next
          return () => undefined
        },
        setupStatus: async () => ({ ready: false, snapshot: snapshot() }),
      }),
      { onReady: ready },
    )
    await controller.start()
    const complete = {
      type: 'complete' as const,
      runId: 'run-new',
      sequence: 2,
      timestamp: 120,
      durationMs: 20,
    }
    await handler(complete)
    await handler(complete)
    await handler({ ...complete, sequence: 3 })

    expect(ready).toHaveBeenCalledOnce()
  })

  it('publishes a bounded retryable failure when initial status cannot be read, then recovers', async () => {
    const oversized = `status unavailable ${'x'.repeat(2_000)}`
    const setupStatus = vi
      .fn<SetupNativeBridge['setupStatus']>()
      .mockRejectedValueOnce(new Error(oversized))
      .mockResolvedValueOnce({ ready: false, snapshot: null })
    const controller = createSetupController(
      bridge({ setupStatus, setupStart: async () => snapshot({ runId: 'recovered-run' }) }),
    )

    await controller.start()

    expect(controller.state()?.status).toBe('failed')
    expect(controller.state()?.failure?.message).toContain('status unavailable')
    expect(controller.state()?.failure?.message.length).toBeLessThanOrEqual(1_024)

    await controller.retry()

    expect(setupStatus).toHaveBeenCalledTimes(2)
    expect(controller.state()?.runId).toBe('recovered-run')
    expect(controller.state()?.status).toBe('running')
  })

  it('re-subscribes after listener registration fails and retry recovers setup', async () => {
    const onSetupEvent = vi
      .fn<SetupNativeBridge['onSetupEvent']>()
      .mockRejectedValueOnce(new Error('event channel unavailable'))
      .mockResolvedValueOnce(() => undefined)
    const setupStart = vi.fn(async () => snapshot({ runId: 'listener-recovered' }))
    const controller = createSetupController(
      bridge({
        onSetupEvent,
        setupStatus: async () => ({ ready: false, snapshot: null }),
        setupStart,
      }),
    )

    await controller.start()
    expect(controller.state()?.failure?.message).toContain('event channel unavailable')

    await controller.retry()

    expect(onSetupEvent).toHaveBeenCalledTimes(2)
    expect(setupStart).toHaveBeenCalledOnce()
    expect(controller.state()?.runId).toBe('listener-recovered')
  })

  it('turns a start rejection into visible failure and permits a successful retry', async () => {
    const setupStart = vi
      .fn<SetupNativeBridge['setupStart']>()
      .mockRejectedValueOnce(new Error('native setup did not start'))
      .mockResolvedValueOnce(snapshot({ runId: 'retry-success' }))
    const controller = createSetupController(
      bridge({ setupStatus: async () => ({ ready: false, snapshot: null }), setupStart }),
    )

    await controller.start()
    expect(controller.state()?.status).toBe('failed')
    expect(controller.state()?.failure?.message).toContain('native setup did not start')

    await controller.retry()

    expect(setupStart).toHaveBeenCalledTimes(2)
    expect(controller.state()?.runId).toBe('retry-success')
  })

  it('suppresses duplicate retry, cancel, and open-log operations while each action is pending', async () => {
    const retryResult = deferred<ProgressSnapshot>()
    const cancelResult = deferred<boolean>()
    const openResult = deferred<void>()
    const setupStart = vi.fn(() => retryResult.promise)
    const setupCancel = vi.fn(() => cancelResult.promise)
    const setupOpenLog = vi.fn(() => openResult.promise)
    const controller = createSetupController(
      bridge({
        setupStatus: async () => ({ ready: false, snapshot: snapshot({ status: 'failed' }) }),
        setupStart,
        setupCancel,
        setupOpenLog,
      }),
    )
    await controller.start()

    const retryOne = controller.retry()
    const retryTwo = controller.retry()
    const cancelOne = controller.cancel('run-new')
    const cancelTwo = controller.cancel('run-new')
    const openOne = controller.openLog('run-new')
    const openTwo = controller.openLog('run-new')

    await vi.waitFor(() => {
      expect(setupStart).toHaveBeenCalledOnce()
      expect(setupCancel).toHaveBeenCalledOnce()
      expect(setupOpenLog).toHaveBeenCalledOnce()
    })

    retryResult.resolve(snapshot({ runId: 'next-run' }))
    cancelResult.resolve(true)
    openResult.resolve()
    await Promise.all([retryOne, retryTwo, cancelOne, cancelTwo, openOne, openTwo])
  })

  it('does not publish transport failure or retain late operations after disposal', async () => {
    const status = deferred<{ ready: boolean; snapshot: ProgressSnapshot | null }>()
    const onState = vi.fn()
    const onError = vi.fn()
    const controller = createSetupController(bridge({ setupStatus: () => status.promise }), {
      onState,
      onError,
    })

    const starting = controller.start()
    await vi.waitFor(() => expect(onState).not.toHaveBeenCalled())
    controller.dispose()
    status.reject(new Error('late status failure'))
    await starting

    expect(onState).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(controller.state()).toBeNull()
  })
})

function bridge(overrides: Partial<SetupNativeBridge> = {}): SetupNativeBridge {
  return {
    hostHealth: async () => ({ appVersion: 'test', os: 'browser', arch: 'test' }),
    setupStatus: async () => ({ ready: true, snapshot: null }),
    setupStart: async () => snapshot(),
    setupCancel: async () => true,
    setupOpenLog: async () => undefined,
    onSetupEvent: async () => () => undefined,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
