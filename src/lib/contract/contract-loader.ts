import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
import type {
  AuthoringContract,
  CompatibilityDescriptor,
  ContractApplicability,
  ContractDocumentation,
  ContractExampleDescriptor,
  ContractItemStatus,
  ContractLoadErrorCode,
  ContractLoadResult,
  ContractSource,
  DocumentationTopic,
  FieldDescriptor,
  NodeKindDescriptor,
  SemanticRuleDescriptor,
  WorkflowProfile,
} from './types'

const SUPPORTED_SCHEMA_VERSION = 1
const SUPPORTED_CONTRACT_READER_VERSION = 1

const ENVELOPE_KEYS = new Set([
  'schema_version',
  'contract_reader_version',
  'profile',
  'normalizer_version',
  'contract_digest',
  'definition_schema',
  'sidecar_schema',
  'node_kinds',
  'semantic_rules',
  'compatibility_codes',
  'documentation',
  'limits',
])

function failure(code: ContractLoadErrorCode, message: string): ContractLoadResult {
  return { ok: false, code, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isWorkflowProfile(value: unknown): value is WorkflowProfile {
  return value === 'hermes-legacy' || value === 'archon-2026-07'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isContractItemStatus(value: unknown): value is ContractItemStatus {
  return value === 'supported' || value === 'deferred' || value === 'deprecated'
}

function isContractApplicability(value: unknown): value is ContractApplicability {
  if (!isRecord(value) || !Array.isArray(value.profiles) || !Array.isArray(value.documents)) {
    return false
  }

  return (
    value.profiles.every(isWorkflowProfile) &&
    value.documents.every((document) => document === 'definition' || document === 'sidecar') &&
    (value.node_kinds === undefined || isStringArray(value.node_kinds))
  )
}

function hasFieldDescriptorShape(value: unknown): value is FieldDescriptor {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.field_path === 'string' &&
    isContractApplicability(value.applicability) &&
    typeof value.widget === 'string' &&
    typeof value.section === 'string' &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order) &&
    isContractItemStatus(value.status) &&
    Array.isArray(value.examples)
  )
}

function hasNodeKindDescriptorShape(value: unknown): value is NodeKindDescriptor {
  if (!isRecord(value)) {
    return false
  }

  const fields = value.fields
  return hasFieldDescriptorShape(value) && Array.isArray(fields) && fields.every(hasFieldDescriptorShape)
}

function hasSemanticRuleDescriptorShape(value: unknown): value is SemanticRuleDescriptor {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    isStringArray(value.field_paths) &&
    isContractApplicability(value.applicability) &&
    isContractItemStatus(value.status) &&
    isRecord(value.parameters) &&
    Array.isArray(value.examples)
  )
}

function hasCompatibilityDescriptorShape(value: unknown): value is CompatibilityDescriptor {
  return (
    isRecord(value) &&
    isContractItemStatus(value.status) &&
    typeof value.description === 'string' &&
    (value.migration === undefined || typeof value.migration === 'string')
  )
}

function hasDocumentationTopicShape(value: unknown): value is DocumentationTopic {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.body === 'string' &&
    isStringArray(value.field_paths) &&
    isContractApplicability(value.applicability) &&
    Array.isArray(value.examples)
  )
}

function hasContractExampleShape(value: unknown): value is ContractExampleDescriptor {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.definition === 'string' &&
    (value.sidecar === undefined || typeof value.sidecar === 'string')
  )
}

function hasDocumentationShape(value: unknown): value is ContractDocumentation {
  return (
    isRecord(value) &&
    Array.isArray(value.topics) &&
    value.topics.every(hasDocumentationTopicShape) &&
    Array.isArray(value.examples) &&
    value.examples.every(hasContractExampleShape)
  )
}

type ValidatedContractEnvelope = Omit<AuthoringContract, 'extensions'> & Record<string, unknown>

