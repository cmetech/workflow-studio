import { canonicalizeJsonValue, sha256Hex } from '$src/lib/contract/canonical-json'
import type { GraphScopeKey } from '$src/lib/projection/types'
import {
  MAX_ROUTE_POINTS_PER_EDGE,
  MAX_SERIALIZED_ROUTING_BYTES,
  MAX_TOTAL_ROUTE_POINTS,
  ROUTING_ENGINE,
  type EdgeRoutePointV1,
  type EdgeRouteV1,
  type RoutingFingerprintEdge,
  type RoutingFingerprintNode,
} from '$src/lib/layout/routing'
import type { CanvasPosition } from './types'

export const ROUTING_GEOMETRY_TOLERANCE = 0.5
export const ROUTING_NODE_CLEARANCE = 24
export const ROUTING_ENDPOINT_FAN_ZONE = 24
export const MAX_ROUTING_COORDINATE = 1_000_000

export interface RoutedLayoutInput {
  readonly nodes: readonly RoutingFingerprintNode[]
  readonly edges: readonly RoutingFingerprintEdge[]
  readonly positions: Readonly<Record<string, CanvasPosition>>
  readonly routes: Readonly<Record<string, EdgeRouteV1>>
}

export interface ValidatedRoutedLayout {
  readonly positions: Readonly<Record<string, CanvasPosition>>
  readonly routes: Readonly<Record<string, EdgeRouteV1>>
}

export type RoutedLayoutFailureCode =
  | 'node_membership_mismatch'
  | 'edge_membership_mismatch'
  | 'coordinate_out_of_bounds'
  | 'node_overlap'
  | 'route_point_count'
  | 'total_route_point_count'
  | 'serialized_routing_too_large'
  | 'route_not_orthogonal'
  | 'route_endpoint_mismatch'
  | 'route_intersects_node'
  | 'coincident_route_segment'

export type RoutedLayoutValidation =
  | { readonly ok: true; readonly layout: ValidatedRoutedLayout; readonly crossingCount: number }
  | { readonly ok: false; readonly code: RoutedLayoutFailureCode }

