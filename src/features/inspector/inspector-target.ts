import type { GraphScopeKey, ProjectedGraph, ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'

export type InspectorTarget =
  | { readonly kind: 'workflow' }
  | { readonly kind: 'node'; readonly scopeKey: GraphScopeKey; readonly nodeId: string }
  | { readonly kind: 'group'; readonly bodyScopeKey: GraphScopeKey; readonly groupId: string }

export interface ResolvedInspectorTarget {
  readonly target: InspectorTarget
  readonly graph?: ProjectedGraph
  readonly node?: ProjectedNode
}

export function resolveInspectorTarget(
  projection: WorkflowProjection | null,
  target: InspectorTarget,
): ResolvedInspectorTarget {
  if (!projection || target.kind === 'workflow') return { target }
  const scopeKey = target.kind === 'group' ? 'root' : target.scopeKey
  const nodeId = target.kind === 'group' ? target.groupId : target.nodeId
  const graph = projection.graphs.find((candidate) => candidate.scope.key === scopeKey)
  const node = graph?.nodes.find((candidate) => candidate.id === nodeId)
  return { target, ...(graph ? { graph } : {}), ...(node ? { node } : {}) }
}
