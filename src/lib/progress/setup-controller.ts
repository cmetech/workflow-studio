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
  let current: ProgressState | null = null
  let disposed = false
  let unlisten: (() => void) | null = null
  let reconciling = false
  let buffered: ProgressEvent[] = []

  function publish(next: ProgressState | null): void {
    if (disposed) return
    const wasReady = current?.status === 'succeeded'
    current = next
    callbacks.onState?.(current)
    if (!wasReady && current?.status === 'succeeded') callbacks.onReady?.()
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

  async function start(): Promise<void> {
    if (disposed || unlisten) return
    reconciling = true
    try {
      const registered = await native.onSetupEvent(receive)
      if (disposed) {
        registered()
        return
      }
      unlisten = registered
      const status = await native.setupStatus()
      if (disposed) return
      if (status.ready && status.snapshot === null) {
        reconciling = false
        buffered = []
        callbacks.onReady?.()
        return
      }
      if (status.snapshot) {
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
      if (!disposed) callbacks.onError?.(error)
    }
  }

  return {
    start,
    async retry(): Promise<void> {
      if (disposed) return
      reconciling = true
      buffered = []
      try {
        const started = await native.setupStart()
        if (disposed) return
        reconciling = false
        reconcile(started)
      } catch (error: unknown) {
        reconciling = false
        if (!disposed) callbacks.onError?.(error)
      }
    },
    async cancel(runId: string): Promise<void> {
      if (disposed || current?.runId !== runId) return
      try {
        await native.setupCancel(runId)
      } catch (error: unknown) {
        if (!disposed) callbacks.onError?.(error)
      }
    },
    async openLog(runId: string): Promise<void> {
      if (disposed || current?.runId !== runId) return
      try {
        await native.setupOpenLog(runId)
      } catch (error: unknown) {
        if (!disposed) callbacks.onError?.(error)
      }
    },
    state: () => current,
    dispose(): void {
      if (disposed) return
      disposed = true
      buffered = []
      unlisten?.()
      unlisten = null
    },
  }
}
