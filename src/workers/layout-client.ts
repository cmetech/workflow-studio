import type {
  LayoutRequestIdentity,
  LayoutWorkerFailure,
  LayoutWorkerFailureCode,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
  LayoutWorkerResult,
} from './layout-worker-protocol'

const LAYOUT_TIMEOUT_MS = 5_000

export interface LayoutWorkerEndpoint {
  postMessage(message: LayoutWorkerRequest): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void
  terminate(): void
}

export type LayoutWorkerFactory = () => LayoutWorkerEndpoint

export interface LayoutClientOptions {
  readonly timeoutMs?: number
}

interface PendingLayout {
  readonly request: LayoutWorkerRequest
  readonly resolve: (result: LayoutWorkerResult) => void
  readonly reject: (reason: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface LayoutClientLike {
  arrange(request: LayoutWorkerRequest): Promise<LayoutWorkerResult>
  cancel(): void
  destroy(): void
}

export class LayoutClient implements LayoutClientLike {
  private worker: LayoutWorkerEndpoint | undefined
  private listenersAttached = false
  private pending: PendingLayout | undefined
  private destroyed = false
  private readonly onMessage: EventListener = (event): void =>
    this.receive((event as MessageEvent<LayoutWorkerResponse>).data)
  private readonly onWorkerError: EventListener = (): void =>
    this.failWorker('worker_runtime_error', 'Layout worker failed.')
  private readonly onWorkerMessageError: EventListener = (): void =>
    this.failWorker('worker_message_error', 'Layout worker returned an unreadable message.')

  constructor(
    private readonly workerFactory: LayoutWorkerFactory,
    private readonly options: LayoutClientOptions = {},
  ) {}

  arrange(request: LayoutWorkerRequest): Promise<LayoutWorkerResult> {
    if (this.destroyed) return Promise.reject(new Error('Layout worker client has been destroyed.'))

    this.rejectPending('Layout request was superseded.')
    const snapshot = snapshotLayoutRequest(request)

    let worker: LayoutWorkerEndpoint
    try {
      worker = this.ensureWorker()
      this.attachWorkerListeners(worker)
    } catch {
      this.disposeWorker()
      return Promise.resolve(failureFor(snapshot.identity, 'worker_runtime_error', 'Layout worker failed.'))
    }

    return new Promise<LayoutWorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => this.timeout(snapshot.identity), this.options.timeoutMs ?? LAYOUT_TIMEOUT_MS)
      this.pending = { request: snapshot, resolve, reject, timer }

      try {
        worker.postMessage(snapshot)
      } catch {
        this.failWorker('worker_runtime_error', 'Layout worker failed.')
      }
    })
  }

  cancel(): void {
    this.rejectPending('Layout request was cancelled.')
    this.disposeWorker()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.rejectPending('Layout worker client was destroyed before the request completed.')
    this.disposeWorker()
  }

  private ensureWorker(): LayoutWorkerEndpoint {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    this.worker = worker
    return worker
  }

  private receive(response: LayoutWorkerResponse): void {
    const pending = this.pending
    if (!pending) return
    if (!isLayoutWorkerResponse(response)) {
      this.failWorker('worker_message_error', 'Layout worker returned an unreadable message.')
      return
    }
    if (response.identity.requestId !== pending.request.identity.requestId) return
    if (!sameLayoutIdentity(response.identity, pending.request.identity)) {
      this.rejectPending('Layout worker response identity did not match the current request.')
      return
    }

    this.pending = undefined
    clearTimeout(pending.timer)
    this.detachWorkerListeners()
    pending.resolve(response)
  }

  private timeout(identity: LayoutRequestIdentity): void {
    const pending = this.pending
    if (!pending || !sameLayoutIdentity(pending.request.identity, identity)) return
    this.pending = undefined
    clearTimeout(pending.timer)
    pending.resolve(failureFor(identity, 'worker_timeout', 'Layout worker timed out.'))
    this.disposeWorker()
  }

  private failWorker(code: LayoutWorkerFailureCode, message: string): void {
    const pending = this.pending
    if (pending) {
      this.pending = undefined
      clearTimeout(pending.timer)
      pending.resolve(failureFor(pending.request.identity, code, message))
    }
    this.disposeWorker()
  }

  private rejectPending(message: string): void {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    clearTimeout(pending.timer)
    this.detachWorkerListeners()
    pending.reject(new Error(message))
  }

  private attachWorkerListeners(worker: LayoutWorkerEndpoint): void {
    if (this.listenersAttached) return
    worker.addEventListener('message', this.onMessage)
    worker.addEventListener('error', this.onWorkerError)
    worker.addEventListener('messageerror', this.onWorkerMessageError)
    this.listenersAttached = true
  }

  private detachWorkerListeners(): void {
    const worker = this.worker
    if (!worker || !this.listenersAttached) return
    this.listenersAttached = false
    worker.removeEventListener('message', this.onMessage)
    worker.removeEventListener('error', this.onWorkerError)
    worker.removeEventListener('messageerror', this.onWorkerMessageError)
  }

  private disposeWorker(): void {
    const worker = this.worker
    if (!worker) return
    this.detachWorkerListeners()
    this.worker = undefined
    worker.terminate()
  }
}

export function snapshotLayoutRequest(request: LayoutWorkerRequest): LayoutWorkerRequest {
  const identity = Object.freeze({
    requestId: request.identity.requestId,
    workflowIdentity: request.identity.workflowIdentity,
    pairGeneration: request.identity.pairGeneration,
    scopeKey: request.identity.scopeKey,
    graphFingerprint: request.identity.graphFingerprint,
    layoutRevision: request.identity.layoutRevision,
  })
  const nodes = Object.freeze(
    request.nodes.map((node) =>
      Object.freeze({
        id: node.id,
        order: node.order,
        width: node.width,
        height: node.height,
      }),
    ),
  )
  const edges = Object.freeze(
    request.edges.map((edge) =>
      Object.freeze({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        order: edge.order,
      }),
    ),
  )
  return Object.freeze({ type: 'layout', identity, nodes, edges })
}

export function sameLayoutIdentity(left: LayoutRequestIdentity, right: LayoutRequestIdentity): boolean {
  return (
    left.requestId === right.requestId &&
    left.workflowIdentity === right.workflowIdentity &&
    left.pairGeneration === right.pairGeneration &&
    left.scopeKey === right.scopeKey &&
    left.graphFingerprint === right.graphFingerprint &&
    left.layoutRevision === right.layoutRevision
  )
}

function failureFor(
  identity: LayoutRequestIdentity,
  code: LayoutWorkerFailureCode,
  message: string,
): LayoutWorkerFailure {
  return { type: 'layout-error', identity, code, message }
}

function isLayoutWorkerResponse(
  value: unknown,
): value is LayoutWorkerResponse & { readonly identity: LayoutRequestIdentity } {
  if (value === null || typeof value !== 'object') return false
  const response = value as { readonly type?: unknown; readonly identity?: unknown }
  return (
    (response.type === 'layout-result' || response.type === 'layout-error') &&
    response.identity !== null &&
    typeof response.identity === 'object' &&
    typeof (response.identity as { readonly requestId?: unknown }).requestId === 'string'
  )
}
