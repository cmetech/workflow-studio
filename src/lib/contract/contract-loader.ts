import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
import type {
  AuthoringContract,
  ContractLoadErrorCode,
  ContractLoadResult,
  ContractSource,
  WorkflowProfile,
} from './types'

const SUPPORTED_SCHEMA_VERSION = 1
const SUPPORTED_CONTRACT_READER_VERSION = 1
const SUPPORTED_PROFILES = new Set<WorkflowProfile>(['hermes-legacy', 'archon-2026-07'])

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

function hasEnvelopeShape(envelope: Record<string, unknown>): boolean {
  const limits = envelope.limits

  return (
    Number.isInteger(envelope.normalizer_version) &&
    (envelope.normalizer_version as number) >= 1 &&
    typeof envelope.contract_digest === 'string' &&
    /^sha256:[0-9a-fA-F]{64}$/.test(envelope.contract_digest) &&
    isRecord(envelope.definition_schema) &&
    isRecord(envelope.sidecar_schema) &&
    Array.isArray(envelope.node_kinds) &&
    Array.isArray(envelope.semantic_rules) &&
    isRecord(envelope.compatibility_codes) &&
    isRecord(envelope.documentation) &&
    isRecord(limits) &&
    Number.isInteger(limits.max_document_bytes) &&
    (limits.max_document_bytes as number) > 0
  )
}

function collectExtensions(envelope: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(envelope).filter(([key]) => !ENVELOPE_KEYS.has(key)))
}

function buildContract(envelope: Record<string, unknown>, normalizedDigest: `sha256:${string}`): AuthoringContract {
  return {
    schema_version: 1,
    contract_reader_version: envelope.contract_reader_version as number,
    profile: envelope.profile as WorkflowProfile,
    normalizer_version: envelope.normalizer_version as number,
    contract_digest: normalizedDigest,
    definition_schema: envelope.definition_schema as Record<string, unknown>,
    sidecar_schema: envelope.sidecar_schema as Record<string, unknown>,
    node_kinds: envelope.node_kinds as AuthoringContract['node_kinds'],
    semantic_rules: envelope.semantic_rules as AuthoringContract['semantic_rules'],
    compatibility_codes: envelope.compatibility_codes as AuthoringContract['compatibility_codes'],
    documentation: envelope.documentation as AuthoringContract['documentation'],
    limits: envelope.limits as AuthoringContract['limits'],
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

  if (!SUPPORTED_PROFILES.has(parsed.profile as WorkflowProfile)) {
    return failure('contract_profile_unsupported', `Contract profile "${parsed.profile}" is unsupported.`)
  }

  if (!hasEnvelopeShape(parsed)) {
    return failure(
      'contract_shape_invalid',
      'The authoring contract envelope is missing or has invalid required fields.',
    )
  }

  const declaredDigest = (parsed.contract_digest as string).slice('sha256:'.length).toLowerCase()
  const actualDigest = await sha256Hex(canonicalizeContractPayload(parsed))

  if (declaredDigest !== actualDigest) {
    return failure('contract_digest_mismatch', 'The authoring contract digest does not match its canonical payload.')
  }

  const normalizedDigest = `sha256:${declaredDigest}` as const
  return { ok: true, contract: buildContract(parsed, normalizedDigest), source }
}
