import type { Edge, Node, XYPosition } from '@xyflow/svelte'

export interface CanvasNodeData extends Record<string, unknown> {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly errorCount: number
  readonly requiredIssueCount: number
  readonly stale: boolean
  readonly readOnly: boolean
  readonly accessibleLabel: string
  readonly compound?: LoopGroupNodeSummary
}

export interface LoopGroupNodeSummary {
  readonly bodyNodeCount: number
  readonly maxIterations?: number
  readonly primarySinkId?: string
  readonly errorCount: number
  readonly requiredIssueCount: number
}

export interface CanvasEdgeData extends Record<string, unknown> {
  readonly stale: boolean
  readonly readOnly: boolean
}

export type CanvasNode = Node<CanvasNodeData, 'workflow'>
export type CanvasEdge = Edge<CanvasEdgeData, 'workflow'>
export type CanvasPosition = XYPosition

export interface CanvasProjection {
  readonly nodes: CanvasNode[]
  readonly edges: CanvasEdge[]
  readonly positions: Readonly<Record<string, CanvasPosition>>
  readonly capacity: { readonly status: 'visual' | 'yaml-only'; readonly nodeCount: number; readonly edgeCount: number }
  readonly stale: boolean
  readonly readOnly: boolean
}

export interface CanvasDragDetail {
  readonly nodes?: readonly { readonly id: string; readonly position: CanvasPosition }[]
  readonly id?: string
  readonly position?: CanvasPosition
}

export interface CanvasInspectorRelationship {
  readonly controls: () => string | undefined
  readonly expanded: () => boolean
  readonly toggle: (nodeId: string, invoker: HTMLElement) => void
}

export const CANVAS_INSPECTOR_RELATIONSHIP = Symbol('canvas-inspector-relationship')

export interface CanvasScopeRelationship {
  readonly openLoopGroup: (groupId: string, invoker: HTMLElement) => void | Promise<void>
}

export const CANVAS_SCOPE_RELATIONSHIP = Symbol('canvas-scope-relationship')
