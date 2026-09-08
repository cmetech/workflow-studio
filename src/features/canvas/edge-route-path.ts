import { MAX_ROUTE_POINTS_PER_EDGE, ROUTING_GEOMETRY_TOLERANCE, type EdgeRoutePointV1 } from '$src/lib/layout/routing'

const MAX_ROUTE_COORDINATE = 1_000_000

export function roundedOrthogonalPath(points: readonly EdgeRoutePointV1[], radius = 8): string {
  if (points.length < 2 || points.length > MAX_ROUTE_POINTS_PER_EDGE) return ''

  const route: EdgeRoutePointV1[] = []
  for (const point of points) {
    if (!boundedCoordinate(point.x) || !boundedCoordinate(point.y)) return ''
    const previous = route.at(-1)
    if (previous?.x === point.x && previous.y === point.y) continue
    route.push({ x: normalizeZero(point.x), y: normalizeZero(point.y) })
  }
  if (route.length < 2) return ''
  for (let index = 1; index < route.length; index += 1) {
    if (!orthogonal(route[index - 1]!, route[index]!)) return ''
  }

  const safeRadius = Number.isFinite(radius) ? Math.min(Math.max(radius, 0), MAX_ROUTE_COORDINATE) : 0
  const commands = [`M ${coordinate(route[0]!.x)} ${coordinate(route[0]!.y)}`]
  let current = route[0]!
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1]!
    const corner = route[index]!
    const next = route[index + 1]!
    const incoming = distance(previous, corner)
    const outgoing = distance(corner, next)
    const cornerRadius = Math.min(safeRadius, incoming / 2, outgoing / 2)
    if (cornerRadius === 0 || collinear(previous, corner, next)) {
      current = appendLine(commands, current, corner)
      continue
    }
    const before = toward(corner, previous, cornerRadius, incoming)
    const after = toward(corner, next, cornerRadius, outgoing)
    current = appendLine(commands, current, before)
    commands.push(`Q ${coordinate(corner.x)} ${coordinate(corner.y)} ${coordinate(after.x)} ${coordinate(after.y)}`)
    current = after
  }
  appendLine(commands, current, route.at(-1)!)
  return commands.join(' ')
}

function appendLine(commands: string[], current: EdgeRoutePointV1, point: EdgeRoutePointV1): EdgeRoutePointV1 {
  if (current.x !== point.x || current.y !== point.y) {
    commands.push(`L ${coordinate(point.x)} ${coordinate(point.y)}`)
  }
  return point
}

function toward(from: EdgeRoutePointV1, to: EdgeRoutePointV1, amount: number, total: number): EdgeRoutePointV1 {
  const ratio = amount / total
  return {
    x: normalizeZero(from.x + (to.x - from.x) * ratio),
    y: normalizeZero(from.y + (to.y - from.y) * ratio),
  }
}

function distance(left: EdgeRoutePointV1, right: EdgeRoutePointV1): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

function orthogonal(left: EdgeRoutePointV1, right: EdgeRoutePointV1): boolean {
  // Keep the validated coordinates, including exact endpoints. ELK lane values
  // can differ by floating-point roundoff; those routes must not become fallback.
  return nearlyEqual(left.x, right.x) || nearlyEqual(left.y, right.y)
}

function collinear(previous: EdgeRoutePointV1, current: EdgeRoutePointV1, next: EdgeRoutePointV1): boolean {
  return (
    (nearlyEqual(previous.x, current.x) && nearlyEqual(current.x, next.x)) ||
    (nearlyEqual(previous.y, current.y) && nearlyEqual(current.y, next.y))
  )
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= ROUTING_GEOMETRY_TOLERANCE
}

function boundedCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_ROUTE_COORDINATE
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function coordinate(value: number): string {
  return String(normalizeZero(value))
}
