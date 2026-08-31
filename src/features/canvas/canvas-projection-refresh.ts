import type { ValidationIssue } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import type { CanvasPosition } from './types'

export interface CanvasProjectionRefreshSnapshot {
  readonly projection: WorkflowProjection
  readonly issues: readonly ValidationIssue[]
  readonly workflowIdentity: string
  readonly stale: boolean
  readonly readOnly: boolean
  readonly transitionLocked: boolean
}

export function shouldRefreshCanvasProjection(
  previous: CanvasProjectionRefreshSnapshot | undefined,
  next: CanvasProjectionRefreshSnapshot,
  incomingPositions: Readonly<Record<string, CanvasPosition>>,
  livePositions: Readonly<Record<string, CanvasPosition>>,
): boolean {
  return (
    !previous ||
    previous.projection !== next.projection ||
    previous.issues !== next.issues ||
    previous.workflowIdentity !== next.workflowIdentity ||
    previous.stale !== next.stale ||
    previous.readOnly !== next.readOnly ||
    previous.transitionLocked !== next.transitionLocked ||
    !samePositions(incomingPositions, livePositions)
  )
}

function samePositions(
  left: Readonly<Record<string, CanvasPosition>>,
  right: Readonly<Record<string, CanvasPosition>>,
): boolean {
  const leftIds = Object.keys(left)
  const rightIds = Object.keys(right)
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id) => left[id]?.x === right[id]?.x && left[id]?.y === right[id]?.y)
  )
}