interface Rectangle {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

interface Segment {
  readonly start: EdgeRoutePointV1
  readonly end: EdgeRoutePointV1
  readonly orientation: 'horizontal' | 'vertical'
}

export function normalizeRoute(points: readonly EdgeRoutePointV1[]): readonly EdgeRoutePointV1[] | null {
  const deduplicated: EdgeRoutePointV1[] = []
  for (const point of points) {
    if (!finitePoint(point)) return null
    const copy = { x: point.x, y: point.y }
    const previous = deduplicated.at(-1)
    if (!previous || !samePoint(previous, copy)) deduplicated.push(copy)
  }

  for (let index = 1; index < deduplicated.length; index += 1) {
    if (!segmentOrientation(deduplicated[index - 1]!, deduplicated[index]!)) return null
  }

  const normalized: EdgeRoutePointV1[] = []
  for (const point of deduplicated) {
    while (
      normalized.length >= 2 &&
      removableCollinearPoint(normalized[normalized.length - 2]!, normalized[normalized.length - 1]!, point)
    ) {
      normalized.pop()
    }
    normalized.push(point)
  }
  return normalized
}

export function validateRoutedLayout(input: RoutedLayoutInput): RoutedLayoutValidation {
  const nodeIds = input.nodes.map(({ id }) => id)
  if (!exactMembership(nodeIds, Object.keys(input.positions))) return failure('node_membership_mismatch')

  const rectangles = new Map<string, Rectangle>()
  const positions: Record<string, CanvasPosition> = {}
  for (const node of input.nodes) {
    const position = input.positions[node.id]!
    if (!validDimension(node.width) || !validDimension(node.height) || !finitePoint(position)) {
      return failure('coordinate_out_of_bounds')
    }
    const rectangle = {
      left: position.x,
      top: position.y,
      right: position.x + node.width,
      bottom: position.y + node.height,
    }
    if (![rectangle.left, rectangle.top, rectangle.right, rectangle.bottom].every(boundedCoordinate)) {
      return failure('coordinate_out_of_bounds')
    }
    rectangles.set(node.id, rectangle)
    positions[node.id] = { x: position.x, y: position.y }
  }

  const rectangleValues = [...rectangles.values()]
  for (let index = 0; index < rectangleValues.length; index += 1) {
    for (let other = index + 1; other < rectangleValues.length; other += 1) {
      if (rectanglesOverlap(rectangleValues[index]!, rectangleValues[other]!)) return failure('node_overlap')
    }
  }

  const edgeIds = input.edges.map(({ id }) => id)
  if (!exactMembership(edgeIds, Object.keys(input.routes))) return failure('edge_membership_mismatch')
  const nodeIdSet = new Set(nodeIds)
  if (
    input.edges.some(
      ({ id, source, target }) =>
        !id || !nodeIdSet.has(source) || !nodeIdSet.has(target) || source === target || input.routes[id]?.edgeId !== id,
    )
  ) {
    return failure('edge_membership_mismatch')
  }

  let rawPointCount = 0
  for (const edge of input.edges) {
    const points = input.routes[edge.id]!.points
    if (!Array.isArray(points)) return failure('route_point_count')
    rawPointCount += points.length
    if (rawPointCount > MAX_TOTAL_ROUTE_POINTS) return failure('total_route_point_count')
  }

  const routes: Record<string, EdgeRouteV1> = {}
  let totalPointCount = 0
  for (const edge of input.edges) {
    const route = input.routes[edge.id]!
    for (const point of route.points) {
      if (!finitePoint(point) || !boundedCoordinate(point.x) || !boundedCoordinate(point.y)) {
        return failure('coordinate_out_of_bounds')
      }
    }
    const points = normalizeRoute(route.points)
    if (!points) return failure('route_not_orthogonal')
    if (points.length < 2 || points.length > MAX_ROUTE_POINTS_PER_EDGE) return failure('route_point_count')
    totalPointCount += points.length
    if (totalPointCount > MAX_TOTAL_ROUTE_POINTS) return failure('total_route_point_count')
    routes[edge.id] = { edgeId: edge.id, points }
  }

  const serializedBytes = new TextEncoder().encode(canonicalizeJsonValue(routes)).byteLength
  if (serializedBytes > MAX_SERIALIZED_ROUTING_BYTES) return failure('serialized_routing_too_large')

  for (const edge of input.edges) {
    const points = routes[edge.id]!.points
    const source = rectangles.get(edge.source)!
    const target = rectangles.get(edge.target)!
    if (
      !pointOnVerticalBoundary(points[0]!, source.right, source) ||
      !pointOnVerticalBoundary(points.at(-1)!, target.left, target)
    ) {
      return failure('route_endpoint_mismatch')
    }

    const unrelatedRectangles = input.nodes
      .filter(({ id }) => id !== edge.source && id !== edge.target)
      .map(({ id }) => expandedRectangle(rectangles.get(id)!, ROUTING_NODE_CLEARANCE))
    for (const segment of segments(points)) {
      if (unrelatedRectangles.some((rectangle) => segmentEntersRectangle(segment, rectangle))) {
        return failure('route_intersects_node')
      }
    }
  }

  if (hasLongCoincidentSegment(routes)) return failure('coincident_route_segment')

  return {
    ok: true,
    layout: { positions, routes },
    crossingCount: countOrthogonalCrossings(routes),
  }
}

export function countOrthogonalCrossings(routes: Readonly<Record<string, EdgeRouteV1>>): number {
  const routeValues = Object.values(routes)
  let count = 0
  for (let leftIndex = 0; leftIndex < routeValues.length; leftIndex += 1) {
    const leftSegments = segments(routeValues[leftIndex]!.points)
    for (let rightIndex = leftIndex + 1; rightIndex < routeValues.length; rightIndex += 1) {
      const rightSegments = segments(routeValues[rightIndex]!.points)
      for (const left of leftSegments) {
        for (const right of rightSegments) {
          if (segmentsCross(left, right)) count += 1
        }
      }
    }
  }
  return count
}

export async function graphFingerprint(input: {
  readonly engine: typeof ROUTING_ENGINE
  readonly scopeKey: GraphScopeKey
  readonly nodes: readonly RoutingFingerprintNode[]
  readonly edges: readonly RoutingFingerprintEdge[]
}): Promise<`sha256:${string}`> {
  const nodes = [...input.nodes]
    .sort((left, right) => left.order - right.order || compareText(left.id, right.id))
    .map(({ id, order, width, height }) => ({ id, order, width, height }))
  const edges = [...input.edges]
    .sort((left, right) => compareText(left.id, right.id))
    .map(({ id, source, target, order }) => ({ id, source, target, order }))
  const digest = await sha256Hex(
    canonicalizeJsonValue({ engine: input.engine, scopeKey: input.scopeKey, nodes, edges }),
  )
  return `sha256:${digest}`
}

export async function routingFingerprint(input: {
  readonly graphFingerprint: `sha256:${string}`
  readonly positions: Readonly<Record<string, CanvasPosition>>
}): Promise<`sha256:${string}`> {
  const positions = Object.fromEntries(Object.entries(input.positions).map(([id, { x, y }]) => [id, { x, y }]))
  const digest = await sha256Hex(canonicalizeJsonValue({ graphFingerprint: input.graphFingerprint, positions }))
  return `sha256:${digest}`
}

function failure(code: RoutedLayoutFailureCode): RoutedLayoutValidation {
  return { ok: false, code }
}

function exactMembership(expected: readonly string[], actual: readonly string[]): boolean {
  const expectedSet = new Set(expected)
  if (expectedSet.size !== expected.length || actual.length !== expected.length) return false
  return actual.every((id) => expectedSet.has(id))
}

function finitePoint(point: unknown): point is EdgeRoutePointV1 {
  if (typeof point !== 'object' || point === null) return false
  const candidate = point as Partial<EdgeRoutePointV1>
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_ROUTING_COORDINATE * 2
}

function boundedCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_ROUTING_COORDINATE
}

