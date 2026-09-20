import type { AuthoringContract } from '$src/lib/contract/types'
import { createDocumentRevision, isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import type { ApplyWorkflowMutationResult } from '$src/lib/documents/transactions'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
import { DocumentClient, type DocumentWorkerEndpoint } from './document-client'
import { WorkspaceActionError } from '$src/features/workspace/workspace-actions'
import type { DocumentWorkerResponse } from './document-worker-protocol'

const ANALYSIS_TIMEOUT_MS = 10_000
let nextRequestNumber = 0

export function analyzePairInWorker(pair: WorkflowPairText, contract: AuthoringContract): Promise<DocumentAnalysis> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new WorkspaceActionError('analysis_unavailable', 'Document analysis worker is unavailable.'))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./document-worker.ts', import.meta.url), { type: 'module' })
    const client = new DocumentClient(worker, {
      onAnalysis: (analysis) => {
        client.dispose()
        worker.terminate()
        resolve(analysis)
      },
      onError: (error) => {
        client.dispose()
        worker.terminate()
        reject(new WorkspaceActionError(error.code, error.message))
      },
    })
    client.schedule(pair, contract, 'explicit-validate')
  })
}

/** Own a one-shot worker so parsing, CST patching, and validation stay off the UI thread. */
export function applyWorkflowMutationInWorker(
  pair: WorkflowPairText,
  mutation: WorkflowMutation,
  contract: AuthoringContract,
  createWorker: () => DocumentWorkerEndpoint & { terminate(): void } = () => {
    if (typeof Worker === 'undefined') {
      throw new WorkspaceActionError('analysis_unavailable', 'Document analysis worker is unavailable.')
    }
    return new Worker(new URL('./document-worker.ts', import.meta.url), { type: 'module' })
  },
): Promise<ApplyWorkflowMutationResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker()
    const id = `mutation-${++nextRequestNumber}`
    const revision = createDocumentRevision(pair, contract.contract_digest)
    const cleanup = (): void => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onError)
      worker.terminate()
    }
    const fail = (message: string): void => {
      cleanup()
      reject(new Error(message))
    }
    const onError: EventListener = () => fail('Document mutation worker failed.')
    const onMessage: EventListener = (event) => {
      const response = (event as MessageEvent<DocumentWorkerResponse>).data
      if (
        (response.type !== 'mutation' && response.type !== 'mutation-error') ||
        response.requestId !== id ||
        !isAnalysisCurrent(revision, response)
      )
        return
      if (response.type === 'mutation-error') {
        fail(response.message)
        return
      }
      cleanup()
      if (response.result.ok) recordEditorMetric('yamlTransactions')
      resolve(response.result)
    }
    const timer = setTimeout(() => fail('Document mutation worker timed out.'), ANALYSIS_TIMEOUT_MS)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onError)
    try {
      worker.postMessage({ type: 'mutate', requestId: id, pair, mutation, contract })
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Document mutation could not be sent to the worker.')
    }
  })
}
