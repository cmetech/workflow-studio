/// <reference lib="webworker" />

import type { AuthoringContract } from '$src/lib/contract/types'
import type { ContractDigest, DocumentAnalysis } from '$src/lib/documents/types'
import {
  analysisIdentity,
  type AnalyzeDocumentRequest,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse,
} from './document-worker-protocol'

export interface DocumentWorkerCache {
  contracts: Map<ContractDigest, AuthoringContract>
}

export function createDocumentWorkerCache(): DocumentWorkerCache {
  return { contracts: new Map() }
}

export async function processDocumentWorkerRequest(
  request: DocumentWorkerRequest,
  cache: DocumentWorkerCache,
): Promise<DocumentWorkerResponse> {
  if (request.type === 'contract-register') {
    if (request.contract.contract_digest !== request.contractDigest || request.contract.profile !== request.profile) {
      return {
        type: 'contract-registration-error',
        requestId: request.requestId,
        contractDigest: request.contractDigest,
        profile: request.profile,
        code: 'contract_identity_mismatch',
        message: 'The registered authoring contract does not match its declared digest and profile.',
      }
    }

    cache.contracts.set(request.contractDigest, request.contract)
    return {
      type: 'contract-registered',
      requestId: request.requestId,
      contractDigest: request.contractDigest,
      profile: request.profile,
    }
  }

  const identity = analysisIdentity(request)
  const contract = cache.contracts.get(request.contractDigest)
  if (!contract) {
    return {
      type: 'analysis-error',
      ...identity,
      code: 'contract_not_registered',
      message: 'The requested authoring contract is not registered in this worker.',
    }
  }

  return {
    type: 'analysis',
    ...identity,
    analysis: await analyzeWorkflowPair(request, contract),
  }
}

/**
 * Temporary Task 1 seam. Task 3 replaces this body with YAML, contract, and DAG analysis.
 * Keeping the placeholder here avoids introducing a second validation module before that task.
 */
export async function analyzeWorkflowPair(
  request: AnalyzeDocumentRequest,
  contract: AuthoringContract,
): Promise<DocumentAnalysis> {
  void contract
  return {
    workflowId: request.workflowId,
    pairGeneration: request.pairGeneration,
    definitionRevision: request.definition.revision,
    companionRevision: request.companion?.revision ?? null,
    contractDigest: request.contractDigest,
    issues: [
      {
        code: 'analysis_not_implemented',
        layer: 'syntax',
        severity: 'error',
        blocking: true,
        message: 'Workflow analysis is introduced in Phase 2 Task 3.',
        document: 'definition',
      },
    ],
    structurallyValid: false,
  }
}

const cache = createDocumentWorkerCache()
const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope

if (typeof WorkerGlobalScope !== 'undefined' && workerScope instanceof WorkerGlobalScope) {
  workerScope.addEventListener('message', (event: MessageEvent<DocumentWorkerRequest>) => {
    void processDocumentWorkerRequest(event.data, cache).then((response) => workerScope.postMessage(response))
  })
}
