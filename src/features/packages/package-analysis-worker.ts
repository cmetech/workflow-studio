/// <reference lib="webworker" />
import { analyzeCapturedPackage, type PackageAnalysisInput, type PackageAnalysisResult } from './package-analysis-pure'
export interface PackageWorkerRequest {
  readonly requestId: string
  readonly sourceSnapshotToken: string
  readonly input: PackageAnalysisInput
}
export type PackageWorkerResponse = {
  readonly requestId: string
  readonly sourceSnapshotToken: string
} & ({ readonly result: PackageAnalysisResult } | { readonly error: string })
// Keep only the latest package contract instance so schema validator WeakMaps survive structured cloning.
let lastContractKey = ''
let lastContract: PackageAnalysisInput['contract'] | undefined
export async function processPackageAnalysisRequest(request: PackageWorkerRequest): Promise<PackageWorkerResponse> {
  const identity = { requestId: request.requestId, sourceSnapshotToken: request.sourceSnapshotToken }
  try {
    if (request.input.snapshot.sourceSnapshotToken !== request.sourceSnapshotToken)
      throw new Error('package_analysis_worker_identity')
    const key = JSON.stringify(request.input.contract)
    if (key !== lastContractKey || !lastContract) {
      lastContractKey = key
      lastContract = request.input.contract
    }
    return { ...identity, result: await analyzeCapturedPackage({ ...request.input, contract: lastContract }) }
  } catch (error) {
    return { ...identity, error: error instanceof Error ? error.message : 'package_analysis_worker_failed' }
  }
}
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.addEventListener('message', (event: MessageEvent<PackageWorkerRequest>) => {
    void processPackageAnalysisRequest(event.data).then((response) => self.postMessage(response))
  })
}
