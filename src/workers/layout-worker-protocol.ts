import type { GraphScopeKey } from '$src/lib/projection/types'
import type { EdgeRouteV1, RoutingFingerprintEdge, RoutingFingerprintNode } from '$src/lib/layout/routing'

export interface LayoutRequestIdentity {
  readonly requestId: string
  readonly workflowIdentity: string
  readonly pairGeneration: number
  readonly scopeKey: GraphScopeKey
  readonly graphFingerprint: `sha256:${string}`
  readonly layoutRevision: number
}

export interface LayoutWorkerNode extends RoutingFingerprintNode {
  readonly id: RoutingFingerprintNode['id']
  readonly order: RoutingFingerprintNode['order']
  readonly width: RoutingFingerprintNode['width']
  readonly height: RoutingFingerprintNode['height']
}

export interface LayoutWorkerEdge extends RoutingFingerprintEdge {
  readonly id: RoutingFingerprintEdge['id']
  readonly source: RoutingFingerprintEdge['source']
  readonly target: RoutingFingerprintEdge['target']
  readonly order: RoutingFingerprintEdge['order']
}

export interface LayoutWorkerRequest {
  readonly type: 'layout'
  readonly identity: LayoutRequestIdentity
  readonly nodes: readonly LayoutWorkerNode[]
  readonly edges: readonly LayoutWorkerEdge[]
}

export interface LayoutWorkerPosition {
  readonly x: number
  readonly y: number
}

export interface LayoutWorkerBounds extends LayoutWorkerPosition {
  readonly width: number
  readonly height: number
}

export type LayoutSpacingProfile = 'default' | 'expanded'

export interface LayoutWorkerSuccess {
  readonly type: 'layout-result'
  readonly identity: LayoutRequestIdentity
  readonly spacingProfile: LayoutSpacingProfile
  readonly positions: Readonly<Record<string, LayoutWorkerPosition>>
  readonly routes: Readonly<Record<string, EdgeRouteV1>>
  readonly bounds: LayoutWorkerBounds
  readonly durationMs: number
}

export type LayoutWorkerFailureCode =
  | 'invalid_request'
  | 'layout_failed'
  | 'invalid_result'
  | 'worker_runtime_error'
  | 'worker_message_error'
  | 'worker_timeout'

export interface LayoutWorkerFailure {
  readonly type: 'layout-error'
  readonly identity: LayoutRequestIdentity
  readonly code: LayoutWorkerFailureCode
  readonly message: string
}

/** No caller identity can be trusted for an unidentifiable malformed envelope. */
export interface UnidentifiedLayoutWorkerFailure {
  readonly type: 'layout-error'
  readonly identity: null
  readonly code: 'invalid_request'
  readonly message: string
}

export type LayoutWorkerResult = LayoutWorkerSuccess | LayoutWorkerFailure | UnidentifiedLayoutWorkerFailure
export type LayoutWorkerResponse = LayoutWorkerResult

/** Copies only bounded protocol fields, never undeclared application state. */
export function sanitizeLayoutRequestIdentity(value: unknown): LayoutRequestIdentity | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const identity = value as Record<string, unknown>
  const { requestId, workflowIdentity, pairGeneration, scopeKey, graphFingerprint, layoutRevision } = identity
  if (
    !boundedIdentityString(requestId) ||
    !boundedIdentityString(workflowIdentity) ||
    !nonnegativeInteger(pairGeneration) ||
    !boundedIdentityString(scopeKey) ||
    (scopeKey !== 'root' && (!scopeKey.startsWith('loop-group:') || scopeKey.length === 11)) ||
    typeof graphFingerprint !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(graphFingerprint) ||
    !nonnegativeInteger(layoutRevision)
  )
    return null
  return {
    requestId,
    workflowIdentity,
    pairGeneration,
    scopeKey: scopeKey as GraphScopeKey,
    graphFingerprint: graphFingerprint as LayoutRequestIdentity['graphFingerprint'],
    layoutRevision,
  }
}

function boundedIdentityString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
