import { expect, it, vi } from 'vitest'
import { PackageAnalysisClient } from './package-analysis-client'
import type { PackageAnalysisInput } from './package-analysis-pure'
function endpoint() {
  const listeners = new Map<string, EventListener>()
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, listener)
    },
    removeEventListener: (type: string) => {
      listeners.delete(type)
    },
    send: (data: unknown) => listeners.get('message')?.({ data } as MessageEvent),
    fail: () => listeners.get('error')?.({} as Event),
  }
}
const input = { snapshot: { sourceSnapshotToken: 'exact-snapshot' } } as PackageAnalysisInput
it('binds concurrent replies to request and native snapshot identities', async () => {
  const worker = endpoint(),
    client = new PackageAnalysisClient(worker)
  const first = client.analyze(input),
    second = client.analyze(input)
  const [one, two] = worker.postMessage.mock.calls.map(([request]) => request)
  worker.send({ requestId: one.requestId, sourceSnapshotToken: 'other', result: {} })
  await expect(first).rejects.toThrow('package_analysis_worker_identity')
  const result = { package: { root: 'pkg' }, analysis: { ready: true } }
  worker.send({ requestId: two.requestId, sourceSnapshotToken: 'exact-snapshot', result })
  await expect(second).resolves.toEqual(result)
  client.dispose()
})
it('rejects all pending work on worker failure and never reruns analysis on the caller thread', async () => {
  const worker = endpoint(),
    client = new PackageAnalysisClient(worker)
  const pending = client.analyze(input)
  worker.fail()
  await expect(pending).rejects.toThrow('package_analysis_worker_failed')
  expect(worker.postMessage).toHaveBeenCalledTimes(1)
  client.dispose()
})
it('rejects pending work on timeout and disposal, including future requests', async () => {
  vi.useFakeTimers()
  try {
    const worker = endpoint(),
      client = new PackageAnalysisClient(worker, 25)
    const timed = expect(client.analyze(input)).rejects.toThrow('package_analysis_worker_timeout')
    await vi.advanceTimersByTimeAsync(26)
    await timed
    const pending = expect(client.analyze(input)).rejects.toThrow('package_analysis_worker_disposed')
    client.dispose()
    await pending
    await expect(client.analyze(input)).rejects.toThrow('package_analysis_worker_disposed')
    expect(worker.terminate).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})

it('starts a fresh worker only for an explicit later retry after worker failure', async () => {
  const original = await vi.importActual<typeof import('./package-analysis-client')>('./package-analysis-client')
  const first = endpoint(),
    second = endpoint()
  let launches = 0
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return launches++ === 0 ? first : second
      }
    },
  )
  try {
    const failed = original.runPackageAnalysis(input)
    first.fail()
    await expect(failed).rejects.toThrow('package_analysis_worker_failed')
    expect(launches).toBe(1)
    const retried = original.runPackageAnalysis(input)
    expect(launches).toBe(2)
    expect(first.terminate).toHaveBeenCalledOnce()
    const request = second.postMessage.mock.calls[0]![0]
    second.send({
      requestId: request.requestId,
      sourceSnapshotToken: request.sourceSnapshotToken,
      result: { package: {}, analysis: {} },
    })
    await expect(retried).resolves.toBeDefined()
  } finally {
    original.disposePackageAnalysisWorker()
    vi.unstubAllGlobals()
  }
})
