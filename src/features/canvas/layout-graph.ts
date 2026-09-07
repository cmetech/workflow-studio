// This adapter imports only ELK types. The engine itself belongs to layout-worker.ts.
import type { ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api'
import { VISUAL_NODE_CAPACITY, VISUAL_EDGE_CAPACITY } from '$src/lib/projection/types'
import {
  ROUTING_ENGINE,
  MAX_ROUTE_POINTS_PER_EDGE,
  MAX_TOTAL_ROUTE_POINTS,
  type EdgeRoutePointV1,
  type EdgeRouteV1,
} from '$src/lib/layout/routing'
import {
  sanitizeLayoutRequestIdentity,
  type LayoutWorkerRequest,
  type LayoutWorkerResult,
  type LayoutWorkerFailure,
  type UnidentifiedLayoutWorkerFailure,
} from '$src/workers/layout-worker-protocol'
import {
  validateRoutedLayout,
  MAX_ROUTING_COORDINATE,
  ROUTING_GEOMETRY_TOLERANCE,
  type RoutedLayoutValidation,
} from './routed-layout'

import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT, type CanvasPosition } from './types'
export { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './types'

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface ElkLike {
  layout(graph: ElkNode): Promise<unknown>
}

/** Both internal profiles belong to the same persisted engine identity. */
export const ROUTING_ENGINE_OPTIONS: Readonly<Record<typeof ROUTING_ENGINE, Readonly<LayoutOptions>>> = {
  [ROUTING_ENGINE]: Object.freeze({
    'org.eclipse.elk.algorithm': 'org.eclipse.elk.layered',
    'org.eclipse.elk.direction': 'RIGHT',
    'org.eclipse.elk.edgeRouting': 'ORTHOGONAL',
    'org.eclipse.elk.randomSeed': '1',
    'org.eclipse.elk.padding': '[top=32,left=32,bottom=32,right=32]',
    'org.eclipse.elk.spacing.nodeNode': '64',
    'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '136',
    'org.eclipse.elk.spacing.edgeNode': '24',
    'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'org.eclipse.elk.spacing.edgeEdge': '14',
    'org.eclipse.elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'org.eclipse.elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  }),
}
const EXPANDED_SPACING: Readonly<LayoutOptions> = Object.freeze({
  'org.eclipse.elk.spacing.nodeNode': '96',
  'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '200',
  'org.eclipse.elk.spacing.edgeNode': '36',
  'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers': '36',
  'org.eclipse.elk.spacing.edgeEdge': '21',
  'org.eclipse.elk.layered.spacing.edgeEdgeBetweenLayers': '21',
})

export function buildElkGraph(request: unknown): ElkNode | null {
  if (!validRequest(request)) return null
  const nodes = [...request.nodes].sort(compareOrder)
  const edges = [...request.edges].sort(compareOrder)
  const occupied = new Set([...nodes.map(({ id }) => id), ...edges.map(({ id }) => id)])
  const allocateId = (preferred: string): string => {
    let candidate = preferred
    while (occupied.has(candidate)) candidate += '_'
    occupied.add(candidate)
    return candidate
  }
  const rootId = allocateId('root')
  const ports = new Map(nodes.map(({ id }) => [id, [] as ElkPort[]]))
  const elkEdges = edges.map((edge, index) => {
    const source = allocateId(`port:${index}:source`)
    const target = allocateId(`port:${index}:target`)
    ports
      .get(edge.source)!
      .push({ id: source, width: 0, height: 0, layoutOptions: { 'org.eclipse.elk.port.side': 'EAST' } })
    ports
      .get(edge.target)!
      .push({ id: target, width: 0, height: 0, layoutOptions: { 'org.eclipse.elk.port.side': 'WEST' } })
    return { id: edge.id, sources: [source], targets: [target] }
  })
  return {
    id: rootId,
    layoutOptions: { ...ROUTING_ENGINE_OPTIONS[ROUTING_ENGINE] },
    children: nodes.map(({ id, width, height }) => ({
      id,
      width,
      height,
      ports: ports.get(id)!,
      layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_ORDER' },
    })),
    edges: elkEdges,
  }
}

type ElkResultValidation = RoutedLayoutValidation | { readonly ok: false; readonly code: 'invalid_result' }

/** Raw sections are bounded and concatenated here; no ELK-owned objects escape. */
export function readElkResult(request: LayoutWorkerRequest, result: unknown): ElkResultValidation {
  const invalid = { ok: false, code: 'invalid_result' } as const
  const expectedGraph = buildElkGraph(request)
  if (
    !expectedGraph ||
    !isRecord(result) ||
    result.id !== expectedGraph.id ||
    !Array.isArray(result.children) ||
    !Array.isArray(result.edges) ||
    result.children.length !== request.nodes.length ||
    result.edges.length !== request.edges.length
  )
    return invalid
  const expectedNodes = new Map(request.nodes.map((node) => [node.id, node]))
  const positions = new Map<string, CanvasPosition>()
  for (const child of result.children) {
    if (!isRecord(child) || typeof child.id !== 'string' || positions.has(child.id)) return invalid
    const expected = expectedNodes.get(child.id)
    if (
      !expected ||
      child.width !== expected.width ||
      child.height !== expected.height ||
      !finitePoint(child) ||
      (child.children !== undefined && (!Array.isArray(child.children) || child.children.length !== 0))
    )
      return invalid
    positions.set(child.id, { x: child.x, y: child.y })
  }
  const expectedEdges = new Map(request.edges.map((edge) => [edge.id, edge]))
  const elkEdges = new Map(expectedGraph.edges!.map((edge) => [edge.id, edge]))
  const routes = new Map<string, EdgeRouteV1>()
  let rawPoints = 0
  for (const edge of result.edges) {
    if (!isRecord(edge) || typeof edge.id !== 'string' || routes.has(edge.id)) return invalid
    const expected = expectedEdges.get(edge.id)
    if (
      !expected ||
      !Array.isArray(edge.sections) ||
      edge.sections.length === 0 ||
      edge.sections.length > MAX_ROUTE_POINTS_PER_EDGE
    )
      return invalid
    const elkEdge = elkEdges.get(edge.id)!
    const sourceIds = [expected.source, elkEdge.sources[0]!]
    const targetIds = [expected.target, elkEdge.targets[0]!]
    if (!optionalEndpoint(edge.sources, sourceIds) || !optionalEndpoint(edge.targets, targetIds)) return invalid
    const sections: { id: string; points: EdgeRoutePointV1[]; incoming: string[]; outgoing: string[] }[] = []
    const sectionIds = new Set<string>()
    for (const section of edge.sections) {
      if (
        !isRecord(section) ||
        !validId(section.id) ||
        sectionIds.has(section.id) ||
        !finitePoint(section.startPoint) ||
        !finitePoint(section.endPoint) ||
        (section.incomingShape !== undefined && !sourceIds.includes(section.incomingShape as string)) ||
        (section.outgoingShape !== undefined && !targetIds.includes(section.outgoingShape as string))
      )
        return invalid
      const bends = section.bendPoints === undefined ? [] : section.bendPoints
      if (!Array.isArray(bends)) return invalid
      rawPoints += bends.length + 2
      if (rawPoints > MAX_TOTAL_ROUTE_POINTS) return invalid
      if (!bends.every(finitePoint)) return invalid
      const incoming = section.incomingSections === undefined ? [] : section.incomingSections
      const outgoing = section.outgoingSections === undefined ? [] : section.outgoingSections
      if (
        !Array.isArray(incoming) ||
        !Array.isArray(outgoing) ||
        incoming.length > 1 ||
        outgoing.length > 1 ||
        !incoming.every(validId) ||
        !outgoing.every(validId)
      )
        return invalid
      sectionIds.add(section.id)
      sections.push({
        id: section.id,
        points: [section.startPoint, ...bends, section.endPoint].map(({ x, y }) => ({ x, y })),
        incoming,
        outgoing,
      })
    }
    if (sections.some((section) => [...section.incoming, ...section.outgoing].some((id) => !sectionIds.has(id))))
      return invalid
    const source = positions.get(expected.source)!
    const sourceNode = expectedNodes.get(expected.source)!
    const starts = sections.filter(
      (section) =>
        section.incoming.length === 0 &&
        nearlyEqual(section.points[0]!.x, source.x + sourceNode.width) &&
        section.points[0]!.y >= source.y - ROUTING_GEOMETRY_TOLERANCE &&
        section.points[0]!.y <= source.y + sourceNode.height + ROUTING_GEOMETRY_TOLERANCE,
    )
    if (starts.length !== 1) return invalid
    let current = starts[0]!
    const visited = new Set<string>()
    const points: EdgeRoutePointV1[] = []
    while (true) {
      visited.add(current.id)
      points.push(...current.points.slice(points.length ? 1 : 0))
      const last = current.points.at(-1)!
      const next = sections.filter((section) => !visited.has(section.id) && samePoint(last, section.points[0]!))
      if (next.length === 0) {
        if (current.outgoing.length !== 0) return invalid
        break
      }
      if (next.length !== 1) return invalid
      const successor = next[0]!
      if (
        (current.outgoing.length && current.outgoing[0] !== successor.id) ||
        (successor.incoming.length && successor.incoming[0] !== current.id)
      )
        return invalid
      current = successor
    }
    if (visited.size !== sections.length) return invalid
    routes.set(edge.id, { edgeId: edge.id, points })
  }
  return validateRoutedLayout({
    nodes: request.nodes,
    edges: request.edges,
    positions: Object.fromEntries(positions),
    routes: Object.fromEntries(routes),
  })
}

export async function arrangeWithElk(request: unknown, elk: ElkLike): Promise<LayoutWorkerResult> {
  const started = performance.now()
  if (!validRequest(request)) return layoutFailure(request, 'invalid_request')
  const identity = sanitizeLayoutRequestIdentity(request.identity)!
  const graph = buildElkGraph(request)
  if (!graph) return layoutFailure(request, 'invalid_request')
  // ELK orders ports clockwise. A static dependency order on both sides can
  // force crossings even in a diamond. Derive one deterministic geometric order,
  // then lock it for final routing and the optional spacing retry.
  let portOrder: ReadonlyMap<string, readonly string[]> | null = null
  if (
    graph.children!.some((node) =>
      ['EAST', 'WEST'].some(
        (side) => node.ports!.filter((port) => port.layoutOptions!['org.eclipse.elk.port.side'] === side).length > 1,
      ),
    )
  ) {
    const orderingGraph = buildElkGraph(request)!
    orderingGraph.layoutOptions!['org.eclipse.elk.randomSeed'] = '2'
    for (const node of orderingGraph.children!) node.layoutOptions!['org.eclipse.elk.portConstraints'] = 'FIXED_SIDE'
    let orderingResult: unknown
    try {
      orderingResult = await elk.layout(orderingGraph)
    } catch {
      return layoutFailure(request, 'layout_failed')
    }
    portOrder = readPortOrder(graph, orderingResult)
    if (!portOrder) return layoutFailure(request, 'invalid_result')
  }
  for (const spacingProfile of ['default', 'expanded'] as const) {
    const attempt = spacingProfile === 'default' ? graph : buildElkGraph(request)!
    if (portOrder) applyPortOrder(attempt, portOrder)
    if (spacingProfile === 'expanded') attempt.layoutOptions = { ...attempt.layoutOptions, ...EXPANDED_SPACING }
    let raw: unknown
    try {
      raw = await elk.layout(attempt)
    } catch {
      return layoutFailure(request, 'layout_failed')
    }
    let validated: ElkResultValidation
    try {
      validated = readElkResult(request, raw)
    } catch {
      return layoutFailure(request, 'invalid_result')
    }
    if (validated.ok) {
      const { positions, routes } = validated.layout
      return {
        type: 'layout-result',
        identity,
        spacingProfile,
        positions,
        routes,
        bounds: layoutBounds(request, positions, routes),
        durationMs: Math.max(0, performance.now() - started),
      }
    }
    if (
      spacingProfile === 'expanded' ||
      (validated.code !== 'route_intersects_node' && validated.code !== 'coincident_route_segment')
    )
      return layoutFailure(request, 'invalid_result')
  }
  return layoutFailure(request, 'invalid_result')
}

/** Only bounded port IDs/order escape the preliminary pass, never preliminary routes or positions. */
function readPortOrder(graph: ElkNode, result: unknown): ReadonlyMap<string, readonly string[]> | null {
  if (
    !isRecord(result) ||
    result.id !== graph.id ||
    !Array.isArray(result.children) ||
    result.children.length !== graph.children!.length
  )
    return null
  const expectedNodes = new Map(graph.children!.map((node) => [node.id, node]))
  const ordered = new Map<string, readonly string[]>()
  for (const child of result.children) {
    if (!isRecord(child) || typeof child.id !== 'string' || ordered.has(child.id)) return null
    const node = expectedNodes.get(child.id)
    if (
      !node ||
      child.width !== node.width ||
      child.height !== node.height ||
      !Array.isArray(child.ports) ||
      child.ports.length !== node.ports!.length
    )
      return null
    const expectedPorts = new Map(node.ports!.map((port, order) => [port.id, { port, order }]))
    const seen = new Set<string>()
    const ports: { id: string; y: number; east: boolean; order: number }[] = []
    for (const raw of child.ports) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || seen.has(raw.id) || !finitePoint(raw)) return null
      const expected = expectedPorts.get(raw.id)
      if (!expected) return null
      const east = expected.port.layoutOptions!['org.eclipse.elk.port.side'] === 'EAST'
      if (!nearlyEqual(raw.x, east ? node.width! : 0) || raw.y < 0 || raw.y > node.height!) return null
      seen.add(raw.id)
      ports.push({ id: raw.id, y: raw.y, east, order: expected.order })
    }
    ports.sort(
      (a, b) =>
        Number(b.east) - Number(a.east) ||
        (a.east ? a.y - b.y : b.y - a.y) ||
        a.order - b.order ||
        compareText(a.id, b.id),
    )
    ordered.set(
      node.id,
      ports.map(({ id }) => id),
    )
  }
  return ordered
}

