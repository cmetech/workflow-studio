import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginArrangeMetrics,
  finishArrangeMetrics,
  latestArrangeMetrics,
  recordArrangePhase,
  resetArrangeMetrics,
} from './arrange-metrics'

describe('arrange metrics', () => {
  beforeEach(resetArrangeMetrics)

  it('keeps one bounded phase record whose total contains every phase', () => {
    const attempt = beginArrangeMetrics('layout:1', 100)
    recordArrangePhase(attempt, 'measure', 11)
    recordArrangePhase(attempt, 'fingerprint', 7)
    recordArrangePhase(attempt, 'fingerprint', 3)
    recordArrangePhase(attempt, 'serialize', 2)
    recordArrangePhase(attempt, 'worker', 23)
    recordArrangePhase(attempt, 'validate', 5)
    recordArrangePhase(attempt, 'publish', 13)
    recordArrangePhase(attempt, 'fit', 4)
    recordArrangePhase(attempt, 'persist', 6)
    finishArrangeMetrics(attempt, 'accepted', 180)

    expect(latestArrangeMetrics()).toEqual({
      requestId: 'layout:1',
      outcome: 'accepted',
      phases: {
        measure: 11,
        fingerprint: 10,
        serialize: 2,
        worker: 23,
        validate: 5,
        publish: 13,
        fit: 4,
        persist: 6,
      },
      phaseTotalMs: 74,
      totalMs: 80,
    })
  })

  it('ignores superseded attempt updates and exposes only the newest request', () => {
    const first = beginArrangeMetrics('layout:1', 10)
    recordArrangePhase(first, 'measure', 8)
    const second = beginArrangeMetrics('layout:2', 20)

    recordArrangePhase(first, 'worker', 500)
    finishArrangeMetrics(first, 'accepted', 600)
    recordArrangePhase(second, 'worker', 12)
    finishArrangeMetrics(second, 'accepted', 40)

    expect(latestArrangeMetrics()).toMatchObject({
      requestId: 'layout:2',
      outcome: 'accepted',
      phases: { measure: 0, worker: 12 },
      phaseTotalMs: 12,
      totalMs: 20,
    })
  })

  it('records cancellation without retaining workflow content or a phase history', () => {
    const attempt = beginArrangeMetrics('layout:7', 50)
    recordArrangePhase(attempt, 'measure', Number.NaN)
    recordArrangePhase(attempt, 'worker', -1)
    finishArrangeMetrics(attempt, 'cancelled', 55)

    const snapshot = latestArrangeMetrics()
    expect(snapshot).toMatchObject({
      requestId: 'layout:7',
      outcome: 'cancelled',
      phaseTotalMs: 0,
      totalMs: 5,
    })
    expect(JSON.stringify(snapshot)).not.toContain('workflow')
  })
})
