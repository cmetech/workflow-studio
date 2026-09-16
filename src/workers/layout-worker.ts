/// <reference lib="webworker" />

import ELK from 'elkjs/lib/elk-api.js'
import { arrangeWithElk, type ElkLike } from '$src/features/canvas/layout-graph'
import {
  sanitizeLayoutRequestIdentity,
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
      const key = cacheKey(typed)
      if (cached?.key === key) return { ...cached.result, identity, durationMs: 0 }
      const result = await processLayoutWorkerRequest(request, elk)
      if (result.type === 'layout-result') cached = { key, result: cacheableResult(result) }
      return result
    }
    return processLayoutWorkerRequest(request, elk)
  }
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
if (typeof WorkerGlobalScope !== 'undefined' && workerScope instanceof WorkerGlobalScope) {
  // elk-api supports a real worker factory. The algorithm entry must run in its
  // own scope because it owns onmessage; raw ELK messages never reach the renderer.
  // Dedicated-worker termination also terminates its descendant workers.
  const elk = new ELK({
    algorithms: ['layered'],
    workerFactory: () => new Worker(new URL('./elk-engine-worker.ts', import.meta.url), { type: 'module' }),
  })
  const processRequest = createLayoutWorkerProcessor(elk)
  workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
    void processRequest(event.data).then((response) => workerScope.postMessage(response))
  })
}
