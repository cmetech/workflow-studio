import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import type { ContractDigest, DocumentAnalysis, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import type { ApplyWorkflowMutationResult } from '$src/lib/documents/transactions'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'

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

export interface MutateDocumentRequest {
  type: 'mutate'
  requestId: string
  pair: WorkflowPairText
  contract: AuthoringContract
  mutation: WorkflowMutation
}

export interface MutateDocumentResponse extends DocumentRevision {
  type: 'mutation'
  requestId: string
  result: ApplyWorkflowMutationResult
}

export interface MutateDocumentErrorResponse extends DocumentRevision {
  type: 'mutation-error'
  requestId: string
  message: string
}

export type DocumentWorkerRequest = ContractRegisterRequest | AnalyzeDocumentRequest | MutateDocumentRequest

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
  | MutateDocumentResponse
  | MutateDocumentErrorResponse
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
