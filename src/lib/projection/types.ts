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

export interface WorkflowProjection {
  name: string
  description: string
  profile: WorkflowProfile
  nodes: readonly ProjectedNode[]
  edges: readonly ProjectedEdge[]
  definition: Readonly<Record<string, unknown>>
  companion: Readonly<Record<string, unknown>> | null
}
