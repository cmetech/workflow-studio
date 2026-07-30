import type { UpdateNativeBridge } from '$src/lib/native/types'
import type { UpdateEvent, UpdateEventHandler, UpdateSnapshot, UpdateState, UpdateStatusResponse } from './types'

const MAX_LOG_LINES = 500
const TERMINAL_PHASES = new Set([
  'current',
  'restart-required',
  'deferred',
  'recheck-required',
  'dismissed',
  'failed',
  'offline',
])

export function replaceUpdateSnapshot(_current: UpdateState | null, snapshot: UpdateSnapshot): UpdateState {
  return derive({
    ...snapshot,
    logs: snapshot.logs.slice(-MAX_LOG_LINES),
    logExpanded: snapshot.phase === 'failed',
  })
}

export function applyUpdateEvent(current: null, event: UpdateEvent): null
export function applyUpdateEvent(current: UpdateState, event: UpdateEvent): UpdateState
export function applyUpdateEvent(current: UpdateState | null, event: UpdateEvent): UpdateState | null {
  if (!current || !validEvent(event) || event.runId !== current.runId || event.sequence <= current.sequence) {
    return current
  }
  if (TERMINAL_PHASES.has(current.phase)) return current
  if (current.phase === 'cancelling') {
    if (event.type === 'log') {
      return derive({
        ...current,
        sequence: event.sequence,
        logs: [...current.logs, event.line.slice(0, 4_096)].slice(-MAX_LOG_LINES),
        savedLogAvailable: true,
      })
    }
    if (event.type !== 'phase' || event.phase !== 'recheck-required') return current
  }
  if (event.type === 'download') {
    if (event.downloadedBytes < current.downloadedBytes) return current
    if (current.totalBytes !== null && event.totalBytes !== current.totalBytes) return current
    if (event.totalBytes !== null && event.downloadedBytes > event.totalBytes) return current
    return derive({
      ...current,
      sequence: event.sequence,
      phase: 'downloading',
      downloadedBytes: event.downloadedBytes,
      totalBytes: event.totalBytes,
      speedBytesPerSecond: event.speedBytesPerSecond,
    })
  }
  if (event.type === 'log') {
    return derive({
      ...current,
      sequence: event.sequence,
      logs: [...current.logs, event.line.slice(0, 4_096)].slice(-MAX_LOG_LINES),
      savedLogAvailable: true,
    })
  }
  if (event.type === 'offline') {
    return derive({
      ...current,
      sequence: event.sequence,
      phase: 'offline',
      cancellable: false,
      failure: null,
      message: event.message.slice(0, 1_024),
    })
  }
  if (event.type === 'failed') {
    return derive({
      ...current,
      sequence: event.sequence,
      phase: 'failed',
      cancellable: false,
      failure: { code: event.code, message: event.message.slice(0, 1_024) },
      logExpanded: true,
    })
  }
  return derive({
    ...current,
    sequence: event.sequence,
    phase: event.phase,
    cancellable: event.cancellable,
    release: event.release === undefined ? current.release : event.release,
    message: event.message === undefined ? current.message : event.message,
  })
}

function validEvent(event: UpdateEvent): boolean {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Number.isFinite(event.timestamp)) return false
  if (event.type !== 'download') return true
  return (
    Number.isSafeInteger(event.downloadedBytes) &&
    event.downloadedBytes >= 0 &&
    (event.totalBytes === null || (Number.isSafeInteger(event.totalBytes) && event.totalBytes >= 0)) &&
    (event.speedBytesPerSecond === null ||
      (Number.isFinite(event.speedBytesPerSecond) && event.speedBytesPerSecond >= 0))
  )
}

function derive(value: Omit<UpdateState, 'progressPercent'>): UpdateState {
  const progressPercent =
    value.totalBytes === null || value.totalBytes === 0
      ? null
      : Math.min(100, Math.round((value.downloadedBytes / value.totalBytes) * 100))
  return { ...value, progressPercent }
}

