import type { CanvasEdge } from './types'

export interface EdgeSelectionState {
  readonly workflowIdentity: string | null
  readonly edgeIds: readonly string[]
  readonly nodeIds: readonly string[] | null
}

export function emptyEdgeSelectionState(workflowIdentity: string | null = null): EdgeSelectionState {
  return { workflowIdentity, edgeIds: [], nodeIds: null }
}

export function commitEdgeSelection(
  _state: EdgeSelectionState,
  workflowIdentity: string,
  edgeIds: readonly string[],
  nodeIds: readonly string[],
): EdgeSelectionState {
  return edgeIds.length === 0
    ? emptyEdgeSelectionState(workflowIdentity)
    : { workflowIdentity, edgeIds: [...edgeIds], nodeIds: [...nodeIds] }
}

export function clearEdgeSelection(state: EdgeSelectionState): EdgeSelectionState {
  return emptyEdgeSelectionState(state.workflowIdentity)
}

export function reconcileEdgeSelection(
  state: EdgeSelectionState,
  workflowIdentity: string,
  availableEdgeIds: readonly string[],
): EdgeSelectionState {
  if (state.workflowIdentity !== workflowIdentity) return emptyEdgeSelectionState(workflowIdentity)
  const availableIds = new Set(availableEdgeIds)
  const edgeIds = state.edgeIds.filter((id) => availableIds.has(id))
  if (edgeIds.length === 0) {
    return state.edgeIds.length === 0 ? state : emptyEdgeSelectionState(workflowIdentity)
  }
  return sameIds(edgeIds, state.edgeIds) ? state : { ...state, edgeIds }
}

export function reconcileCanvasEdgeSelection(
  projected: readonly CanvasEdge[],
  current: readonly CanvasEdge[],
  selectedEdgeIds: readonly string[],
): CanvasEdge[] {
  if (projected === current && selectedEdgeIds.length === 0) return current as CanvasEdge[]
  const selected = new Set(selectedEdgeIds)
  let changed = projected.length !== current.length
  const next = projected.map((edge, index) => {
    const candidate = current[index]
    const shouldSelect = selected.has(edge.id)
    if (candidate && sameEdgeExceptSelection(candidate, edge) && Boolean(candidate.selected) === shouldSelect) {
      return candidate
    }
    changed = true
    return shouldSelect ? { ...edge, selected: true } : edge
  })
  return changed ? next : (current as CanvasEdge[])
}

export function createCanvasEdgeSelectionReconciler(): typeof reconcileCanvasEdgeSelection {
  let previousProjected: readonly CanvasEdge[] | undefined
  let previousSelectedEdgeIds: readonly string[] | undefined
  let previousResult: CanvasEdge[] | undefined
  return (projected, current, selectedEdgeIds) => {
    if (
      projected === previousProjected &&
      current === previousResult &&
      previousSelectedEdgeIds &&
      sameIds(selectedEdgeIds, previousSelectedEdgeIds)
    ) {
      return previousResult
    }
    const result = reconcileCanvasEdgeSelection(projected, current, selectedEdgeIds)
    previousProjected = projected
    previousSelectedEdgeIds = selectedEdgeIds
    previousResult = result
    return result
  }
}

export function authoritativeNodeIds(state: EdgeSelectionState, fallbackNodeIds: readonly string[]): readonly string[] {
  return state.edgeIds.length > 0 && state.nodeIds !== null ? state.nodeIds : fallbackNodeIds
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sameEdgeExceptSelection(left: CanvasEdge, right: CanvasEdge): boolean {
  const leftRecord = left as unknown as Record<string, unknown>
  const rightRecord = right as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
  keys.delete('selected')
  return [...keys].every((key) => Object.is(leftRecord[key], rightRecord[key]))
}
