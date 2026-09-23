import type { PackageAnalysisInput, PackageAnalysisResult } from './package-analysis-pure'
import type { PackageWorkerRequest, PackageWorkerResponse } from './package-analysis-worker'
export interface PackageWorkerEndpoint {
  postMessage(request: PackageWorkerRequest): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void
  terminate(): void
}
interface Pending {
  token: string
  resolve: (result: PackageAnalysisResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export class PackageAnalysisClient {
  private sequence = 0
  private closed: string | null = null
  private pending = new Map<string, Pending>()
  private message: EventListener = (event) => {
    const response = (event as MessageEvent<PackageWorkerResponse>).data
    if (!response || typeof response !== 'object') return
    const pending = this.pending.get(response.requestId)
    if (!pending) return // A retired request cannot publish into another capture.
    this.pending.delete(response.requestId)
    clearTimeout(pending.timer)
    if (response.sourceSnapshotToken !== pending.token) pending.reject(new Error('package_analysis_worker_identity'))
    else if ('error' in response) pending.reject(new Error(response.error))
    else if (!response.result || typeof response.result !== 'object')
      pending.reject(new Error('package_analysis_worker_response'))
    else pending.resolve(response.result)
  }
  private failure: EventListener = () => this.rejectAll('package_analysis_worker_failed')
  constructor(
    private readonly worker: PackageWorkerEndpoint,
    private readonly timeoutMs = 30_000,
  ) {
    worker.addEventListener('message', this.message)
    worker.addEventListener('error', this.failure)
    worker.addEventListener('messageerror', this.failure)
  }
  get failed(): boolean {
    return this.closed === 'package_analysis_worker_failed'
  }
  analyze(input: PackageAnalysisInput): Promise<PackageAnalysisResult> {
    if (this.closed) return Promise.reject(new Error(this.closed))
    const requestId = 'package-analysis-' + ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('package_analysis_worker_timeout'))
      }, this.timeoutMs)
      this.pending.set(requestId, { token: input.snapshot.sourceSnapshotToken, resolve, reject, timer })
      try {
        this.worker.postMessage({ requestId, sourceSnapshotToken: input.snapshot.sourceSnapshotToken, input })
      } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('package_analysis_worker_message'))
      }
    })
  }
  private rejectAll(message: string) {
    this.closed = message
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }
  dispose(): void {
    this.rejectAll('package_analysis_worker_disposed')
    this.worker.removeEventListener('message', this.message)
    this.worker.removeEventListener('error', this.failure)
    this.worker.removeEventListener('messageerror', this.failure)
    this.worker.terminate()
  }
}
let client: PackageAnalysisClient | undefined
export function runPackageAnalysis(input: PackageAnalysisInput): Promise<PackageAnalysisResult> {
  if (client?.failed) {
    client.dispose()
    client = undefined
  }
  client ??= new PackageAnalysisClient(
    new Worker(new URL('./package-analysis-worker.ts', import.meta.url), { type: 'module' }),
  )
  return client.analyze(input)
}
export function disposePackageAnalysisWorker(): void {
  client?.dispose()
  client = undefined
}
