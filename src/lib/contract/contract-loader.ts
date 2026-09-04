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
  FieldDefinition,
  FieldDescriptor,
  NodeKindDescriptor,
  SemanticRuleDescriptor,
  WorkflowProfile,
} from './types'

const SUPPORTED_SCHEMA_VERSION = 1
const SUPPORTED_CONTRACT_READER_VERSIONS = new Set([1, 2])
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
  'field_definitions',
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

function isApplicability(value: unknown): value is ContractApplicability {
  return (
    isRecord(value) &&
    Array.isArray(value.profiles) &&
    Array.isArray(value.documents) &&
    value.profiles.every(isWorkflowProfile) &&
    value.documents.every((document) => document === 'definition' || document === 'sidecar') &&
    (value.node_kinds === undefined || isStringArray(value.node_kinds))
  )
}

function isFullField(value: unknown): value is FieldDescriptor {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.field_path === 'string' &&
    isApplicability(value.applicability) &&
    typeof value.widget === 'string' &&
    typeof value.section === 'string' &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order) &&
    isContractItemStatus(value.status) &&
    Array.isArray(value.examples)
  )
}

function isFieldDefinition(value: unknown): value is FieldDefinition {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.widget === 'string' &&
    typeof value.section === 'string' &&
    Array.isArray(value.examples) &&
    (value.unit === undefined || typeof value.unit === 'string')
  )
}

function isFieldReference(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.definition_ref === 'string' &&
    typeof value.field_path === 'string' &&
    isApplicability(value.applicability) &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order) &&
    isContractItemStatus(value.status)
  )
}

function isNodeKind(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.field_path === 'string' &&
    isApplicability(value.applicability) &&
    typeof value.widget === 'string' &&
    typeof value.section === 'string' &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order) &&
    isContractItemStatus(value.status) &&
    Array.isArray(value.examples) &&
    Array.isArray(value.fields) &&
    value.fields.every((field) => isFullField(field) || isFieldReference(field))
  )
}

function isCompatibility(value: unknown): value is CompatibilityDescriptor {
  return (
    isRecord(value) &&
    isContractItemStatus(value.status) &&
    typeof value.description === 'string' &&
    (value.migration === undefined || typeof value.migration === 'string')
  )
}

function isDocumentation(value: unknown): value is ContractDocumentation {
  return (
    isRecord(value) &&
    Array.isArray(value.topics) &&
    value.topics.every((topic) => isRecord(topic) && typeof topic.id === 'string') &&
    Array.isArray(value.examples) &&
    value.examples.every(
      (example) =>
        isRecord(example) &&
        typeof example.id === 'string' &&
        typeof example.title === 'string' &&
        typeof example.description === 'string' &&
        typeof example.definition === 'string' &&
        (example.sidecar === undefined || typeof example.sidecar === 'string'),
    )
  )
}

function isSemanticRule(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.id === 'string'
}

function normalizeField(
  reference: Record<string, unknown>,
  definitions: Readonly<Record<string, FieldDefinition>>,
): FieldDescriptor | null {
  if (isFullField(reference)) return reference
  if (!isFieldReference(reference)) return null
  const definition = definitions[reference.definition_ref as string]
  if (!definition) return null
  return {
    id: reference.id as string,
    label: definition.label,
    description: definition.description,
    field_path: reference.field_path as string,
    applicability: reference.applicability as ContractApplicability,
    widget: definition.widget,
    section: definition.section,
    order: reference.order as number,
    status: reference.status as ContractItemStatus,
    examples: definition.examples,
    extensions: descriptorExtensions(reference, [
      'id',
      'definition_ref',
      'field_path',
      'applicability',
      'order',
      'status',
    ]),
  }
}

function normalizeNodeKinds(
  values: readonly unknown[],
  definitions: Readonly<Record<string, FieldDefinition>>,
): readonly NodeKindDescriptor[] | null {
  const normalized: NodeKindDescriptor[] = []
  for (const value of values) {
    if (!isNodeKind(value)) return null
    const fields = (value.fields as unknown[]).map((field) =>
      normalizeField(field as Record<string, unknown>, definitions),
    )
    if (fields.some((field) => field === null)) return null
    normalized.push({
      id: value.id as string,
      label: value.label as string,
      description: value.description as string,
      field_path: value.field_path as string,
      applicability: value.applicability as ContractApplicability,
      widget: value.widget as string,
      section: value.section as string,
      order: value.order as number,
      status: value.status as ContractItemStatus,
      examples: value.examples as readonly unknown[],
      fields: fields as FieldDescriptor[],
      extensions: descriptorExtensions(value, [
        'id',
        'label',
        'description',
        'field_path',
        'applicability',
        'widget',
        'section',
        'order',
        'status',
        'examples',
        'fields',
      ]),
    })
  }
  return normalized
}

function normalizeRules(
  values: readonly unknown[],
  profile: WorkflowProfile,
): readonly SemanticRuleDescriptor[] | null {
  const normalized: SemanticRuleDescriptor[] = []
  for (const value of values) {
    if (!isSemanticRule(value)) return null
    if (
      typeof value.label === 'string' &&
      typeof value.description === 'string' &&
      isStringArray(value.field_paths) &&
      isApplicability(value.applicability) &&
      isContractItemStatus(value.status) &&
      isRecord(value.parameters) &&
      Array.isArray(value.examples)
    ) {
      normalized.push({
        ...(value as unknown as SemanticRuleDescriptor),
        parameters: normalizeSemanticParameters(value.id, value.parameters),
      })
      continue
    }
    const { id, ...parameters } = value
    normalized.push({
      id: id as string,
      label: id as string,
      description: '',
      field_paths: [],
      applicability: { profiles: [profile], documents: ['definition'] },
      status: 'supported',
      parameters,
      examples: [],
    })
  }
  return normalized
}

