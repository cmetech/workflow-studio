/// <reference lib="webworker" />

import ELK from 'elkjs/lib/elk-api.js'
import { arrangeWithElk, type ElkLike } from '$src/features/canvas/layout-graph'
import { sanitizeLayoutRequestIdentity, type LayoutWorkerResponse } from './layout-worker-protocol'

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

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
if (typeof WorkerGlobalScope !== 'undefined' && workerScope instanceof WorkerGlobalScope) {
  // elk-api supports a real worker factory. The algorithm entry must run in its
  // own scope because it owns onmessage; raw ELK messages never reach the renderer.
  // Dedicated-worker termination also terminates its descendant workers.
  const elk = new ELK({
    algorithms: ['layered'],
    workerFactory: () => new Worker(new URL('./elk-engine-worker.ts', import.meta.url), { type: 'module' }),
  })
  workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
    void processLayoutWorkerRequest(event.data, elk).then((response) => workerScope.postMessage(response))
  })
}
