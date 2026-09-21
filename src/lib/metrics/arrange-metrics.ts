export const ARRANGE_PHASES = [
  'measure',
  'fingerprint',
  'serialize',
  'worker',
  'validate',
  'publish',
  'fit',
  'persist',
] as const

export type ArrangePhase = (typeof ARRANGE_PHASES)[number]
export type ArrangeOutcome = 'pending' | 'accepted' | 'failed' | 'cancelled'

export interface ArrangeMetricsSnapshot {
  readonly requestId: string
  readonly outcome: ArrangeOutcome
  readonly phases: Readonly<Record<ArrangePhase, number>>
  readonly phaseTotalMs: number
  readonly totalMs: number
}

export interface ArrangeMetricsAttempt {
  readonly requestId: string
  readonly generation: number
}

interface ActiveArrangeMetrics {
  readonly attempt: ArrangeMetricsAttempt
  readonly startedAt: number
  readonly phases: Record<ArrangePhase, number>
  outcome: ArrangeOutcome
  finishedAt?: number
}

let generation = 0
let latest: ActiveArrangeMetrics | undefined

function emptyPhases(): Record<ArrangePhase, number> {
  return {
    measure: 0,
    fingerprint: 0,
    serialize: 0,
    worker: 0,
    validate: 0,
    publish: 0,
    fit: 0,
    persist: 0,
  }
}

export function beginArrangeMetrics(requestId: string, startedAt = performance.now()): ArrangeMetricsAttempt {
  const attempt = Object.freeze({ requestId, generation: ++generation })
  latest = { attempt, startedAt, phases: emptyPhases(), outcome: 'pending' }
  return attempt
}

export function recordArrangePhase(attempt: ArrangeMetricsAttempt, phase: ArrangePhase, durationMs: number): void {
  if (latest?.attempt !== attempt || !Number.isFinite(durationMs) || durationMs < 0) return
  latest.phases[phase] += durationMs
}

export function finishArrangeMetrics(
  attempt: ArrangeMetricsAttempt,
  outcome: Exclude<ArrangeOutcome, 'pending'>,
  finishedAt = performance.now(),
): void {
  if (latest?.attempt !== attempt) return
  latest.outcome = outcome
  latest.finishedAt = Math.max(latest.startedAt, finishedAt)
}

export function latestArrangeMetrics(): ArrangeMetricsSnapshot | null {
  if (!latest) return null
  const phases = Object.freeze({ ...latest.phases })
  const phaseTotalMs = ARRANGE_PHASES.reduce((total, phase) => total + phases[phase], 0)
  const elapsed = (latest.finishedAt ?? performance.now()) - latest.startedAt
  return Object.freeze({
    requestId: latest.attempt.requestId,
    outcome: latest.outcome,
    phases,
    phaseTotalMs,
    totalMs: Math.max(phaseTotalMs, elapsed),
  })
}

export function resetArrangeMetrics(): void {
  latest = undefined
}
