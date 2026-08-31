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
  return edgeIds.length === 0 ? emptyEdgeSelectionState(workflowIdentity) : { ...state, edgeIds }
}

export function authoritativeNodeIds(state: EdgeSelectionState, fallbackNodeIds: readonly string[]): readonly string[] {
  return state.edgeIds.length > 0 && state.nodeIds !== null ? state.nodeIds : fallbackNodeIds
}
