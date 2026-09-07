import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutClient, type LayoutWorkerEndpoint } from './layout-client'
import type {
  LayoutRequestIdentity,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
  LayoutWorkerSuccess,
} from './layout-worker-protocol'

function identity(overrides: Partial<LayoutRequestIdentity> = {}): LayoutRequestIdentity {
  return {
    requestId: 'layout-1',
    workflowIdentity: 'workspace/flow.yaml',
    pairGeneration: 2,
    scopeKey: 'root',
    graphFingerprint: `sha256:${'a'.repeat(64)}`,
    layoutRevision: 7,
    ...overrides,
  }
}

function request(requestIdentity = identity()): LayoutWorkerRequest {
  return {
    type: 'layout',
    identity: requestIdentity,
    nodes: [
      { id: 'first', order: 0, width: 216, height: 104 },
      { id: 'second', order: 1, width: 240, height: 128 },
    ],
    edges: [{ id: 'first->second', source: 'first', target: 'second', order: 0 }],
  }
}

function successFor(layoutRequest: LayoutWorkerRequest): LayoutWorkerSuccess {
  return {
    type: 'layout-result',
    identity: { ...layoutRequest.identity },
    spacingProfile: 'default',
    positions: {
      first: { x: 32, y: 32 },
      second: { x: 384, y: 32 },
    },
    routes: {
      'first->second': {
        edgeId: 'first->second',
        points: [
          { x: 248, y: 84 },
          { x: 384, y: 84 },
        ],
      },
    },
    bounds: { x: 32, y: 32, width: 592, height: 128 },
    durationMs: 18,
  }
}

class FakeWorker implements LayoutWorkerEndpoint {
  readonly messages: LayoutWorkerRequest[] = []
  terminated = false
  private readonly listeners = new Set<(event: MessageEvent<LayoutWorkerResponse>) => void>()
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  private readonly messageErrorListeners = new Set<(event: MessageEvent<unknown>) => void>()

  postMessage(message: LayoutWorkerRequest): void {
    this.messages.push(message)
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.add(listener as (event: MessageEvent<LayoutWorkerResponse>) => void)
    if (type === 'error') this.errorListeners.add(listener as (event: ErrorEvent) => void)
    if (type === 'messageerror') this.messageErrorListeners.add(listener as (event: MessageEvent<unknown>) => void)
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.delete(listener as (event: MessageEvent<LayoutWorkerResponse>) => void)
    if (type === 'error') this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    if (type === 'messageerror') this.messageErrorListeners.delete(listener as (event: MessageEvent<unknown>) => void)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(message: LayoutWorkerResponse): void {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data: message }))
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener(new ErrorEvent('error', { message: 'worker crashed' }))
  }

  emitMessageError(): void {
    for (const listener of this.messageErrorListeners) listener(new MessageEvent('messageerror', { data: null }))
  }

  listenerCount(): number {
    return this.listeners.size + this.errorListeners.size + this.messageErrorListeners.size
  }
}

