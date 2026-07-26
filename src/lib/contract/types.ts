export type WorkflowProfile = 'hermes-legacy' | 'archon-2026-07'

export type ContractDocumentKind = 'definition' | 'sidecar'
export type ContractItemStatus = 'supported' | 'deferred' | 'deprecated'

export interface ContractApplicability {
  profiles: readonly WorkflowProfile[]
  documents: readonly ContractDocumentKind[]
  node_kinds?: readonly string[]
}

export interface FieldDescriptor {
  id: string
  label: string
  description: string
  field_path: string
  applicability: ContractApplicability
  widget: string
  section: string
  order: number
  status: ContractItemStatus
  examples: readonly unknown[]
}

export interface NodeKindDescriptor {
  id: string
  label: string
  description: string
  field_path: string
  applicability: ContractApplicability
  widget: string
  section: string
  order: number
  status: ContractItemStatus
  examples: readonly unknown[]
  fields: readonly FieldDescriptor[]
}

export interface SemanticRuleDescriptor {
  id: string
  label: string
  description: string
  field_paths: readonly string[]
  applicability: ContractApplicability
  status: ContractItemStatus
  parameters: Readonly<Record<string, unknown>>
  examples: readonly unknown[]
}

export interface CompatibilityDescriptor {
  status: ContractItemStatus
  description: string
  migration?: string
}

export interface DocumentationTopic {
  id: string
  title: string
  description: string
  body: string
  field_paths: readonly string[]
  applicability: ContractApplicability
  examples: readonly unknown[]
}

export interface ContractExampleDescriptor {
  id: string
  title: string
  description: string
  definition: string
  sidecar?: string
}

export interface ContractDocumentation {
  topics: readonly DocumentationTopic[]
  examples: readonly ContractExampleDescriptor[]
}

export interface AuthoringContract {
  schema_version: 1
  contract_reader_version: number
  profile: WorkflowProfile
  normalizer_version: number
  contract_digest: `sha256:${string}`
  definition_schema: Record<string, unknown>
  sidecar_schema: Record<string, unknown>
  node_kinds: readonly NodeKindDescriptor[]
  semantic_rules: readonly SemanticRuleDescriptor[]
  compatibility_codes: Readonly<Record<string, CompatibilityDescriptor>>
  documentation: ContractDocumentation
  limits: { max_document_bytes: number }
  extensions: Readonly<Record<string, unknown>>
}

export type ContractSource =
  { kind: 'bundled'; identifier: string } | { kind: 'user'; identifier: string } | { kind: 'cli'; identifier: string }

export type ContractLoadErrorCode =
  'contract_digest_mismatch' | 'contract_reader_unsupported' | 'contract_profile_unsupported' | 'contract_shape_invalid'

export type ContractLoadResult =
  | { ok: true; contract: AuthoringContract; source: ContractSource }
  | { ok: false; code: ContractLoadErrorCode; message: string }