function applyPortOrder(graph: ElkNode, order: ReadonlyMap<string, readonly string[]>): void {
  for (const node of graph.children!) {
    const ports = new Map(node.ports!.map((port) => [port.id, port]))
    node.ports = order.get(node.id)!.map((id) => ports.get(id)!)
  }
}

function validRequest(request: unknown): request is LayoutWorkerRequest {
  if (
    !isRecord(request) ||
    request.type !== 'layout' ||
    !sanitizeLayoutRequestIdentity(request.identity) ||
    !Array.isArray(request.nodes) ||
    !Array.isArray(request.edges) ||
    request.nodes.length > VISUAL_NODE_CAPACITY ||
    request.edges.length > VISUAL_EDGE_CAPACITY
  )
    return false
  const ids = new Set<string>()
  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const node of request.nodes) {
    if (
      !isRecord(node) ||
      !validId(node.id) ||
      ids.has(node.id) ||
      !validOrder(node.order) ||
      !validDimension(node.width, CANVAS_NODE_WIDTH) ||
      !validDimension(node.height, CANVAS_NODE_HEIGHT)
    )
      return false
    ids.add(node.id)
    outgoing.set(node.id, [])
    indegree.set(node.id, 0)
  }
  const edgeIds = new Set<string>()
  const dependencies = new Set<string>()
  for (const edge of request.edges) {
    if (
      !isRecord(edge) ||
      !validId(edge.id) ||
      edgeIds.has(edge.id) ||
      ids.has(edge.id) ||
      !validOrder(edge.order) ||
      typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' ||
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      edge.source === edge.target
    )
      return false
    const dependency = JSON.stringify([edge.source, edge.target])
    if (dependencies.has(dependency)) return false
    dependencies.add(dependency)
    edgeIds.add(edge.id)
    outgoing.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, indegree.get(edge.target)! + 1)
  }
  const ready = [...ids].filter((id) => indegree.get(id) === 0)
  for (let index = 0; index < ready.length; index++) {
    for (const target of outgoing.get(ready[index]!)!) {
      const remaining = indegree.get(target)! - 1
      indegree.set(target, remaining)
      if (remaining === 0) ready.push(target)
    }
  }
  return ready.length === ids.size
}

