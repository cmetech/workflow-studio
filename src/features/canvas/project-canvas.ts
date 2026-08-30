import { MarkerType, Position } from '@xyflow/svelte'
import { reconcileLayout } from '$src/lib/layout/place-new-nodes'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH, layoutGraph, type LayoutGraphAdapter } from './layout-graph'
import type { CanvasEdge, CanvasNode, CanvasProjection, CanvasPosition } from './types'

const SUMMARY_LIMIT = 72
export const MAX_VISUAL_NODES = 250
export const MAX_VISUAL_EDGES = 500

export interface ProjectCanvasOptions {
  readonly stale?: boolean
  readonly readOnly?: boolean
  readonly arrange?: boolean
  readonly issues?: readonly ValidationIssue[]
  readonly layoutGraph?: LayoutGraphAdapter
}

export interface CanvasCapacity {
  readonly visual: boolean
  readonly blocking: false
  readonly nodeCount: number
  readonly edgeCount: number
  readonly advisory?: string
}

export type ProjectCanvasAdapter = (
  projection: WorkflowProjection,
  savedLayout: LayoutRecordV1,
  options?: ProjectCanvasOptions,
) => CanvasProjection

export function createMemoizedCanvasProjector(): ProjectCanvasAdapter {
  let previousProjection: WorkflowProjection | undefined
  let previousLayout: LayoutRecordV1 | undefined
  let previousOptions: ProjectCanvasOptions | undefined
  let previousResult: CanvasProjection | undefined

  return (projection, savedLayout, options = {}) => {
    if (
      previousResult &&
      projection === previousProjection &&
      savedLayout === previousLayout &&
      sameProjectOptions(options, previousOptions)
    ) {
      return previousResult
    }
    const projected = projectCanvas(projection, savedLayout, options)
    const result = previousResult ? reuseUnchangedCanvasElements(previousResult, projected) : projected
    previousProjection = projection
    previousLayout = savedLayout
    previousOptions = options
    previousResult = result
    return result
  }
}

function reuseUnchangedCanvasElements(previous: CanvasProjection, next: CanvasProjection): CanvasProjection {
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]))
  const nodes = next.nodes.map((node) => {
    const candidate = previousNodes.get(node.id)
    return candidate && sameCanvasNode(candidate, node) ? candidate : node
  })
  const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]))
  const edges = next.edges.map((edge) => {
    const candidate = previousEdges.get(edge.id)
    return candidate && sameCanvasEdge(candidate, edge) ? candidate : edge
  })
  return {
    ...next,
    nodes: sameIdentityArray(nodes, previous.nodes) ? previous.nodes : nodes,
    edges: sameIdentityArray(edges, previous.edges) ? previous.edges : edges,
    positions: samePositions(previous.positions, next.positions) ? previous.positions : next.positions,
  }
}

function sameCanvasNode(left: CanvasNode, right: CanvasNode): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.initialWidth === right.initialWidth &&
    left.initialHeight === right.initialHeight &&
    left.sourcePosition === right.sourcePosition &&
    left.targetPosition === right.targetPosition &&
    left.draggable === right.draggable &&
    left.connectable === right.connectable &&
    left.selectable === right.selectable &&
    left.focusable === right.focusable &&
    left.ariaLabel === right.ariaLabel &&
    left.data.id === right.data.id &&
    left.data.kind === right.data.kind &&
    left.data.summary === right.data.summary &&
    left.data.errorCount === right.data.errorCount &&
    left.data.requiredIssueCount === right.data.requiredIssueCount &&
    left.data.stale === right.data.stale &&
    left.data.readOnly === right.data.readOnly
  )
}

function sameCanvasEdge(left: CanvasEdge, right: CanvasEdge): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.source === right.source &&
    left.target === right.target &&
    left.selectable === right.selectable &&
    left.focusable === right.focusable &&
    left.interactionWidth === right.interactionWidth &&
    left.ariaLabel === right.ariaLabel &&
    left.data?.stale === right.data?.stale &&
    left.data?.readOnly === right.data?.readOnly
  )
}

function sameIdentityArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
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

