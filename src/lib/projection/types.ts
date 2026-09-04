import type { WorkflowProfile } from '$src/lib/contract/types'

export interface ProjectedNode {
  id: string
  kind: string
  value: unknown
  dependsOn: readonly string[]
  options: Readonly<Record<string, unknown>>
  source: { path: string; start: number; end: number }
}

export interface ProjectedEdge {
  id: string
  source: string
  target: string
}

export type GraphScopeKey = 'root' | `loop-group:${string}`

export interface WorkflowIdentity {
  readonly name: string
  readonly profile: WorkflowProfile
}

export interface GraphScope {
  readonly key: GraphScopeKey
  readonly kind: 'root' | 'loop-group'
  readonly workflow: WorkflowIdentity
  readonly groupId?: string
}

export interface ProjectedGraph {
  readonly scope: GraphScope
  readonly editorNodePrefix: string
  readonly sourcePath: readonly (string | number)[]
  readonly sourceRange: { readonly start: number; readonly end: number }
  readonly nodes: readonly ProjectedNode[]
  readonly edges: readonly ProjectedEdge[]
  readonly definitionOrder: readonly string[]
  readonly primarySinkId?: string
  readonly outerInputs: readonly string[]
  readonly issues: readonly import('$src/lib/documents/types').ValidationIssue[]
  readonly capacity: { readonly status: 'visual' | 'yaml-only'; readonly nodeCount: number; readonly edgeCount: number }
}

export interface WorkflowProjection {
  readonly name: string
  readonly description?: string
  readonly profile: WorkflowProfile
  readonly graphs: readonly ProjectedGraph[]
  readonly definition: unknown
  readonly companion?: unknown
}

export const VISUAL_NODE_CAPACITY = 250
export const VISUAL_EDGE_CAPACITY = 500
