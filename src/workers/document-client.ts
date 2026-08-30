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
const ANALYSIS_TIMEOUT_MS = 10_000
const REGISTRATION_TIMEOUT_MS = 10_000

export interface DocumentWorkerEndpoint {
  postMessage(message: DocumentWorkerRequest): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void
}

export interface DocumentClientOptions {
  onAnalysis?: (analysis: DocumentAnalysis) => void
  onError?: (error: AnalyzeDocumentErrorResponse) => void
  analysisTimeoutMs?: number
  registrationTimeoutMs?: number
}

let nextRequestNumber = 0

function requestId(prefix: 'contract' | 'analysis'): string {
  nextRequestNumber += 1
  return `${prefix}-${nextRequestNumber}`
}

export class DocumentClient {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly registrations = new Map<string, Promise<void>>()
  private readonly registrationResolvers = new Map<
    string,
    {
      readonly resolve: () => void
      readonly reject: (reason: Error) => void
      readonly timer: ReturnType<typeof setTimeout>
    }
  >()
  private analysisState: AnalysisState | null = null
  private currentRequestId: string | null = null
  private currentRequest: AnalyzeDocumentRequest | null = null
  private currentProfile: WorkflowProfile | null = null
  private currentReason: DocumentAnalysisReason | null = null
  private responseTimer: ReturnType<typeof setTimeout> | undefined
  private readonly onMessage: EventListener = (event): void =>
    this.receive((event as MessageEvent<DocumentWorkerResponse>).data)
  private readonly onWorkerError: EventListener = (): void =>
    this.failCurrent('worker_runtime_error', 'Document analysis worker failed.')
  private readonly onWorkerMessageError: EventListener = (): void =>
    this.failCurrent('worker_message_error', 'Document analysis worker returned an unreadable message.')

  constructor(
    private readonly worker: DocumentWorkerEndpoint,
    private readonly options: DocumentClientOptions = {},
  ) {
    worker.addEventListener('message', this.onMessage)
    worker.addEventListener('error', this.onWorkerError)
    worker.addEventListener('messageerror', this.onWorkerMessageError)
  }

  schedule(pair: WorkflowPairText, contract: AuthoringContract, reason: DocumentAnalysisReason = 'edit'): string {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    const request = this.createAnalyzeRequest(pair, contract, reason)
    this.clearResponseTimer()
    this.currentRequestId = request.requestId
    this.currentRequest = request
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
    this.clearEditTimer()
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onWorkerError)
    this.worker.removeEventListener('messageerror', this.onWorkerMessageError)
    this.clearResponseTimer()
    this.rejectRegistrations('Document worker client was disposed before contract registration completed.')
  }

  registerContract(contract: AuthoringContract): Promise<void> {
    const known = this.registrations.get(contract.contract_digest)
    if (known) return known
    const registrationId = requestId('contract')
    const registration = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => this.failCurrent('worker_timeout', 'Document analysis worker contract registration timed out.'),
        this.options.registrationTimeoutMs ?? REGISTRATION_TIMEOUT_MS,
      )
      this.registrationResolvers.set(registrationId, { resolve, reject, timer })
    })
    this.registrations.set(contract.contract_digest, registration)
    this.worker.postMessage({
      type: 'contract-register',
      requestId: registrationId,
      contractDigest: contract.contract_digest,
      profile: contract.profile,
      contract,
    })
    return registration
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
    void this.registerContract(contract).catch(() => undefined)

    this.worker.postMessage(request)
    if (request.requestId === this.currentRequestId) {
      this.responseTimer = setTimeout(
        () => this.failCurrent('worker_timeout', 'Document analysis worker timed out.'),
        this.options.analysisTimeoutMs ?? ANALYSIS_TIMEOUT_MS,
      )
    }
  }

  private receive(response: DocumentWorkerResponse): void {
    if (response.type === 'contract-registered' || response.type === 'contract-registration-error') {
      const resolver = this.registrationResolvers.get(response.requestId)
      if (!resolver) return
      this.registrationResolvers.delete(response.requestId)
      clearTimeout(resolver.timer)
      if (response.type === 'contract-registered') resolver.resolve()
      else {
        this.registrations.delete(response.contractDigest)
        resolver.reject(new Error(response.message))
      }
      return
    }
    if (!this.responseIdentityIsCurrent(response)) return
    this.clearResponseTimer()

    if (response.type === 'analysis-error') {
      this.options.onError?.(response)
      return
    }

    this.acceptResponse(response)
  }

  private failCurrent(code: AnalyzeDocumentErrorResponse['code'], message: string): void {
    this.clearEditTimer()
    this.clearResponseTimer()
    this.rejectRegistrations(message)
    const request = this.currentRequest
    if (!request || !this.analysisState) return
    this.currentRequest = null
    this.currentRequestId = null
    this.options.onError?.({
      type: 'analysis-error',
      requestId: request.requestId,
      workflowId: request.workflowId,
      pairGeneration: request.pairGeneration,
      definitionPath: request.definition.path,
      companionPath: request.companion?.path ?? null,
      definitionRevision: request.definition.revision,
      companionRevision: request.companion?.revision ?? null,
      profile: request.profile,
      contractDigest: request.contractDigest,
      reason: request.reason,
      code,
      message,
    })
  }

  private clearResponseTimer(): void {
    if (this.responseTimer) clearTimeout(this.responseTimer)
    this.responseTimer = undefined
  }

  private clearEditTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private rejectRegistrations(message: string): void {
    for (const { reject, timer } of this.registrationResolvers.values()) {
      clearTimeout(timer)
      reject(new Error(message))
    }
    this.registrationResolvers.clear()
    this.registrations.clear()
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
        definitionPath: response.definitionPath,
        companionPath: response.companionPath,
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