export function canvasCapacityForProjection(projection: WorkflowProjection): CanvasCapacity {
  const nodeCount = projection.nodes.length
  const edgeCount = projection.edges.length
  const visual = nodeCount <= MAX_VISUAL_NODES && edgeCount <= MAX_VISUAL_EDGES
  return {
    visual,
    blocking: false,
    nodeCount,
    edgeCount,
    ...(!visual
      ? {
          advisory: `This workflow is preserved and remains editable in YAML-only mode because the visual canvas supports at most ${MAX_VISUAL_NODES} nodes and ${MAX_VISUAL_EDGES} edges.`,
        }
      : {}),
  }
}

export function projectCanvas(
  projection: WorkflowProjection,
  savedLayout: LayoutRecordV1,
  options: ProjectCanvasOptions = {},
): CanvasProjection {
  const stale = options.stale === true
  const readOnly = stale || options.readOnly === true
  const positions = resolvePositions(projection, savedLayout, options)
  const issues = options.issues ?? []
  const issuesByNode = new Map<string, ValidationIssue[]>()
  for (const issue of issues) {
    if (!issue.nodeId) continue
    const nodeIssues = issuesByNode.get(issue.nodeId) ?? []
    nodeIssues.push(issue)
    issuesByNode.set(issue.nodeId, nodeIssues)
  }

  const nodes: CanvasNode[] = projection.nodes.map((node) => {
    const nodeIssues = issuesByNode.get(node.id) ?? []
    const errorCount = nodeIssues.filter((issue) => issue.severity === 'error').length
    const requiredIssueCount = nodeIssues.filter(
      (issue) => issue.code.toLowerCase().includes('required') || issue.message.toLowerCase().includes('required'),
    ).length
    return {
      id: node.id,
      type: 'workflow',
      position: clonePosition(positions[node.id] ?? { x: 0, y: 0 }),
      initialWidth: CANVAS_NODE_WIDTH,
      initialHeight: CANVAS_NODE_HEIGHT,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: !readOnly,
      connectable: !readOnly,
      selectable: true,
      focusable: true,
      ariaLabel: `${node.kind || 'workflow'} node ${node.id}${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
      data: {
        id: node.id,
        kind: node.kind,
        summary: boundedSummary(node.value),
        errorCount,
        requiredIssueCount,
        stale,
        readOnly,
      },
    }
  })
  const edges: CanvasEdge[] = projection.edges.map((edge) => ({
    id: edge.id,
    type: 'workflow',
    source: edge.source,
    target: edge.target,
    selectable: true,
    focusable: true,
    interactionWidth: 32,
    markerEnd: { type: MarkerType.ArrowClosed },
    ariaLabel: `Dependency from ${edge.source} to ${edge.target}`,
    data: { stale, readOnly },
  }))

  return { nodes, edges, positions, stale, readOnly }
}

function sameProjectOptions(left: ProjectCanvasOptions, right: ProjectCanvasOptions | undefined): boolean {
  return Boolean(
    right &&
    left.stale === right.stale &&
    left.readOnly === right.readOnly &&
    left.arrange === right.arrange &&
    left.issues === right.issues &&
    left.layoutGraph === right.layoutGraph,
  )
}

export function isWorkflowProjection(value: unknown): value is WorkflowProjection {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false
  return value.nodes.every(
    (node) =>
      isRecord(node) &&
      typeof node.id === 'string' &&
      typeof node.kind === 'string' &&
      Array.isArray(node.dependsOn) &&
      node.dependsOn.every((dependency) => typeof dependency === 'string'),
  )
}

function resolvePositions(
  projection: WorkflowProjection,
  savedLayout: LayoutRecordV1,
  options: ProjectCanvasOptions,
): Readonly<Record<string, CanvasPosition>> {
  if (options.arrange) return (options.layoutGraph ?? layoutGraph)(projection.nodes, projection.edges)
  const reconciled = reconcileLayout(projection, savedLayout)
  return Object.fromEntries(
    Object.entries(reconciled.nodePositions).map(([id, position]) => [id, clonePosition(position)]),
  )
}

function boundedSummary(value: unknown): string {
  let summary: string
  if (typeof value === 'string') summary = value
  else if (value === undefined) summary = ''
  else {
    try {
      summary = JSON.stringify(value) ?? String(value)
    } catch {
      summary = String(value)
    }
  }
  const singleLine = summary.replaceAll(/\s+/g, ' ').trim()
  if (singleLine.length <= SUMMARY_LIMIT) return singleLine
  return `${singleLine.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`
}

function clonePosition(position: CanvasPosition): CanvasPosition {
  return { x: position.x, y: position.y }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