function samePoint(left: EdgeRoutePointV1, right: EdgeRoutePointV1): boolean {
  return nearlyEqual(left.x, right.x) && nearlyEqual(left.y, right.y)
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= ROUTING_GEOMETRY_TOLERANCE
}

function segmentOrientation(start: EdgeRoutePointV1, end: EdgeRoutePointV1): Segment['orientation'] | null {
  if (nearlyEqual(start.y, end.y)) return 'horizontal'
  if (nearlyEqual(start.x, end.x)) return 'vertical'
  return null
}

function removableCollinearPoint(start: EdgeRoutePointV1, middle: EdgeRoutePointV1, end: EdgeRoutePointV1): boolean {
  const horizontal = nearlyEqual(start.y, middle.y) && nearlyEqual(middle.y, end.y) && between(middle.x, start.x, end.x)
  const vertical = nearlyEqual(start.x, middle.x) && nearlyEqual(middle.x, end.x) && between(middle.y, start.y, end.y)
  return horizontal || vertical
}

function between(value: number, first: number, second: number): boolean {
  return (
    value >= Math.min(first, second) - ROUTING_GEOMETRY_TOLERANCE &&
    value <= Math.max(first, second) + ROUTING_GEOMETRY_TOLERANCE
  )
}

function rectanglesOverlap(left: Rectangle, right: Rectangle): boolean {
  const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left)
  const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
  return horizontalOverlap > ROUTING_GEOMETRY_TOLERANCE && verticalOverlap > ROUTING_GEOMETRY_TOLERANCE
}

function pointOnVerticalBoundary(point: EdgeRoutePointV1, x: number, rectangle: Rectangle): boolean {
  const withinY =
    point.y >= rectangle.top - ROUTING_GEOMETRY_TOLERANCE && point.y <= rectangle.bottom + ROUTING_GEOMETRY_TOLERANCE
  return withinY && nearlyEqual(point.x, x)
}

function expandedRectangle(rectangle: Rectangle, amount: number): Rectangle {
  return {
    left: rectangle.left - amount,
    top: rectangle.top - amount,
    right: rectangle.right + amount,
    bottom: rectangle.bottom + amount,
  }
}

