import type { Edge, Node, XYPosition } from '@xyflow/svelte'

export interface CanvasNodeData extends Record<string, unknown> {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly errorCount: number
  readonly requiredIssueCount: number
  readonly stale: boolean
  readonly readOnly: boolean
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
