import { describe, expect, it } from 'vitest'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { shouldRefreshCanvasProjection, type CanvasProjectionRefreshSnapshot } from './canvas-projection-refresh'

const projection = {} as WorkflowProjection
const issues: readonly ValidationIssue[] = []
const positions: LayoutRecordV1['nodePositions'] = {
  collect: { x: 100, y: 200 },
  review: { x: 320, y: 0 },
}

function snapshot(overrides: Partial<CanvasProjectionRefreshSnapshot> = {}): CanvasProjectionRefreshSnapshot {
  return {
    projection,
    issues,
    workflowIdentity: 'workspace\0release.yaml',
    stale: false,
    readOnly: false,
    transitionLocked: false,
    ...overrides,
  }
}

describe('shouldRefreshCanvasProjection', () => {
  it('skips an updated-at-only persistence echo whose positions already match the live canvas', () => {
    expect(shouldRefreshCanvasProjection(snapshot(), snapshot(), { ...positions }, positions)).toBe(false)
  })

  it('refreshes when incoming layout positions differ from the live canvas', () => {
    expect(
      shouldRefreshCanvasProjection(snapshot(), snapshot(), { ...positions, collect: { x: 640, y: 480 } }, positions),
    ).toBe(true)
  })

  it.each([
    ['projection', snapshot({ projection: {} as WorkflowProjection })],
    ['diagnostics', snapshot({ issues: [{} as ValidationIssue] })],
    ['stale state', snapshot({ stale: true })],
    ['read-only state', snapshot({ readOnly: true })],
    ['transition state', snapshot({ transitionLocked: true })],
    ['workflow identity', snapshot({ workflowIdentity: 'workspace\0deploy.yaml' })],
  ])('refreshes when %s changes', (_label, next) => {
    expect(shouldRefreshCanvasProjection(snapshot(), next, positions, positions)).toBe(true)
  })

  it('refreshes the first projection even when incoming and live positions match', () => {
    expect(shouldRefreshCanvasProjection(undefined, snapshot(), positions, positions)).toBe(true)
  })
})
