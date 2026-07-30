import type { ProgressEvent, ProgressSnapshot, ProgressStage, ProgressState } from './types'

const MAX_RENDERER_LOG_LINES = 500
const TERMINAL_STAGES = new Set(['succeeded', 'skipped', 'failed'])

export function replaceProgressSnapshot(
  _current: ProgressState | null,
  snapshot: ProgressSnapshot | null,
): ProgressState | null {
  if (!snapshot) return null
  return derive({
    ...snapshot,
    stages: snapshot.stages.map((stage) => ({ ...stage })),
    logs: snapshot.logs.slice(-MAX_RENDERER_LOG_LINES),
    logExpanded: snapshot.status === 'failed',
  })
}

export function applyProgressEvent(current: ProgressState | null, event: ProgressEvent): ProgressState | null {
  if (!validEventNumbers(event)) return current
  if (event.type === 'manifest') {
    if (current) return current
    return derive({
      runId: event.runId,
      sequence: event.sequence,
      startedAt: event.startedAt,
      status: 'running',
      cancellable: event.cancellable,
      currentStageId: null,
      stages: event.stages.map((stage) => ({ ...stage, status: 'pending' })),
      logs: [],
      failure: null,
      savedLogAvailable: false,
      logExpanded: false,
    })
  }
  if (!current || event.runId !== current.runId || event.sequence <= current.sequence) return current
  if (current.status !== 'running') return current

  if (event.type === 'log') {
    return derive({
      ...current,
      sequence: event.sequence,
      logs: [...current.logs, event.line].slice(-MAX_RENDERER_LOG_LINES),
      savedLogAvailable: true,
    })
  }
  if (event.type === 'stage') {
    const stages = current.stages.map((stage): ProgressStage =>
      stage.id === event.stageId
        ? {
            ...stage,
            status: event.status,
            ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
            ...(event.message === undefined ? {} : { message: event.message }),
          }
        : stage,
    )
    return derive({
      ...current,
      sequence: event.sequence,
      stages,
      cancellable: event.cancellable ?? current.cancellable,
      currentStageId: event.status === 'running' ? event.stageId : null,
    })
  }
  if (event.type === 'complete') {
    return derive({ ...current, sequence: event.sequence, status: 'succeeded', cancellable: false })
  }
  if (event.type === 'cancelled') {
    const stages = current.stages.map((stage): ProgressStage =>
      stage.status === 'running' ? { ...stage, status: 'skipped' } : stage,
    )
    return derive({
      ...current,
      sequence: event.sequence,
      status: 'cancelled',
      cancellable: false,
      currentStageId: null,
      stages,
    })
  }
  return derive({
    ...current,
    sequence: event.sequence,
    status: 'failed',
    cancellable: false,
    failure: { code: event.code, message: event.message.slice(0, 1_024) },
    logExpanded: true,
  })
}

function validEventNumbers(event: ProgressEvent): boolean {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Number.isFinite(event.timestamp)) return false
  if (event.type === 'manifest' && !Number.isFinite(event.startedAt)) return false
  if ('durationMs' in event && event.durationMs !== undefined && !Number.isFinite(event.durationMs)) return false
  return true
}

function derive(state: Omit<ProgressState, 'completedStages' | 'totalStages' | 'progressPercent'>): ProgressState {
  const completedStages = state.stages.filter(({ status }) => TERMINAL_STAGES.has(status)).length
  const totalStages = state.stages.length
  return {
    ...state,
    completedStages,
    totalStages,
    progressPercent: totalStages === 0 ? 0 : Math.round((completedStages / totalStages) * 100),
  }
}
