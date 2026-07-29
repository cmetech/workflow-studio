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
    const result = projectCanvas(projection, savedLayout, options)
    previousProjection = projection
    previousLayout = savedLayout
    previousOptions = options
    previousResult = result
    return result
  }
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
