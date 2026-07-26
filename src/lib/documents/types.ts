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
  field?: string
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
  structurallyValid: boolean
}
