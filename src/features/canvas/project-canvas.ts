import { MarkerType, Position } from '@xyflow/svelte'
import { reconcileLayout, validPosition } from '$src/lib/layout/place-new-nodes'
import type { ScopeLayoutV1 } from '$src/lib/layout/types'
import type { EdgeRouteV1, ScopeRoutingV1 } from '$src/lib/layout/routing'
import type { ValidationIssue } from '$src/lib/documents/types'
import {
  VISUAL_EDGE_CAPACITY,
  VISUAL_NODE_CAPACITY,
  type ProjectedGraph,
  type WorkflowProjection,
} from '$src/lib/projection/types'
import { CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH, layoutGraph, type LayoutGraphAdapter } from './layout-graph'
import type { CanvasEdge, CanvasNode, CanvasProjection, CanvasPosition, LoopGroupNodeSummary } from './types'
import type { ScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'

const SUMMARY_LIMIT = 72
export const MAX_VISUAL_NODES = VISUAL_NODE_CAPACITY
export const MAX_VISUAL_EDGES = VISUAL_EDGE_CAPACITY

export interface ProjectCanvasOptions {
  readonly stale?: boolean
  readonly readOnly?: boolean
  readonly arrange?: boolean
  readonly routing?: ScopeRoutingV1
  readonly issues?: readonly ValidationIssue[]
  readonly layoutGraph?: LayoutGraphAdapter
  readonly groupSummaries?: Readonly<Record<string, LoopGroupNodeSummary>>
}

export interface CanvasCapacity {
  readonly visual: boolean
  readonly blocking: false
  readonly nodeCount: number
  readonly edgeCount: number
  readonly advisory?: string
}

export type ProjectCanvasAdapter = (
  projection: ProjectedGraph,
  savedLayout: ScopeLayoutV1,
  options?: ProjectCanvasOptions,
) => CanvasProjection

export function createMemoizedCanvasProjector(): ProjectCanvasAdapter {
  let previousProjection: ProjectedGraph | undefined
  let previousLayout: ScopeLayoutV1 | undefined
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
    const result =
      previousResult && previousProjection?.scope.key === projection.scope.key
        ? reuseUnchangedCanvasElements(previousResult, projected)
        : projected
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

export function sameCanvasNode(left: CanvasNode, right: CanvasNode): boolean {
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
    left.data.readOnly === right.data.readOnly &&
    left.data.accessibleLabel === right.data.accessibleLabel &&
    sameLoopGroupSummary(left.data.compound, right.data.compound)
  )
}

function sameLoopGroupSummary(
  left: LoopGroupNodeSummary | undefined,
  right: LoopGroupNodeSummary | undefined,
): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.bodyNodeCount === right.bodyNodeCount &&
      left.maxIterations === right.maxIterations &&
      left.primarySinkId === right.primarySinkId &&
      left.errorCount === right.errorCount &&
      left.requiredIssueCount === right.requiredIssueCount,
    )
  )
}

export function sameCanvasEdge(left: CanvasEdge, right: CanvasEdge): boolean {
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
    left.data?.readOnly === right.data?.readOnly &&
    left.data?.emphasized === right.data?.emphasized &&
    sameEdgeRoute(left.data?.route, right.data?.route)
  )
}

function sameEdgeRoute(left: EdgeRouteV1 | undefined, right: EdgeRouteV1 | undefined): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.edgeId === right.edgeId &&
      left.points.length === right.points.length &&
      left.points.every((point, index) => point.x === right.points[index]?.x && point.y === right.points[index]?.y),
    )
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

export function canvasCapacityForProjection(projection: ProjectedGraph): CanvasCapacity {
  const nodeCount = projection.capacity.nodeCount
  const edgeCount = projection.capacity.edgeCount
  const visual =
    projection.capacity.status === 'visual' && nodeCount <= MAX_VISUAL_NODES && edgeCount <= MAX_VISUAL_EDGES
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

export function loopGroupSummariesForProjection(
  projection: WorkflowProjection,
  issues: readonly ValidationIssue[],
  capabilities?: ScopedDagCapabilities,
): Readonly<Record<string, LoopGroupNodeSummary>> {
  const root = projection.graphs.find(({ scope }) => scope.key === 'root')
  if (!root) return {}
  const summaries: Record<string, LoopGroupNodeSummary> = {}
  for (const node of root.nodes) {
    if (node.kind !== 'loop_group') continue
    const scopeKey = `loop-group:${node.id}` as const
    const body = projection.graphs.find(({ scope }) => scope.key === scopeKey)
    const groupIssues = issues.filter(
      (issue) =>
        issue.groupId === node.id ||
        issue.scopeKey === scopeKey ||
        ((issue.scopeKey === undefined || issue.scopeKey === 'root') && issue.nodeId === node.id),
    )
    const value = isRecord(node.value) ? node.value : {}
    const maxIterations = value.max_iterations
    summaries[node.id] = {
      bodyNodeCount: body?.nodes.length ?? 0,
      ...(typeof maxIterations === 'number' && Number.isFinite(maxIterations) ? { maxIterations } : {}),
      ...(body?.primarySinkId ? { primarySinkId: body.primarySinkId } : {}),
      errorCount: groupIssues.filter(({ severity }) => severity === 'error').length,
      requiredIssueCount: requiredGroupFieldCount(value, capabilities),
    }
  }
  return summaries
}

export function projectCanvas(
  projection: ProjectedGraph,
  savedLayout: ScopeLayoutV1,
  options: ProjectCanvasOptions = {},
): CanvasProjection {
  const stale = options.stale === true
  const readOnly = stale || options.readOnly === true
  const positions = resolvePositions(projection, savedLayout, options)
  const issues = options.issues ?? []
  const issuesByNode = new Map<string, ValidationIssue[]>()
  for (const issue of issues) {
    if (!issue.nodeId) continue
    const issueScope = issue.scopeKey ?? 'root'
    if (issueScope !== projection.scope.key) continue
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
    const compound = node.kind === 'loop_group' ? options.groupSummaries?.[node.id] : undefined
    const renderedErrorCount = compound?.errorCount ?? errorCount
    const renderedRequiredIssueCount = compound?.requiredIssueCount ?? requiredIssueCount
    const accessibleLabel = compound
      ? `loop group ${node.id}`
      : `${node.kind || 'workflow'} node ${node.id}${projection.scope.groupId ? ` in loop group ${projection.scope.groupId}` : ''}`
    const canvasAriaLabel = compound
      ? loopGroupAccessibleLabel(node.id, compound)
      : `${accessibleLabel}${renderedErrorCount > 0 ? `, ${renderedErrorCount} errors` : ''}`
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
      ariaLabel: canvasAriaLabel,
      data: {
        id: node.id,
        kind: node.kind,
        summary: compound ? '' : boundedSummary(node.value),
        errorCount: renderedErrorCount,
        requiredIssueCount: renderedRequiredIssueCount,
        stale,
        readOnly,
        accessibleLabel,
        ...(compound ? { compound } : {}),
      },
    }
  })
  const routes = completeRoutesForEdges(projection.edges, options.routing)
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
    data: {
      stale,
      readOnly,
      ...(routes ? { route: cloneRoute(routes[edge.id]!) } : {}),
    },
  }))

  return { nodes, edges, positions, capacity: projection.capacity, stale, readOnly }
}