function hasEnvelopeShape(envelope: Record<string, unknown>): envelope is ValidatedContractEnvelope {
  const limits = envelope.limits

  return (
    envelope.schema_version === SUPPORTED_SCHEMA_VERSION &&
    envelope.contract_reader_version === SUPPORTED_CONTRACT_READER_VERSION &&
    isWorkflowProfile(envelope.profile) &&
    isPositiveInteger(envelope.normalizer_version) &&
    typeof envelope.contract_digest === 'string' &&
    /^sha256:[0-9a-fA-F]{64}$/.test(envelope.contract_digest) &&
    isRecord(envelope.definition_schema) &&
    isRecord(envelope.sidecar_schema) &&
    Array.isArray(envelope.node_kinds) &&
    envelope.node_kinds.every(hasNodeKindDescriptorShape) &&
    Array.isArray(envelope.semantic_rules) &&
    envelope.semantic_rules.every(hasSemanticRuleDescriptorShape) &&
    isRecord(envelope.compatibility_codes) &&
    Object.values(envelope.compatibility_codes).every(hasCompatibilityDescriptorShape) &&
    hasDocumentationShape(envelope.documentation) &&
    isRecord(limits) &&
    isPositiveInteger(limits.max_document_bytes)
  )
}

function collectExtensions(envelope: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(envelope).filter(([key]) => !ENVELOPE_KEYS.has(key)))
}

function buildContract(envelope: ValidatedContractEnvelope, normalizedDigest: `sha256:${string}`): AuthoringContract {
  return {
    schema_version: 1,
    contract_reader_version: envelope.contract_reader_version,
    profile: envelope.profile,
    normalizer_version: envelope.normalizer_version,
    contract_digest: normalizedDigest,
    definition_schema: envelope.definition_schema,
    sidecar_schema: envelope.sidecar_schema,
    node_kinds: envelope.node_kinds,
    semantic_rules: envelope.semantic_rules,
    compatibility_codes: envelope.compatibility_codes,
    documentation: envelope.documentation,
    limits: envelope.limits,
    extensions: collectExtensions(envelope),
  }
}

export async function loadAuthoringContract(bytes: Uint8Array, source: ContractSource): Promise<ContractLoadResult> {
  let parsed: unknown

  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    parsed = JSON.parse(json) as unknown
  } catch {
    return failure('contract_shape_invalid', 'The authoring contract must be valid UTF-8 JSON.')
  }

  if (!isRecord(parsed)) {
    return failure('contract_shape_invalid', 'The authoring contract envelope must be a JSON object.')
  }

  if (!Number.isInteger(parsed.schema_version) || !Number.isInteger(parsed.contract_reader_version)) {
    return failure('contract_shape_invalid', 'The contract schema and reader versions must be integers.')
  }

  if (
    parsed.schema_version !== SUPPORTED_SCHEMA_VERSION ||
    parsed.contract_reader_version !== SUPPORTED_CONTRACT_READER_VERSION
  ) {
    return failure(
      'contract_reader_unsupported',
      `Contract schema ${String(parsed.schema_version)} with reader ${String(parsed.contract_reader_version)} is unsupported.`,
    )
  }

  if (typeof parsed.profile !== 'string') {
    return failure('contract_shape_invalid', 'The authoring contract profile must be a string.')
  }

  if (!isWorkflowProfile(parsed.profile)) {
    return failure('contract_profile_unsupported', `Contract profile "${parsed.profile}" is unsupported.`)
  }

  if (!hasEnvelopeShape(parsed)) {
    return failure(
      'contract_shape_invalid',
      'The authoring contract envelope is missing or has invalid required fields.',
    )
  }

  const declaredDigest = parsed.contract_digest.slice('sha256:'.length).toLowerCase()
  let actualDigest: string

  try {
    actualDigest = await sha256Hex(canonicalizeContractPayload(parsed))
  } catch {
    return failure('contract_shape_invalid', 'The authoring contract contains values that cannot be canonicalized.')
  }

  if (declaredDigest !== actualDigest) {
    return failure('contract_digest_mismatch', 'The authoring contract digest does not match its canonical payload.')
  }

  const normalizedDigest = `sha256:${declaredDigest}` as const
  return { ok: true, contract: buildContract(parsed, normalizedDigest), source }
}
