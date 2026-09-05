import type { GraphScopeKey } from '$src/lib/projection/types'
import type { ReferenceIndex } from '$src/lib/references/reference-index'

export type DocumentKind = 'definition' | 'companion'

export type IssueLayer = 'syntax' | 'contract' | 'semantic' | 'compatibility' | 'operational'

export type ContractDigest = `sha256:${string}`

export interface ValidationIssue {
  code: string
  layer: IssueLayer
  severity: 'error' | 'warning' | 'info'
  blocking: boolean
  message: string
  document: DocumentKind
  path?: string
  line?: number
  column?: number
  nodeId?: string
  scopeKey?: GraphScopeKey
  groupId?: string
  field?: string
  /** Half-open authored scalar offsets in Unicode code points. */
  referenceStart?: number
  referenceEnd?: number
  documentationId?: string
  quickFixId?: string
}

export interface TextDocumentState {
  id: string
  kind: DocumentKind
  path: string
  text: string
  revision: number
  savedRevision: number
  diskHash: string | null
}

export interface WorkflowPairText {
  workflowId: string
  generation: number
  savedGeneration: number
  definition: TextDocumentState
  companion: TextDocumentState | null
}

export interface DocumentRevision {
  workflowId: string
  pairGeneration: number
  definitionPath: string
  companionPath: string | null
  definitionRevision: number
  companionRevision: number | null
  contractDigest: ContractDigest
}

export interface DocumentAnalysis extends DocumentRevision {
  issues: readonly ValidationIssue[]
  projection?: unknown
  referenceIndex?: ReferenceIndex
  structurallyValid: boolean
  visuallyAuthorable?: boolean
}
