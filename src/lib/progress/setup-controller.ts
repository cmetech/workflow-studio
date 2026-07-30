import type { SetupNativeBridge } from '$src/lib/native/types'
import { applyProgressEvent, replaceProgressSnapshot } from './progress-reducer'
import type { ProgressEvent, ProgressSnapshot, ProgressState } from './types'

export interface SetupControllerCallbacks {
  readonly onState?: (state: ProgressState | null) => void
  readonly onReady?: () => void
  readonly onError?: (error: unknown) => void
}

export interface SetupController {
  start(): Promise<void>
  retry(): Promise<void>
  cancel(runId: string): Promise<void>
  openLog(runId: string): Promise<void>
  state(): ProgressState | null
  dispose(): void
}

export function createSetupController(
  native: SetupNativeBridge,
  callbacks: SetupControllerCallbacks = {},
): SetupController {
  let current: ProgressState | null = initializingState()
  let disposed = false
  let unlisten: (() => void) | null = null
  let reconciling = false
  let buffered: ProgressEvent[] = []
  let synchronization: Promise<void> | null = null
  let cancelOperation: { runId: string; promise: Promise<void> } | null = null
  let openLogOperation: { runId: string; promise: Promise<void> } | null = null
  let readyReported = false

  function reportReady(): void {
    if (disposed || readyReported) return
    readyReported = true
    callbacks.onReady?.()
  }

  function publish(next: ProgressState | null): void {
    if (disposed) return
    const wasReady = current?.status === 'succeeded'
    current = next
    callbacks.onState?.(current)
    if (!wasReady && current?.status === 'succeeded') reportReady()
  }

  function receive(event: ProgressEvent): void {
    if (disposed) return
    if (reconciling || current === null) {
      buffered.push(event)
      if (buffered.length > 1_000) buffered = buffered.slice(-1_000)
      return
    }
    publish(applyProgressEvent(current, event))
  }

  function reconcile(snapshot: ProgressSnapshot): void {
    let next = replaceProgressSnapshot(current, snapshot)
    const events = buffered
    buffered = []
    for (const event of events) next = applyProgressEvent(next, event)
    publish(next)
  }

  function publishTransportFailure(error: unknown): void {
    if (disposed) return
    const message = sanitizeSetupMessage(
      error instanceof Error ? error.message : 'Application setup could not be completed.',
    )
    const previous = current
    publish(
      replaceProgressSnapshot(current, {
        runId: previous?.runId ?? 'setup-connection',
        sequence: (previous?.sequence ?? 0) + 1,
        startedAt: previous?.startedAt ?? Date.now(),
        status: 'failed',
        cancellable: false,
        currentStageId: null,
        stages: previous?.stages ?? [
          { id: 'app-data', label: 'Connect to application setup', status: 'failed', message },
        ],
        logs: previous?.logs ?? [],
        failure: { code: 'setup_transport_failed', message },
        savedLogAvailable: previous?.savedLogAvailable ?? false,
      }),
    )
    callbacks.onError?.(error)
  }

  async function synchronize(retry: boolean): Promise<void> {
    if (disposed) return
    reconciling = true
    try {
      if (!unlisten) {
        const registered = await native.onSetupEvent(receive)
        if (disposed) {
          registered()
          return
        }
        unlisten = registered
      }
      const status = await native.setupStatus()
      if (disposed) return
      if (status.ready && status.snapshot === null) {
        reconciling = false
        buffered = []
        publish(null)
        reportReady()
        return
      }
      if (status.snapshot && (!retry || status.snapshot.status === 'running')) {
        reconciling = false
        reconcile(status.snapshot)
        return
      }
      const started = await native.setupStart()
      if (disposed) return
      reconciling = false
      reconcile(started)
    } catch (error: unknown) {
      reconciling = false
      buffered = []
      publishTransportFailure(error)
    }
  }

  function beginSynchronization(retry: boolean): Promise<void> {
    if (disposed) return Promise.resolve()
    if (synchronization) return synchronization
    const pending = synchronize(retry).finally(() => {
      if (synchronization === pending) synchronization = null
    })
    synchronization = pending
    return pending
  }

  function start(): Promise<void> {
    return beginSynchronization(false)
  }

  return {
    start,
    retry(): Promise<void> {
      return beginSynchronization(true)
    },
    cancel(runId: string): Promise<void> {
      if (disposed || current?.runId !== runId) return Promise.resolve()
      if (cancelOperation?.runId === runId) return cancelOperation.promise
      const promise = native
        .setupCancel(runId)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (!disposed) callbacks.onError?.(error)
        })
        .finally(() => {
          if (cancelOperation?.promise === promise) cancelOperation = null
        })
      cancelOperation = { runId, promise }
      return promise
    },
    openLog(runId: string): Promise<void> {
      if (disposed || current?.runId !== runId) return Promise.resolve()
      if (openLogOperation?.runId === runId) return openLogOperation.promise
      const promise = native
        .setupOpenLog(runId)
        .catch((error: unknown) => {
          if (!disposed) callbacks.onError?.(error)
        })
        .finally(() => {
          if (openLogOperation?.promise === promise) openLogOperation = null
        })
      openLogOperation = { runId, promise }
      return promise
    },
    state: () => current,
    dispose(): void {
      if (disposed) return
      disposed = true
      buffered = []
      unlisten?.()
      unlisten = null
      current = null
    },
  }
}

function initializingState(): ProgressState {
  return replaceProgressSnapshot(null, {
    runId: 'setup-initializing',
    sequence: 0,
    startedAt: Date.now(),
    status: 'running',
    cancellable: false,
    currentStageId: 'app-data',
    stages: [{ id: 'app-data', label: 'Checking setup readiness', status: 'running' }],
    logs: [],
    failure: null,
    savedLogAvailable: false,
  })!
}

function sanitizeSetupMessage(input: string): string {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? ''
  const lower = firstLine.toLowerCase()
  if (['prompt:', 'command:', 'nodes:', 'workflow:'].some((marker) => lower.includes(marker))) {
    return '[workflow content redacted]'
  }
  let value = firstLine
  const query = value.indexOf('?')
  if (query >= 0 && value.slice(0, query).includes('://')) value = `${value.slice(0, query)}?[REDACTED]`
  const redactionTarget = value.toLowerCase()
  const sensitive = ['authorization', 'access_token', 'refresh_token', 'token', 'api_key', 'apikey']
    .map((key) => ({ key, index: redactionTarget.indexOf(key) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (sensitive) {
    const { index, key } = sensitive
    const suffix = value.slice(index)
    const delimiterOffset = suffix.search(/[:=]/)
    const end = delimiterOffset < 0 ? index + key.length : index + delimiterOffset + 1
    value = `${value.slice(0, end)}[REDACTED]`
  }
  return value.slice(0, 1_024)
}