export interface UpdateControllerCallbacks {
  readonly onState?: (state: UpdateState) => void
  readonly onPreference?: (enabled: boolean) => void
  readonly onError?: (error: unknown) => void
}

export interface UpdateControllerOptions extends UpdateControllerCallbacks {
  readonly startupTimeoutMs?: number
}

export interface UpdateController {
  start(): Promise<void>
  check(startup: boolean): Promise<void>
  downloadInstall(runId: string): Promise<void>
  cancel(runId: string): Promise<void>
  defer(runId: string): Promise<void>
  openLog(runId: string): Promise<void>
  setStartupCheck(enabled: boolean): Promise<void>
  relaunch(): Promise<void>
  state(): UpdateState
  startupCheckEnabled(): boolean
  dispose(): void
}

export function createUpdateController(
  native: UpdateNativeBridge,
  options: UpdateControllerOptions = {},
): UpdateController {
  let current = replaceUpdateSnapshot(null, idleSnapshot())
  let preference = true
  let disposed = false
  let reconciling = false
  let buffered: UpdateEvent[] = []
  let unlisten: (() => void) | null = null
  let startOperation: Promise<void> | null = null
  const operations = new Map<string, Promise<unknown>>()
  let checkGeneration = 0
  let streamingInstall = false

  const publish = (state: UpdateState): void => {
    if (disposed) return
    current = state
    options.onState?.(current)
  }
  const receive: UpdateEventHandler = (event) => {
    if (disposed) return
    if (reconciling) {
      buffered.push(event)
      if (buffered.length > 1_000) buffered = buffered.slice(-1_000)
      return
    }
    const next = applyUpdateEvent(current, event)
    if (next !== current && next) publish(next)
    else if (streamingInstall && event.runId === current.runId && event.sequence > current.sequence) {
      buffered.push(event)
      if (buffered.length > 1_000) buffered = buffered.slice(-1_000)
    }
  }
  const reconcile = (snapshot: UpdateSnapshot): void => {
    let next = replaceUpdateSnapshot(current, snapshot)
    for (const event of buffered) next = applyUpdateEvent(next, event) ?? next
    buffered = []
    publish(next)
  }
  const transportState = (phase: 'failed' | 'offline', error: unknown): UpdateState =>
    replaceUpdateSnapshot(current, {
      ...current,
      sequence: current.sequence + 1,
      phase,
      cancellable: false,
      failure: phase === 'failed' ? { code: 'update_transport_failed', message: sanitizeMessage(error) } : null,
      message: phase === 'offline' ? 'Update check timed out or the network is offline.' : null,
    })

  async function startImpl(): Promise<void> {
    reconciling = true
    try {
      if (!unlisten) {
        const registered = await native.onUpdateEvent(receive)
        if (disposed) {
          registered()
          return
        }
        unlisten = registered
      }
      const status: UpdateStatusResponse = await native.updateStatus()
      if (disposed) return
      preference = status.startupCheckEnabled
      options.onPreference?.(preference)
      reconciling = false
      reconcile(status.snapshot)
    } catch (error: unknown) {
      reconciling = false
      buffered = []
      if (!disposed) {
        publish(transportState('failed', error))
        options.onError?.(error)
      }
    }
  }

  function once<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = operations.get(key)
    if (existing) return existing as Promise<T>
    const pending = operation().finally(() => {
      if (operations.get(key) === pending) operations.delete(key)
    })
    operations.set(key, pending)
    return pending
  }

  async function check(startup: boolean): Promise<void> {
    if (disposed) return
    return once('check', async () => {
      checkGeneration += 1
      const generation = checkGeneration
      reconciling = true
      const request = native.updateCheck(startup)
      try {
        const next = startup ? await timeout(request, options.startupTimeoutMs ?? 8_000) : await request
        if (!disposed && generation === checkGeneration) {
          reconciling = false
          reconcile(next)
        }
      } catch (error: unknown) {
        reconciling = false
        buffered = []
        if (disposed || generation !== checkGeneration) return
        if (startup) publish(transportState('offline', error))
        else {
          publish(transportState('failed', error))
          options.onError?.(error)
        }
      }
    })
  }

  const controller: UpdateController = {
    start(): Promise<void> {
      if (disposed) return Promise.resolve()
      if (startOperation) return startOperation
      const pending = startImpl().finally(() => {
        if (startOperation === pending) startOperation = null
      })
      startOperation = pending
      return pending
    },
    check,
    downloadInstall(runId: string): Promise<void> {
      if (disposed || current.runId !== runId || !['available', 'deferred'].includes(current.phase)) {
        return Promise.resolve()
      }
      return once(`install:${runId}`, async () => {
        streamingInstall = true
        try {
          const next = await native.updateDownloadInstall(runId)
          streamingInstall = false
          if (disposed) return
          if (next.runId === current.runId && next.sequence < current.sequence) {
            for (const event of buffered) {
              const replayed = applyUpdateEvent(current, event)
              if (replayed && replayed !== current) publish(replayed)
            }
            buffered = []
          } else reconcile(next)
        } catch (error: unknown) {
          streamingInstall = false
          buffered = []
          if (!disposed) {
            publish(transportState('failed', error))
            options.onError?.(error)
          }
        }
      })
    },
    cancel(runId: string): Promise<void> {
      if (disposed || current.runId !== runId || !current.cancellable) return Promise.resolve()
      return once(`cancel:${runId}`, async () => {
        try {
          await native.updateCancel(runId)
        } catch (error: unknown) {
          if (!disposed) options.onError?.(error)
        }
      })
    },
    defer(runId: string): Promise<void> {
      if (
        disposed ||
        current.runId !== runId ||
        !['available', 'failed', 'cancelling', 'recheck-required'].includes(current.phase)
      ) {
        return Promise.resolve()
      }
      return once(`defer:${runId}`, async () => {
        try {
          reconcile(await native.updateDefer(runId))
        } catch (error: unknown) {
          if (!disposed) options.onError?.(error)
        }
      })
    },
    openLog(runId: string): Promise<void> {
      if (disposed || current.runId !== runId || !current.savedLogAvailable) return Promise.resolve()
      return once(`open:${runId}`, async () => {
        try {
          await native.updateOpenLog(runId)
        } catch (error: unknown) {
          if (!disposed) options.onError?.(error)
        }
      })
    },
    setStartupCheck(enabled: boolean): Promise<void> {
      if (disposed) return Promise.resolve()
      return once(`preference:${enabled}`, async () => {
        try {
          preference = await native.updateSetStartupCheck(enabled)
          if (!disposed) options.onPreference?.(preference)
        } catch (error: unknown) {
          if (!disposed) options.onError?.(error)
        }
      })
    },
    relaunch(): Promise<void> {
      if (disposed) return Promise.resolve()
      return once('relaunch', () => native.updateRelaunch())
    },
    state: () => current,
    startupCheckEnabled: () => preference,
    dispose(): void {
      if (disposed) return
      disposed = true
      checkGeneration += 1
      buffered = []
      operations.clear()
      unlisten?.()
      unlisten = null
    },
  }
  return controller
}

function idleSnapshot(): UpdateSnapshot {
  return {
    runId: 'idle',
    sequence: 0,
    startedAt: Date.now(),
    phase: 'idle',
    cancellable: false,
    release: null,
    downloadedBytes: 0,
    totalBytes: null,
    speedBytesPerSecond: null,
    logs: [],
    failure: null,
    savedLogAvailable: false,
    message: null,
  }
}

function sanitizeMessage(error: unknown): string {
  const line = (error instanceof Error ? error.message : 'The update operation failed.').split(/\r?\n/, 1)[0] ?? ''
  return line.replace(/([?&][^=\s]+)=([^&\s]+)/g, '$1=[REDACTED]').slice(0, 1_024)
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Update check timed out.')), milliseconds)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