function normalizeSemanticParameters(id: unknown, value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return {}
  if (id !== 'condition-expression' || typeof value.expression_pattern !== 'string') return value

  // Hermes emits escaped quote literals for a Unicode regex. JavaScript's `u`
  // mode rejects that redundant escape, so expose the equivalent executable
  // reader value while leaving the signed generated artifact untouched.
  return { ...value, expression_pattern: value.expression_pattern.replaceAll('\\"', '"') }
}

function normalizeDocumentation(value: ContractDocumentation): ContractDocumentation {
  const topics: DocumentationTopic[] = value.topics.map((topic) => {
    const raw = topic as unknown as Record<string, unknown>
    return {
      id: raw.id as string,
      title: typeof raw.title === 'string' ? raw.title : String(raw.id),
      description: typeof raw.description === 'string' ? raw.description : '',
      body: typeof raw.body === 'string' ? raw.body : '',
      field_paths: isStringArray(raw.field_paths) ? raw.field_paths : [],
      applicability: isApplicability(raw.applicability) ? raw.applicability : { profiles: [], documents: [] },
      examples: Array.isArray(raw.examples) ? raw.examples : [],
    }
  })
  return { topics, examples: value.examples as ContractExampleDescriptor[] }
}

function collectExtensions(envelope: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(envelope).filter(([key]) => !ENVELOPE_KEYS.has(key)))
}

function descriptorExtensions(
  descriptor: Record<string, unknown>,
  known: readonly string[],
): Readonly<Record<string, unknown>> {
  const keys = new Set(known)
  return Object.fromEntries(Object.entries(descriptor).filter(([key]) => !keys.has(key)))
}

export async function loadAuthoringContract(bytes: Uint8Array, source: ContractSource): Promise<ContractLoadResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return failure('contract_shape_invalid', 'The authoring contract must be valid UTF-8 JSON.')
  }
  if (!isRecord(parsed))
    return failure('contract_shape_invalid', 'The authoring contract envelope must be a JSON object.')
  if (!Number.isInteger(parsed.schema_version) || !Number.isInteger(parsed.contract_reader_version))
    return failure('contract_shape_invalid', 'The contract schema and reader versions must be integers.')
  if (
    parsed.schema_version !== SUPPORTED_SCHEMA_VERSION ||
    !SUPPORTED_CONTRACT_READER_VERSIONS.has(parsed.contract_reader_version as number)
  )
    return failure(
      'contract_reader_unsupported',
      `Contract schema ${String(parsed.schema_version)} with reader ${String(parsed.contract_reader_version)} is unsupported.`,
    )
  if (!isWorkflowProfile(parsed.profile))
    return failure('contract_profile_unsupported', `Contract profile "${String(parsed.profile)}" is unsupported.`)
  if (
    !isPositiveInteger(parsed.normalizer_version) ||
    typeof parsed.contract_digest !== 'string' ||
    !/^sha256:[0-9a-fA-F]{64}$/.test(parsed.contract_digest) ||
    !isRecord(parsed.definition_schema) ||
    !isRecord(parsed.sidecar_schema) ||
    !Array.isArray(parsed.node_kinds) ||
    !Array.isArray(parsed.semantic_rules) ||
    !isRecord(parsed.compatibility_codes) ||
    !Object.values(parsed.compatibility_codes).every(isCompatibility) ||
    !isDocumentation(parsed.documentation) ||
    !isRecord(parsed.limits) ||
    !isPositiveInteger(parsed.limits.max_document_bytes)
  )
    return failure(
      'contract_shape_invalid',
      'The authoring contract envelope is missing or has invalid required fields.',
    )
  const definitions = parsed.field_definitions === undefined ? {} : parsed.field_definitions
  if (!isRecord(definitions) || !Object.values(definitions).every(isFieldDefinition))
    return failure('contract_shape_invalid', 'The authoring contract field definitions are invalid.')
  const nodeKinds = normalizeNodeKinds(parsed.node_kinds, definitions as Record<string, FieldDefinition>)
  const semanticRules = normalizeRules(parsed.semantic_rules, parsed.profile)
  if (!nodeKinds || !semanticRules)
    return failure('contract_shape_invalid', 'The authoring contract descriptors are invalid.')
  const declaredDigest = parsed.contract_digest.slice('sha256:'.length).toLowerCase()
  let actualDigest: string
  try {
    actualDigest = await sha256Hex(canonicalizeContractPayload(parsed))
  } catch {
    return failure('contract_shape_invalid', 'The authoring contract contains values that cannot be canonicalized.')
  }
  if (declaredDigest !== actualDigest)
    return failure('contract_digest_mismatch', 'The authoring contract digest does not match its canonical payload.')
  return {
    ok: true,
    source,
    contract: {
      schema_version: 1,
      contract_reader_version: parsed.contract_reader_version as number,
      profile: parsed.profile as WorkflowProfile,
      normalizer_version: parsed.normalizer_version as number,
      contract_digest: `sha256:${declaredDigest}` as const,
      definition_schema: parsed.definition_schema,
      sidecar_schema: parsed.sidecar_schema,
      node_kinds: nodeKinds,
      semantic_rules: semanticRules,
      compatibility_codes: parsed.compatibility_codes as Record<string, CompatibilityDescriptor>,
      documentation: normalizeDocumentation(parsed.documentation),
      limits: { max_document_bytes: parsed.limits.max_document_bytes },
      field_definitions: definitions as Record<string, FieldDefinition>,
      extensions: collectExtensions(parsed),
    },
  }
}
