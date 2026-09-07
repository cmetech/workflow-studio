import type { ScopeLayoutV1 } from './types'

export const ROUTING_ENGINE = 'elk-layered-orthogonal-v1' as const
export const MAX_ROUTE_POINTS_PER_EDGE = 64
export const MAX_TOTAL_ROUTE_POINTS = 32_000
export const MAX_SERIALIZED_ROUTING_BYTES = 4_194_304
const MAX_ROUTING_ROUTES = 500
const MAX_LAYOUT_COORDINATE = 1_000_000

export interface EdgeRoutePointV1 {
  readonly x: number
  readonly y: number
}

export interface EdgeRouteV1 {
  readonly edgeId: string
  readonly points: readonly EdgeRoutePointV1[]
}

export interface ScopeRoutingV1 {
  readonly schemaVersion: 1
  readonly engine: typeof ROUTING_ENGINE
  readonly fingerprint: `sha256:${string}`
  readonly routes: Readonly<Record<string, EdgeRouteV1>>
}

export interface RoutingFingerprintNode {
  readonly id: string
  readonly order: number
  readonly width: number
  readonly height: number
}

export interface RoutingFingerprintEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly order: number
}

export function sanitizeScopeRouting(value: unknown): ScopeRoutingV1 | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.engine !== ROUTING_ENGINE ||
    typeof value.fingerprint !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.fingerprint) ||
    !isRecord(value.routes)
  ) {
    return undefined
  }

  const routeKeys: string[] = []
  for (const key in value.routes) {
    if (!Object.hasOwn(value.routes, key)) continue
    routeKeys.push(key)
    if (routeKeys.length > MAX_ROUTING_ROUTES) return undefined
  }

  const entries: [string, EdgeRouteV1][] = []
  const edgeIds = new Set<string>()
  let totalPoints = 0
  let totalStringCodeUnits = value.engine.length + value.fingerprint.length
  for (const key of routeKeys) {
    const route = value.routes[key]
    if (
      key.length === 0 ||
      key.length > MAX_SERIALIZED_ROUTING_BYTES ||
      !isRecord(route) ||
      typeof route.edgeId !== 'string' ||
      route.edgeId.length === 0 ||
      route.edgeId.length > MAX_SERIALIZED_ROUTING_BYTES ||
      route.edgeId !== key ||
      edgeIds.has(route.edgeId) ||
      !Array.isArray(route.points) ||
      route.points.length < 2 ||
      route.points.length > MAX_ROUTE_POINTS_PER_EDGE
    ) {
      return undefined
    }
    totalStringCodeUnits += key.length + route.edgeId.length
    if (totalStringCodeUnits > MAX_SERIALIZED_ROUTING_BYTES) return undefined
    totalPoints += route.points.length
    if (totalPoints > MAX_TOTAL_ROUTE_POINTS) return undefined

    const points: EdgeRoutePointV1[] = []
    for (const point of route.points) {
      if (!isRecord(point) || !boundedCoordinate(point.x) || !boundedCoordinate(point.y)) return undefined
      points.push({ x: point.x, y: point.y })
    }
    edgeIds.add(route.edgeId)
    entries.push([key, { edgeId: route.edgeId, points }])
  }

  const routing: ScopeRoutingV1 = {
    schemaVersion: 1,
    engine: ROUTING_ENGINE,
    fingerprint: value.fingerprint as ScopeRoutingV1['fingerprint'],
    routes: Object.fromEntries(entries),
  }
  if (canonicalJsonByteLengthExceeds(routing, MAX_SERIALIZED_ROUTING_BYTES)) return undefined
  return routing
}

export function withoutRouting(scope: ScopeLayoutV1): ScopeLayoutV1 {
  if (scope.routing === undefined) return scope
  const clone = { ...scope }
  Reflect.deleteProperty(clone, 'routing')
  return clone
}

function boundedCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_LAYOUT_COORDINATE
}

function canonicalJsonByteLengthExceeds(value: unknown, limit: number): boolean {
  let byteLength = 0

  const add = (amount: number): boolean => {
    byteLength += amount
    return byteLength > limit
  }

  const addString = (text: string): boolean => {
    if (add(2)) return true
    for (let index = 0; index < text.length; index += 1) {
      const codeUnit = text.charCodeAt(index)
      if (codeUnit === 0x22 || codeUnit === 0x5c) {
        if (add(2)) return true
      } else if (codeUnit <= 0x1f) {
        const shortEscape =
          codeUnit === 0x08 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0c || codeUnit === 0x0d
        if (add(shortEscape ? 2 : 6)) return true
      } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = text.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          index += 1
          if (add(4)) return true
        } else if (add(6)) return true
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        if (add(6)) return true
      } else if (codeUnit <= 0x7f) {
        if (add(1)) return true
      } else if (codeUnit <= 0x7ff) {
        if (add(2)) return true
      } else if (add(3)) return true
    }
    return false
  }

  const visit = (current: unknown): boolean => {
    if (current === null) return add(4)
    if (typeof current === 'string') return addString(current)
    if (typeof current === 'boolean') return add(current ? 4 : 5)
    if (typeof current === 'number') return add(JSON.stringify(current).length)
    if (Array.isArray(current)) {
      if (add(1)) return true
      for (let index = 0; index < current.length; index += 1) {
        if ((index > 0 && add(1)) || visit(current[index])) return true
      }
      return add(1)
    }
    if (isRecord(current)) {
      if (add(1)) return true
      const keys = Object.keys(current)
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!
        if ((index > 0 && add(1)) || addString(key) || add(1) || visit(current[key])) return true
      }
      return add(1)
    }
    return true
  }

  return visit(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
