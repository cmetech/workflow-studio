import { describe, expect, it } from 'vitest'
import { applyProgressEvent, replaceProgressSnapshot } from './progress-reducer'
import type { ProgressEvent, ProgressSnapshot } from './types'

const manifest = (runId = 'run-a', sequence = 1): ProgressEvent => ({
  type: 'manifest',
  runId,
  sequence,
  timestamp: 100,
  startedAt: 100,
  cancellable: true,
  stages: [
    { id: 'app-data', label: 'Prepare application data' },
    { id: 'resources', label: 'Verify bundled resources' },
    { id: 'git', label: 'Detect Git' },
    { id: 'workspace', label: 'Restore workspace' },
    { id: 'ready', label: 'Verify readiness' },
  ],
})

describe('progress reducer', () => {
  it('replaces a reconnecting client with the complete native snapshot', () => {
    const snapshot: ProgressSnapshot = {
      runId: 'run-b',
      sequence: 8,
      startedAt: 20,
      status: 'running',
      cancellable: true,
      currentStageId: 'resources',
      stages: [
        { id: 'app-data', label: 'Prepare application data', status: 'succeeded', durationMs: 4 },
        { id: 'resources', label: 'Verify bundled resources', status: 'running' },
      ],
      logs: ['prepared', 'verifying'],
      failure: null,
      savedLogAvailable: true,
    }

    const state = replaceProgressSnapshot(applyProgressEvent(null, manifest()), snapshot)

    expect(state).toMatchObject({ runId: 'run-b', sequence: 8, currentStageId: 'resources' })
    expect(state?.stages.map(({ status }) => status)).toEqual(['succeeded', 'running'])
    expect(state?.logs).toEqual(['prepared', 'verifying'])
  })

  it('ignores duplicates, out-of-order sequences, and events from stale run IDs', () => {
    let state = applyProgressEvent(null, manifest())
    const running: ProgressEvent = {
      type: 'stage',
      runId: 'run-a',
      sequence: 2,
      timestamp: 110,
      stageId: 'app-data',
      status: 'running',
    }
    state = applyProgressEvent(state, running)
    state = applyProgressEvent(state, { ...running, status: 'failed' })
    state = applyProgressEvent(state, { ...running, runId: 'old-run', sequence: 99, status: 'failed' })

    expect(state?.sequence).toBe(2)
    expect(state?.stages[0]?.status).toBe('running')
  })

  it('ignores events with non-finite timestamps, durations, or sequences', () => {
    const current = applyProgressEvent(null, manifest())
    const invalid = applyProgressEvent(current, {
      type: 'stage',
      runId: 'run-a',
      sequence: Number.NaN,
      timestamp: Number.POSITIVE_INFINITY,
      stageId: 'app-data',
      status: 'succeeded',
      durationMs: Number.NEGATIVE_INFINITY,
    })

    expect(invalid).toBe(current)
  })

  it('preserves terminal state when late events arrive', () => {
    let state = applyProgressEvent(null, manifest())
    state = applyProgressEvent(state, {
      type: 'complete',
      runId: 'run-a',
      sequence: 2,
      timestamp: 120,
      durationMs: 20,
    })
    state = applyProgressEvent(state, {
      type: 'stage',
      runId: 'run-a',
      sequence: 3,
      timestamp: 121,
      stageId: 'ready',
      status: 'failed',
    })

    expect(state?.status).toBe('succeeded')
    expect(state?.sequence).toBe(2)
  })

  it('uses terminal stage outcomes for progress and treats skipped Git as complete', () => {
    let state = applyProgressEvent(null, manifest())
    for (const [index, stageId] of ['app-data', 'resources', 'git'].entries()) {
      state = applyProgressEvent(state, {
        type: 'stage',
        runId: 'run-a',
        sequence: index + 2,
        timestamp: 110 + index,
        stageId,
        status: stageId === 'git' ? 'skipped' : 'succeeded',
        durationMs: 3,
      } as ProgressEvent)
    }

    expect(state?.completedStages).toBe(3)
    expect(state?.totalStages).toBe(5)
    expect(state?.progressPercent).toBe(60)
  })

  it('keeps only the newest 500 renderer log lines', () => {
    let state = applyProgressEvent(null, manifest())
    for (let index = 0; index < 503; index += 1) {
      state = applyProgressEvent(state, {
        type: 'log',
        runId: 'run-a',
        sequence: index + 2,
        timestamp: 110 + index,
        line: `line ${index}`,
      })
    }

    expect(state?.logs).toHaveLength(500)
    expect(state?.logs[0]).toBe('line 3')
    expect(state?.logs[499]).toBe('line 502')
  })

  it('expands logs and records a bounded failure summary automatically', () => {
    const state = applyProgressEvent(applyProgressEvent(null, manifest()), {
      type: 'failed',
      runId: 'run-a',
      sequence: 2,
      timestamp: 150,
      durationMs: 50,
      code: 'setup_resource_digest_mismatch',
      message: 'Bundled resource verification failed.',
    })

    expect(state).toMatchObject({ status: 'failed', logExpanded: true })
    expect(state?.failure).toEqual({
      code: 'setup_resource_digest_mismatch',
      message: 'Bundled resource verification failed.',
    })
  })
})
