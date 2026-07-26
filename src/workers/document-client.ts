import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import {
  acceptAnalysis,
  createDocumentRevision,
  isAnalysisCurrent,
  type AnalysisState,
} from '$src/lib/documents/revisions'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import type {
  AnalyzeDocumentErrorResponse,
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  DocumentAnalysisReason,
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from './document-worker-protocol'

const EDIT_DEBOUNCE_MS = 180

export interface DocumentWorkerEndpoint {
  postMessage(message: DocumentWorkerRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void
}

export interface DocumentClientOptions {
  onAnalysis?: (analysis: DocumentAnalysis) => void
  onError?: (error: AnalyzeDocumentErrorResponse) => void
}

let nextRequestNumber = 0

function requestId(prefix: 'contract' | 'analysis'): string {
  nextRequestNumber += 1
  return `${prefix}-${nextRequestNumber}`
}

export class DocumentClient {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly registeredContracts = new Set<string>()
  private analysisState: AnalysisState | null = null
  private currentRequestId: string | null = null
  private currentProfile: WorkflowProfile | null = null
  private currentReason: DocumentAnalysisReason | null = null
  private readonly onMessage = (event: MessageEvent<DocumentWorkerResponse>): void => this.receive(event.data)

  constructor(
    private readonly worker: DocumentWorkerEndpoint,
    private readonly options: DocumentClientOptions = {},
  ) {
    worker.addEventListener('message', this.onMessage)
  }

  schedule(pair: WorkflowPairText, contract: AuthoringContract, reason: DocumentAnalysisReason = 'edit'): string {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    const request = this.createAnalyzeRequest(pair, contract, reason)
    this.currentRequestId = request.requestId
    this.currentProfile = request.profile
    this.currentReason = request.reason
    this.analysisState = {
      revision: createDocumentRevision(pair, contract.contract_digest),
      analysis: null,
    }

    if (reason === 'edit') {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.dispatch(request, contract)
      }, EDIT_DEBOUNCE_MS)
    } else {
      this.dispatch(request, contract)
    }

    return request.requestId
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.worker.removeEventListener('message', this.onMessage)
  }

  private createAnalyzeRequest(
    pair: WorkflowPairText,
    contract: AuthoringContract,
    reason: DocumentAnalysisReason,
  ): AnalyzeDocumentRequest {
    return {
      type: 'analyze',
      requestId: requestId('analysis'),
      workflowId: pair.workflowId,
      pairGeneration: pair.generation,
      definition: {
        path: pair.definition.path,
        text: pair.definition.text,
        revision: pair.definition.revision,
      },
      companion: pair.companion
        ? {
            path: pair.companion.path,
            text: pair.companion.text,
            revision: pair.companion.revision,
          }
        : null,
      profile: contract.profile,
      contractDigest: contract.contract_digest,
      reason,
    }
  }

  private dispatch(request: AnalyzeDocumentRequest, contract: AuthoringContract): void {
    if (!this.registeredContracts.has(request.contractDigest)) {
      this.worker.postMessage({
        type: 'contract-register',
        requestId: requestId('contract'),
        contractDigest: request.contractDigest,
        profile: request.profile,
        contract,
      })
      this.registeredContracts.add(request.contractDigest)
    }

    this.worker.postMessage(request)
  }

  private receive(response: DocumentWorkerResponse): void {
    if (response.type === 'contract-registered' || response.type === 'contract-registration-error') return
    if (!this.responseIdentityIsCurrent(response)) return

    if (response.type === 'analysis-error') {
      this.options.onError?.(response)
      return
    }

    this.acceptResponse(response)
  }

  private responseIdentityIsCurrent(response: AnalyzeDocumentResponse | AnalyzeDocumentErrorResponse): boolean {
    if (!this.analysisState) return false

    return (
      response.requestId === this.currentRequestId &&
      response.profile === this.currentProfile &&
      response.reason === this.currentReason &&
      isAnalysisCurrent(this.analysisState.revision, {
        workflowId: response.workflowId,
        pairGeneration: response.pairGeneration,
        definitionRevision: response.definitionRevision,
        companionRevision: response.companionRevision,
        contractDigest: response.contractDigest,
      })
    )
  }

  private acceptResponse(response: AnalyzeDocumentResponse): void {
    if (!this.analysisState || !isAnalysisCurrent(response, response.analysis)) return

    const next = acceptAnalysis(this.analysisState, response.analysis)
    if (next === this.analysisState || !next.analysis) return

    this.analysisState = next
    this.options.onAnalysis?.(next.analysis)
  }
}
