export type ProgressStageId = string
export type ProgressStageStatus = 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed'
export type ProgressRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ProgressStageDefinition {
  readonly id: ProgressStageId
  readonly label: string
}

export interface ProgressStage extends ProgressStageDefinition {
  readonly status: ProgressStageStatus
  readonly durationMs?: number
  readonly message?: string
}

interface ProgressEventBase {
  readonly runId: string
  readonly sequence: number
  readonly timestamp: number
}

export type ProgressEvent =
  | (ProgressEventBase & {
      readonly type: 'manifest'
      readonly startedAt: number
      readonly cancellable: boolean
      readonly stages: readonly ProgressStageDefinition[]
    })
  | (ProgressEventBase & {
      readonly type: 'stage'
      readonly stageId: ProgressStageId
      readonly status: ProgressStageStatus
      readonly cancellable?: boolean
      readonly durationMs?: number
      readonly message?: string
    })
  | (ProgressEventBase & { readonly type: 'log'; readonly line: string })
  | (ProgressEventBase & { readonly type: 'complete'; readonly durationMs: number })
  | (ProgressEventBase & {
      readonly type: 'failed'
      readonly durationMs: number
      readonly code: string
      readonly message: string
    })
  | (ProgressEventBase & { readonly type: 'cancelled'; readonly durationMs: number })

export interface ProgressFailure {
  readonly code: string
  readonly message: string
}

export interface ProgressSnapshot {
  readonly runId: string
  readonly sequence: number
  readonly startedAt: number
  readonly status: ProgressRunStatus
  readonly cancellable: boolean
  readonly currentStageId: ProgressStageId | null
  readonly stages: readonly ProgressStage[]
  readonly logs: readonly string[]
  readonly failure: ProgressFailure | null
  readonly savedLogAvailable: boolean
}

export interface ProgressState extends ProgressSnapshot {
  readonly logExpanded: boolean
  readonly completedStages: number
  readonly totalStages: number
  readonly progressPercent: number
}

export type ProgressEventHandler = (event: ProgressEvent) => void | Promise<void>
export type UnlistenProgress = () => void