function sameProjectOptions(left: ProjectCanvasOptions, right: ProjectCanvasOptions | undefined): boolean {
  return Boolean(
    right &&
    left.stale === right.stale &&
    left.readOnly === right.readOnly &&
    left.arrange === right.arrange &&
    left.routing === right.routing &&
    left.issues === right.issues &&
    left.layoutGraph === right.layoutGraph &&
    left.groupSummaries === right.groupSummaries,
  )
}

function completeRoutesForEdges(
  edges: ProjectedGraph['edges'],
  routing: ScopeRoutingV1 | undefined,
): ScopeRoutingV1['routes'] | undefined {
  if (!routing) return undefined
  const routeIds = Object.keys(routing.routes)
  if (routeIds.length !== edges.length) return undefined
  for (const edge of edges) {
    if (!Object.hasOwn(routing.routes, edge.id) || routing.routes[edge.id]?.edgeId !== edge.id) return undefined
  }
  return routing.routes
}

function cloneRoute(route: EdgeRouteV1): EdgeRouteV1 {
  return {
    edgeId: route.edgeId,
    points: route.points.map(({ x, y }) => ({ x, y })),
  }
}

function loopGroupAccessibleLabel(id: string, summary: LoopGroupNodeSummary): string {
  const parts = [`loop group ${id}`, `${summary.bodyNodeCount} body node${summary.bodyNodeCount === 1 ? '' : 's'}`]
  if (summary.maxIterations !== undefined) parts.push(`maximum ${summary.maxIterations} iterations`)
  if (summary.primarySinkId) parts.push(`primary output ${summary.primarySinkId}`)
  if (summary.errorCount > 0) parts.push(`${summary.errorCount} error${summary.errorCount === 1 ? '' : 's'}`)
  if (summary.requiredIssueCount > 0)
    parts.push(`${summary.requiredIssueCount} required issue${summary.requiredIssueCount === 1 ? '' : 's'}`)
  return parts.join(', ')
}

function requiredGroupFieldCount(
  payload: Readonly<Record<string, unknown>>,
  capabilities?: ScopedDagCapabilities,
): number {
  if (!capabilities) return 0
  const bodyField = capabilities.bodyPath.at(-1)
  return capabilities.topology.required_group_fields.filter((field) => {
    if (!Object.hasOwn(payload, field)) return true
    const value = payload[field]
    return field === bodyField && (!Array.isArray(value) || value.length < capabilities.topology.min_nodes)
  }).length
}

export function isProjectedGraph(value: unknown): value is ProjectedGraph {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !isRecord(value.scope))
    return false
  return (
    value.scope.key !== undefined &&
    value.nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.id === 'string' &&
        typeof node.kind === 'string' &&
        Array.isArray(node.dependsOn) &&
        node.dependsOn.every((dependency) => typeof dependency === 'string'),
    )
  )
}

export function isWorkflowProjection(value: unknown): value is WorkflowProjection {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.profile === 'string' &&
    Array.isArray(value.graphs)
  )
}

function resolvePositions(
  projection: ProjectedGraph,
  savedLayout: ScopeLayoutV1,
  options: ProjectCanvasOptions,
): Readonly<Record<string, CanvasPosition>> {
  if (options.arrange) return (options.layoutGraph ?? layoutGraph)(projection.nodes, projection.edges)
  // Accepted analysis preplaces every scope. Rendering a scope needs no placement work.
  const positions = projection.nodes.every(
    ({ id }) => Object.hasOwn(savedLayout.nodePositions, id) && validPosition(savedLayout.nodePositions[id]),
  )
    ? savedLayout.nodePositions
    : reconcileLayout(projection, savedLayout).nodePositions
  return Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, clonePosition(position)]))
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
