import dagre from '@dagrejs/dagre'
import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
import type { CanvasPosition } from './types'

export const CANVAS_NODE_WIDTH = 216
export const CANVAS_NODE_HEIGHT = 104

export interface LayoutGraphNode {
  readonly id: string
}

export interface LayoutGraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
}

export type LayoutGraphAdapter = (
  nodes: readonly LayoutGraphNode[],
  edges: readonly LayoutGraphEdge[],
) => Readonly<Record<string, CanvasPosition>>

/** The sole Dagre boundary. Inputs are inserted in stable order and never mutated. */
export const layoutGraph: LayoutGraphAdapter = (nodes, edges) => {
  recordEditorMetric('layouts')
  const graph = new dagre.graphlib.Graph({ directed: true, multigraph: true })
  graph.setGraph({ rankdir: 'LR', ranksep: 104, nodesep: 56, marginx: 24, marginy: 24 })
  graph.setDefaultEdgeLabel(() => ({}))

  const orderedNodes = [...nodes].sort((left, right) => compareText(left.id, right.id))
  const knownNodes = new Set(orderedNodes.map(({ id }) => id))
  for (const node of orderedNodes) graph.setNode(node.id, { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })

  const orderedEdges = [...edges].sort((left, right) =>
    compareText(
      `${left.source}\u0000${left.target}\u0000${left.id}`,
      `${right.source}\u0000${right.target}\u0000${right.id}`,
    ),
  )
  for (const edge of orderedEdges) {
    if (knownNodes.has(edge.source) && knownNodes.has(edge.target)) {
      graph.setEdge(edge.source, edge.target, {}, edge.id)
    }
  }

  dagre.layout(graph)
  return Object.fromEntries(
    orderedNodes.map(({ id }) => {
      const node = graph.node(id) as { x: number; y: number }
      return [id, { x: node.x - CANVAS_NODE_WIDTH / 2, y: node.y - CANVAS_NODE_HEIGHT / 2 }]
    }),
  )
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