function segments(points: readonly EdgeRoutePointV1[]): readonly Segment[] {
  const result: Segment[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!
    const end = points[index]!
    const orientation = segmentOrientation(start, end)
    if (orientation) result.push({ start, end, orientation })
  }
  return result
}

function segmentEntersRectangle(segment: Segment, rectangle: Rectangle): boolean {
  if (segment.orientation === 'horizontal') {
    const minX = Math.min(segment.start.x, segment.end.x)
    const maxX = Math.max(segment.start.x, segment.end.x)
    const minY = Math.min(segment.start.y, segment.end.y)
    const maxY = Math.max(segment.start.y, segment.end.y)
    return (
      Math.max(minX, rectangle.left + ROUTING_GEOMETRY_TOLERANCE) <
        Math.min(maxX, rectangle.right - ROUTING_GEOMETRY_TOLERANCE) &&
      maxY > rectangle.top + ROUTING_GEOMETRY_TOLERANCE &&
      minY < rectangle.bottom - ROUTING_GEOMETRY_TOLERANCE
    )
  }

  const minX = Math.min(segment.start.x, segment.end.x)
  const maxX = Math.max(segment.start.x, segment.end.x)
  const minY = Math.min(segment.start.y, segment.end.y)
  const maxY = Math.max(segment.start.y, segment.end.y)
  return (
    maxX > rectangle.left + ROUTING_GEOMETRY_TOLERANCE &&
    minX < rectangle.right - ROUTING_GEOMETRY_TOLERANCE &&
    Math.max(minY, rectangle.top + ROUTING_GEOMETRY_TOLERANCE) <
      Math.min(maxY, rectangle.bottom - ROUTING_GEOMETRY_TOLERANCE)
  )
}

function hasLongCoincidentSegment(routes: Readonly<Record<string, EdgeRouteV1>>): boolean {
  const routeValues = Object.values(routes)
  for (let leftIndex = 0; leftIndex < routeValues.length; leftIndex += 1) {
    const leftSegments = segments(routeValues[leftIndex]!.points)
    for (let rightIndex = leftIndex + 1; rightIndex < routeValues.length; rightIndex += 1) {
      const rightSegments = segments(routeValues[rightIndex]!.points)
      for (const left of leftSegments) {
        for (const right of rightSegments) {
          if (coincidentLength(left, right) > ROUTING_ENDPOINT_FAN_ZONE + ROUTING_GEOMETRY_TOLERANCE) {
            return true
          }
        }
      }
    }
  }
  return false
}

function coincidentLength(left: Segment, right: Segment): number {
  if (left.orientation !== right.orientation) return 0
  if (left.orientation === 'horizontal') {
    if (!nearlyEqual(axisCoordinate(left), axisCoordinate(right))) return 0
    return intervalOverlap(left.start.x, left.end.x, right.start.x, right.end.x)
  }
  if (!nearlyEqual(axisCoordinate(left), axisCoordinate(right))) return 0
  return intervalOverlap(left.start.y, left.end.y, right.start.y, right.end.y)
}

function intervalOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): number {
  return Math.max(
    0,
    Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd)) -
      Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd)),
  )
}

function axisCoordinate(segment: Segment): number {
  return segment.orientation === 'horizontal'
    ? (segment.start.y + segment.end.y) / 2
    : (segment.start.x + segment.end.x) / 2
}

function segmentsCross(left: Segment, right: Segment): boolean {
  if (left.orientation === right.orientation) return false
  const horizontal = left.orientation === 'horizontal' ? left : right
  const vertical = left.orientation === 'vertical' ? left : right
  const crossingX = axisCoordinate(vertical)
  const crossingY = axisCoordinate(horizontal)
  return (
    crossingX > Math.min(horizontal.start.x, horizontal.end.x) + ROUTING_GEOMETRY_TOLERANCE &&
    crossingX < Math.max(horizontal.start.x, horizontal.end.x) - ROUTING_GEOMETRY_TOLERANCE &&
    crossingY > Math.min(vertical.start.y, vertical.end.y) + ROUTING_GEOMETRY_TOLERANCE &&
    crossingY < Math.max(vertical.start.y, vertical.end.y) - ROUTING_GEOMETRY_TOLERANCE
  )
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
