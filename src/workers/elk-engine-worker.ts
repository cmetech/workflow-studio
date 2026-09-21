/// <reference lib="webworker" />

// Load ELK's official dispatcher in this dedicated worker, not a nested worker.
// Packaged Windows WebView2 can hang while fetching nested worker scripts.
import 'elkjs/lib/elk-worker.min.js'

interface EngineScope {
  onmessage: ((event: MessageEvent) => unknown) | null
  postMessage(message: unknown): void
}

/** Separates ELK's internal request/reply protocol from application messages. */
export function createLocalElkEndpoint(scope: EngineScope) {
  const dispatch = scope.onmessage
  if (!dispatch) throw new Error('ELK algorithm dispatcher is unavailable.')
  const publish = scope.postMessage.bind(scope)
  let terminated = false
  const endpoint = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: unknown) {
      queueMicrotask(() => {
        if (!terminated) dispatch.call(scope, new MessageEvent('message', { data: message }))
      })
    },
    terminate() {
      terminated = true
      endpoint.onmessage = null
    },
  }
  // The algorithm dispatcher owns its replies, while only the saved native
  // publisher may cross the application worker boundary. No raw ELK reply can
  // be mistaken for a revision-bound layout result by the renderer.
  scope.onmessage = null
  scope.postMessage = (data: unknown) => {
    if (!terminated) endpoint.onmessage?.(new MessageEvent('message', { data }))
  }
  return { endpoint, publish }
}
