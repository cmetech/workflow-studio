export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'restart-required'
  | 'deferred'
  | 'cancelling'
  | 'recheck-required'
  | 'dismissed'
  | 'failed'
  | 'offline'

export interface UpdateRelease {
  readonly version: string
  readonly notes: string
  readonly date: string | null
  readonly size: number | null
  readonly platform: string
}

export interface UpdateFailure {
  readonly code: string
  readonly message: string
}

export interface UpdateSnapshot {
  readonly runId: string
  readonly sequence: number
  readonly startedAt: number
  readonly phase: UpdatePhase
  readonly cancellable: boolean
  readonly release: UpdateRelease | null
  readonly downloadedBytes: number
  readonly totalBytes: number | null
  readonly speedBytesPerSecond: number | null
  readonly logs: readonly string[]
  readonly failure: UpdateFailure | null
  readonly savedLogAvailable: boolean
  readonly message: string | null
}

interface UpdateEventBase {
  readonly runId: string
  readonly sequence: number
  readonly timestamp: number
}

export type UpdateEvent =
  | (UpdateEventBase & {
      readonly type: 'phase'
      readonly phase: Exclude<UpdatePhase, 'failed' | 'offline'>
      readonly cancellable: boolean
      readonly release?: UpdateRelease | null
      readonly message?: string | null
    })
  | (UpdateEventBase & {
      readonly type: 'download'
      readonly downloadedBytes: number
      readonly totalBytes: number | null
      readonly speedBytesPerSecond: number | null
    })
  | (UpdateEventBase & { readonly type: 'log'; readonly line: string })
  | (UpdateEventBase & { readonly type: 'offline'; readonly message: string })
  | (UpdateEventBase & { readonly type: 'failed'; readonly code: string; readonly message: string })

export interface UpdateState extends UpdateSnapshot {
  readonly logExpanded: boolean
  readonly progressPercent: number | null
}

export interface UpdateStatusResponse {
  readonly snapshot: UpdateSnapshot
  readonly startupCheckEnabled: boolean
}

export type UpdateEventHandler = (event: UpdateEvent) => void | Promise<void>