describe('LayoutClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('[RG8] creates no worker until the first arrange request', async () => {
    const factory = vi.fn(() => new FakeWorker())
    const client = new LayoutClient(factory)

    expect(factory).not.toHaveBeenCalled()

    const pending = client.arrange(request())
    const rejection = expect(pending).rejects.toThrow(
      'Layout worker client was destroyed before the request completed.',
    )

    expect(factory).toHaveBeenCalledOnce()
    client.destroy()
    await rejection
  })

  it('posts an exact immutable snapshot without retaining caller-owned arrays or objects', async () => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const input = request()
    const original = structuredClone(input)
    const pending = client.arrange(input)

    expect(worker.messages).toEqual([original])
    const posted = worker.messages[0]!
    expect(posted).not.toBe(input)
    expect(posted.identity).not.toBe(input.identity)
    expect(posted.nodes).not.toBe(input.nodes)
    expect(posted.edges).not.toBe(input.edges)
    expect(Object.isFrozen(posted)).toBe(true)
    expect(Object.isFrozen(posted.identity)).toBe(true)
    expect(Object.isFrozen(posted.nodes)).toBe(true)
    expect(Object.isFrozen(posted.nodes[0])).toBe(true)
    expect(Object.isFrozen(posted.edges)).toBe(true)
    expect(Object.isFrozen(posted.edges[0])).toBe(true)

    ;(input.identity as { workflowIdentity: string }).workflowIdentity = 'changed'
    ;(input.nodes as { id: string; order: number; width: number; height: number }[])[0]!.id = 'changed'
    ;(input.edges as { id: string; source: string; target: string; order: number }[]).push({
      id: 'changed',
      source: 'first',
      target: 'second',
      order: 1,
    })
    expect(posted).toEqual(original)

    worker.emit(successFor(original))
    await expect(pending).resolves.toEqual(successFor(original))
    client.destroy()
  })

  it('resolves a success only when the complete identity passes through unchanged', async () => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const input = request()
    const pending = client.arrange(input)
    const response = successFor(input)

    worker.emit(response)

    await expect(pending).resolves.toEqual(response)
    expect(vi.getTimerCount()).toBe(0)
    expect(worker.listenerCount()).toBe(0)
    client.destroy()
    expect(worker.listenerCount()).toBe(0)
  })

  it('rejects superseded work and ignores its late response after a newer request', async () => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const firstRequest = request(identity({ requestId: 'layout-1', layoutRevision: 1 }))
    const secondRequest = request(identity({ requestId: 'layout-2', layoutRevision: 2 }))
    const first = client.arrange(firstRequest)
    const firstRejection = expect(first).rejects.toThrow('Layout request was superseded.')

    const second = client.arrange(secondRequest)
    await firstRejection
    expect(vi.getTimerCount()).toBe(1)

    worker.emit(successFor(firstRequest))
    let settled = false
    void second.finally(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.emit(successFor(secondRequest))
    await expect(second).resolves.toEqual(successFor(secondRequest))
    client.destroy()
  })

  it.each([
    ['workflow identity', { workflowIdentity: 'another/flow.yaml' }],
    ['pair generation', { pairGeneration: 3 }],
    ['scope', { scopeKey: 'loop-group:review' as const }],
    ['graph fingerprint', { graphFingerprint: `sha256:${'b'.repeat(64)}` as const }],
    ['layout revision', { layoutRevision: 8 }],
  ])('rejects a current response with a mismatched %s', async (_label, override) => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const input = request()
    const pending = client.arrange(input)
    const rejection = expect(pending).rejects.toThrow(
      'Layout worker response identity did not match the current request.',
    )

    worker.emit({ ...successFor(input), identity: { ...input.identity, ...override } })

    await rejection
    expect(vi.getTimerCount()).toBe(0)
    client.destroy()
  })

  it('passes through a matching worker failure result', async () => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const input = request()
    const pending = client.arrange(input)
    const failure = {
      type: 'layout-error',
      identity: { ...input.identity },
      code: 'invalid_result',
      message: 'The layout result was incomplete.',
    } as const

    worker.emit(failure)

    await expect(pending).resolves.toEqual(failure)
    expect(vi.getTimerCount()).toBe(0)
    client.destroy()
  })

  it.each([
    ['runtime error', (worker: FakeWorker) => worker.emitError(), 'worker_runtime_error', 'Layout worker failed.'],
    [
      'message error',
      (worker: FakeWorker) => worker.emitMessageError(),
      'worker_message_error',
      'Layout worker returned an unreadable message.',
    ],
  ] as const)('maps a worker %s to a stable failure result', async (_label, fail, code, message) => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const input = request()
    const pending = client.arrange(input)

    fail(worker)

    await expect(pending).resolves.toEqual({
      type: 'layout-error',
      identity: input.identity,
      code,
      message,
    })
    expect(vi.getTimerCount()).toBe(0)
    client.destroy()
    expect(worker.listenerCount()).toBe(0)
  })

  it('times out at 5,000ms, terminates the endpoint, and creates a fresh endpoint next time', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
    const factory = vi.fn(() => workers[factory.mock.calls.length - 1]!)
    const client = new LayoutClient(factory)
    const input = request()
    const pending = client.arrange(input)

    vi.advanceTimersByTime(4_999)
    expect(workers[0]!.terminated).toBe(false)
    vi.advanceTimersByTime(1)

    await expect(pending).resolves.toEqual({
      type: 'layout-error',
      identity: input.identity,
      code: 'worker_timeout',
      message: 'Layout worker timed out.',
    })
    expect(workers[0]!.terminated).toBe(true)
    expect(workers[0]!.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    const nextRequest = request(identity({ requestId: 'layout-2', layoutRevision: 8 }))
    const next = client.arrange(nextRequest)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(workers[1]!.messages).toEqual([nextRequest])
    workers[1]!.emit(successFor(nextRequest))
    await expect(next).resolves.toEqual(successFor(nextRequest))
    client.destroy()
  })

  it('rejects pending work, clears timers, removes listeners, and terminates on destroy', async () => {
    const worker = new FakeWorker()
    const client = new LayoutClient(() => worker)
    const pending = client.arrange(request())
    const rejection = expect(pending).rejects.toThrow(
      'Layout worker client was destroyed before the request completed.',
    )

    client.destroy()

    await rejection
    expect(vi.getTimerCount()).toBe(0)
    expect(worker.listenerCount()).toBe(0)
    expect(worker.terminated).toBe(true)
    await expect(client.arrange(request(identity({ requestId: 'layout-after-destroy' })))).rejects.toThrow(
      'Layout worker client has been destroyed.',
    )
  })
})
