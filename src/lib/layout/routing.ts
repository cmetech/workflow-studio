export const ROUTING_ENGINE = 'elk-layered-orthogonal-v1' as const
export const MAX_ROUTE_POINTS_PER_EDGE = 64
export const MAX_TOTAL_ROUTE_POINTS = 32_000
export const MAX_SERIALIZED_ROUTING_BYTES = 4_194_304

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
