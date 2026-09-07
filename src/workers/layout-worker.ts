/// <reference lib="webworker" />

import ELK from 'elkjs/lib/elk.bundled.js'
import { arrangeWithElk, type ElkLike } from '$src/features/canvas/layout-graph'
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './layout-worker-protocol'

export function processLayoutWorkerRequest(request: LayoutWorkerRequest, elk: ElkLike): Promise<LayoutWorkerResponse> {
  return arrangeWithElk(request, elk)
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
if (typeof WorkerGlobalScope !== 'undefined' && workerScope instanceof WorkerGlobalScope) {
  // The bundled implementation uses an in-process worker shim when no URL is supplied.
  // Running it inside our dedicated worker requires neither a nested worker nor a network asset.
  const elk = new ELK({ algorithms: ['layered'] })
  workerScope.addEventListener('message', (event: MessageEvent<LayoutWorkerRequest>) => {
    void processLayoutWorkerRequest(event.data, elk).then((response) => workerScope.postMessage(response))
  })
}
