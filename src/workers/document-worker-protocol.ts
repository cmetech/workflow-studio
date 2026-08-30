import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import type { ContractDigest, DocumentAnalysis } from '$src/lib/documents/types'

export type DocumentAnalysisReason = 'edit' | 'contract-change' | 'open' | 'explicit-validate'

export interface ContractRegisterRequest {
  type: 'contract-register'
  requestId: string
  contractDigest: ContractDigest
  profile: WorkflowProfile
  contract: AuthoringContract
}

export interface AnalyzeDocumentSnapshot {
  path: string
  text: string
  revision: number
}

export interface AnalyzeDocumentRequest {
  type: 'analyze'
  requestId: string
  workflowId: string
  pairGeneration: number
  definition: AnalyzeDocumentSnapshot
  companion: AnalyzeDocumentSnapshot | null
  profile: WorkflowProfile
  contractDigest: ContractDigest
  reason: DocumentAnalysisReason
}

export type DocumentWorkerRequest = ContractRegisterRequest | AnalyzeDocumentRequest

export interface ContractRegisteredResponse {
  type: 'contract-registered'
  requestId: string
  contractDigest: ContractDigest
  profile: WorkflowProfile
}

export interface ContractRegistrationErrorResponse {
  type: 'contract-registration-error'
  requestId: string
  contractDigest: ContractDigest
  profile: WorkflowProfile
  code: 'contract_identity_mismatch'
  message: string
}

export interface AnalyzeResponseIdentity {
  requestId: string
  workflowId: string
  pairGeneration: number
  definitionPath: string
  companionPath: string | null
  definitionRevision: number
  companionRevision: number | null
  profile: WorkflowProfile
  contractDigest: ContractDigest
  reason: DocumentAnalysisReason
}

export interface AnalyzeDocumentResponse extends AnalyzeResponseIdentity {
  type: 'analysis'
  analysis: DocumentAnalysis
}

export interface AnalyzeDocumentErrorResponse extends AnalyzeResponseIdentity {
  type: 'analysis-error'
  code: 'contract_not_registered' | 'worker_runtime_error' | 'worker_message_error' | 'worker_timeout'
  message: string
}

export type DocumentWorkerResponse =
  | ContractRegisteredResponse
  | ContractRegistrationErrorResponse
  | AnalyzeDocumentResponse
  | AnalyzeDocumentErrorResponse

export function analysisIdentity(request: AnalyzeDocumentRequest): AnalyzeResponseIdentity {
  return {
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
  }
}
