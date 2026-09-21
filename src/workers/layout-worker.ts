/// <reference lib="webworker" />

import ELK from 'elkjs/lib/elk-api.js'
import { createLocalElkEndpoint } from './elk-engine-worker'
import { arrangeWithElk, validLayoutWorkerRequest, type ElkLike } from '$src/features/canvas/layout-graph'
import { VISUAL_EDGE_CAPACITY, VISUAL_NODE_CAPACITY } from '$src/lib/projection/types'
import {
  sanitizeLayoutRequestIdentity,
  type LayoutRequestIdentity,
  type LayoutWorkerRequest,
  type LayoutWorkerResponse,
  type LayoutWorkerSuccess,
} from './layout-worker-protocol'

export async function processLayoutWorkerRequest(request: unknown, elk: ElkLike): Promise<LayoutWorkerResponse> {
  try {
    return await arrangeWithElk(request, elk)
  } catch {
    const identity = sanitizeLayoutRequestIdentity(
      request !== null && typeof request === 'object' ? (request as { identity?: unknown }).identity : null,
    )
    return identity
      ? { type: 'layout-error', identity, code: 'worker_runtime_error', message: 'Layout worker failed.' }
      : {
          type: 'layout-error',
          identity: null,
          code: 'invalid_request',
          message: 'Graph arrangement request is invalid.',
        }
  }
}

interface CachedLayoutResult {
  readonly key: string
  readonly result: Omit<LayoutWorkerSuccess, 'identity' | 'durationMs'>
}

function cacheKey(request: LayoutWorkerRequest): string {
  const { workflowIdentity, pairGeneration, scopeKey, graphFingerprint } = request.identity
  return JSON.stringify([workflowIdentity, pairGeneration, scopeKey, graphFingerprint, request.nodes, request.edges])
}

function declaredRequestSnapshot(
  request: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] },
  identity: LayoutRequestIdentity,
): LayoutWorkerRequest | null {
  try {
    const nodes = Object.freeze(
      request.nodes.map((value) => {
        const node = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const declared = node as Record<string, unknown>
        return Object.freeze({
          id: declared.id,
          order: declared.order,
          width: declared.width,
          height: declared.height,
        })
      }),
    )
    const edges = Object.freeze(
      request.edges.map((value) => {
        const edge = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const declared = edge as Record<string, unknown>
        return Object.freeze({
          id: declared.id,
          source: declared.source,
          target: declared.target,
          order: declared.order,
        })
      }),
    )
    const snapshot = Object.freeze({
      type: 'layout' as const,
      identity: Object.freeze({ ...identity }),
      nodes,
      edges,
    })
    return validLayoutWorkerRequest(snapshot) ? snapshot : null
  } catch {
    return null
  }
}

function invalidRequest(identity: LayoutRequestIdentity): LayoutWorkerResponse {
  return {
    type: 'layout-error',
    identity,
    code: 'invalid_request',
    message: 'Graph arrangement request is invalid.',
  }
}

function cacheableResult(result: LayoutWorkerSuccess): Omit<LayoutWorkerSuccess, 'identity' | 'durationMs'> {
  return Object.freeze({
    type: 'layout-result',
    spacingProfile: result.spacingProfile,
    positions: Object.freeze(
      Object.fromEntries(
        Object.entries(result.positions).map(([id, position]) => [id, Object.freeze({ ...position })]),
      ),
    ),
    routes: Object.freeze(
      Object.fromEntries(
        Object.entries(result.routes).map(([id, route]) => [
          id,
          Object.freeze({ ...route, points: Object.freeze(route.points.map((point) => Object.freeze({ ...point }))) }),
        ]),
      ),
    ),
    bounds: Object.freeze({ ...result.bounds }),
  })
}

/** Owns one bounded last-result cache for the lifetime of one warmed worker. */
export function createLayoutWorkerProcessor(elk: ElkLike): (request: unknown) => Promise<LayoutWorkerResponse> {
  let cached: CachedLayoutResult | undefined
  return async (request) => {
    const identity =
      request !== null && typeof request === 'object'
        ? sanitizeLayoutRequestIdentity((request as { identity?: unknown }).identity)
        : null
    if (identity && (request as { type?: unknown }).type === 'layout') {
      const typed = request as LayoutWorkerRequest
      if (
        !Array.isArray(typed.nodes) ||
        !Array.isArray(typed.edges) ||
        typed.nodes.length > VISUAL_NODE_CAPACITY ||
        typed.edges.length > VISUAL_EDGE_CAPACITY
      )
        return invalidRequest(identity)
      const declared = declaredRequestSnapshot(typed, identity)
      if (!declared) return invalidRequest(identity)
      const key = cacheKey(declared)
      if (cached?.key === key) return { ...cached.result, identity, durationMs: 0 }
      const result = await processLayoutWorkerRequest(declared, elk)
      if (result.type === 'layout-result') cached = { key, result: cacheableResult(result) }
      return result
    }
    return processLayoutWorkerRequest(request, elk)
  }
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
if (typeof WorkerGlobalScope !== 'undefined' && workerScope instanceof WorkerGlobalScope) {
  const { endpoint, publish } = createLocalElkEndpoint(workerScope)
  // ELK uses only postMessage/onmessage/terminate from its worker endpoint.
  // All algorithm work stays on this real, terminable dedicated worker.
  const elk = new ELK({ algorithms: ['layered'], workerFactory: () => endpoint as unknown as Worker })
  const processRequest = createLayoutWorkerProcessor(elk)
  workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
    void processRequest(event.data).then((response) => publish(response))
  })
}