function layoutBounds(
  request: LayoutWorkerRequest,
  positions: Readonly<Record<string, CanvasPosition>>,
  routes: Readonly<Record<string, EdgeRouteV1>>,
) {
  if (request.nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  const include = (x: number, y: number) => {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  for (const node of request.nodes) {
    const position = positions[node.id]!
    include(position.x, position.y)
    include(position.x + node.width, position.y + node.height)
  }
  for (const route of Object.values(routes)) for (const point of route.points) include(point.x, point.y)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
function layoutFailure(
  request: unknown,
  code: 'invalid_request' | 'invalid_result' | 'layout_failed',
): LayoutWorkerFailure | UnidentifiedLayoutWorkerFailure {
  const identity = sanitizeLayoutRequestIdentity(isRecord(request) ? request.identity : null)
  const messages = {
    invalid_request: 'Graph arrangement request is invalid.',
    invalid_result: 'Graph arrangement returned unsafe geometry.',
    layout_failed: 'Graph arrangement failed.',
  }
  if (!identity)
    return { type: 'layout-error', identity: null, code: 'invalid_request', message: messages.invalid_request }
  return { type: 'layout-error', identity, code, message: messages[code] }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}
function validOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function validDimension(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= MAX_ROUTING_COORDINATE
}
function finitePoint(value: unknown): value is EdgeRoutePointV1 {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Math.abs(value.x) <= MAX_ROUTING_COORDINATE &&
    Math.abs(value.y) <= MAX_ROUTING_COORDINATE
  )
}
function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= ROUTING_GEOMETRY_TOLERANCE
}
function samePoint(left: EdgeRoutePointV1, right: EdgeRoutePointV1): boolean {
  return nearlyEqual(left.x, right.x) && nearlyEqual(left.y, right.y)
}
function compareOrder(left: { order: number; id: string }, right: { order: number; id: string }): number {
  return left.order - right.order || compareText(left.id, right.id)
}

function optionalEndpoint(value: unknown, expected: readonly string[]): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 1 && expected.includes(value[0]))
}
