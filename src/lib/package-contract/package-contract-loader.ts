import Ajv2020 from 'ajv/dist/2020.js'
import { sha256Hex } from '../contract/canonical-json'
import type {
  PackageContractFailure,
  PackageContractLoadResult,
  PackageContractSource,
  PackageVectorsLoadResult,
  WorkflowPackageContract,
  WorkflowPackageVectors,
} from './types'

const schemaKeys = ['package_manifest_schema', 'marketplace_index_schema', 'digests_schema'] as const
const limitKeys = [
  'max_files',
  'max_file_bytes',
  'max_total_bytes',
  'max_index_bytes',
  'max_catalog_entries',
  'max_traversal_entries',
]
const pathConstants = {
  separator: '/',
  relative_only: true,
  unicode_normalization: 'NFC',
  reject_empty_segments: true,
  reject_dot_segments: true,
  reject_backslashes: true,
  reject_nul: true,
  reject_casefold_collisions: true,
  reject_symlinks: true,
  reject_nested_package_roots: true,
  reject_repository_metadata: true,
}
const digestConstants = {
  algorithm: 'sha256',
  bytes: 'exact_no_normalization',
  file_hash_encoding: 'raw_32_byte_sha256',
  file_size_encoding: 'unsigned_64_bit_big_endian',
  included_paths: 'all_regular_files_below_package_root',
  ordering: 'unicode_code_point_by_canonical_path',
  path_length_encoding: 'unsigned_64_bit_big_endian',
}
const compatibilityConstants = {
  missing_external_requirements: 'advisory',
  semantic_version_standard: 'SemVer 2.0.0',
  unsupported_versions: 'fail_closed',
  version_comparison: 'SemVer_2.0.0_precedence_build_metadata_ignored',
}
const versionKeys = [
  'supported_contract_versions',
  'supported_index_schema_versions',
  'supported_manifest_schema_versions',
]
const vectorKeys = ['digestVectors', 'pathVectors', 'validationVectors', 'boundaryVectors'] as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function keys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
  )
}
function constants(value: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, item]) => value[key] === item)
}
function failure(code: PackageContractFailure['code'], message: string): PackageContractFailure {
  return { ok: false, code, message }
}
export function freezePackageValue<T>(value: T): T {
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  while (pending.length) {
    const item = pending.pop()
    if (item !== null && typeof item === 'object' && !seen.has(item)) {
      seen.add(item)
      for (const child of Object.values(item)) pending.push(child)
      Object.freeze(item)
    }
  }
  return value
}

export async function verifiedPackageJson(
  bytes: Uint8Array,
  source: PackageContractSource,
  maxBytes: number,
): Promise<{ readonly ok: true; readonly value: unknown } | PackageContractFailure> {
  if (bytes.byteLength > maxBytes)
    return failure('invalid_schema', 'Package contract resource exceeds the reader byte limit.')
  const snapshot = Uint8Array.from(bytes)
  const expectedDigest = source.sha256
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || (await sha256Hex(snapshot)) !== expectedDigest) {
    return failure('digest_mismatch', 'Package contract resource bytes do not match their pinned checksum.')
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot)) as unknown }
  } catch {
    return failure('invalid_schema', 'Package contract resource must be valid UTF-8 JSON.')
  }
}

export async function loadWorkflowPackageContract(
  bytes: Uint8Array,
  source: PackageContractSource,
): Promise<PackageContractLoadResult> {
  const parsed = await verifiedPackageJson(bytes, source, 1024 * 1024)
  if (!parsed.ok) return parsed
  const value = parsed.value
  if (record(value) && typeof value.contract_version === 'number' && value.contract_version !== 1) {
    return failure('unsupported_contract', 'This package contract version is not supported.')
  }
  if (!validEnvelope(value))
    return failure('invalid_schema', 'Package contract envelope contains unsupported or invalid rules.')
  try {
    // Pydantic places pattern beside nullable anyOf; valid JSON Schema, but not Ajv's strictTypes convention.
    const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true })
    for (const key of schemaKeys) {
      const schema = value[key]
      if (!record(schema) || !ajv.validateSchema(schema)) throw new TypeError('Invalid embedded schema')
      ajv.compile(schema)
    }
    return { ok: true, contract: freezePackageValue(value as unknown as WorkflowPackageContract) }
  } catch {
    return failure('invalid_schema', 'Package contract contains an invalid or unsupported JSON Schema.')
  }
}

function validEnvelope(value: unknown): value is Record<string, unknown> {
  if (
    !keys(value, [
      'contract_version',
      ...schemaKeys,
      'path_rules',
      'resource_rules',
      'digest_rules',
      'compatibility_rules',
      'diagnostic_codes',
    ]) ||
    value.contract_version !== 1
  )
    return false
  const limits = value.resource_rules
  if (
    !keys(limits, limitKeys) ||
    !Object.values(limits).every((limit) => typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0)
  )
    return false
  const paths = value.path_rules
  if (!keys(paths, Object.keys(pathConstants)) || !constants(paths, pathConstants)) return false
  const digest = value.digest_rules
  if (
    !keys(digest, [...Object.keys(digestConstants), 'domain_separator_base64', 'excluded_paths']) ||
    !constants(digest, digestConstants)
  )
    return false
  if (
    typeof digest.domain_separator_base64 !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(digest.domain_separator_base64)
  )
    return false
  if (
    !Array.isArray(digest.excluded_paths) ||
    digest.excluded_paths.length !== 1 ||
    digest.excluded_paths[0] !== 'digests.json'
  )
    return false
  const compatibility = value.compatibility_rules
  if (
    !keys(compatibility, [...Object.keys(compatibilityConstants), ...versionKeys]) ||
    !constants(compatibility, compatibilityConstants)
  )
    return false
  if (
    !versionKeys.every(
      (key) => Array.isArray(compatibility[key]) && compatibility[key].length === 1 && compatibility[key][0] === 1,
    )
  )
    return false
  return (
    record(value.diagnostic_codes) &&
    Object.values(value.diagnostic_codes).every((message) => typeof message === 'string' && message.length > 0)
  )
}

export async function loadWorkflowPackageVectors(
  bytes: Uint8Array,
  source: PackageContractSource,
): Promise<PackageVectorsLoadResult> {
  const parsed = await verifiedPackageJson(bytes, source, 8 * 1024 * 1024)
  if (!parsed.ok) return parsed
  const value = parsed.value
  if (record(value) && typeof value.contractVersion === 'number' && value.contractVersion !== 1) {
    return failure('unsupported_contract', 'This package vector version is not supported.')
  }
  if (
    !keys(value, ['contractVersion', ...vectorKeys]) ||
    value.contractVersion !== 1 ||
    !vectorKeys.every((key) => {
      const vectors = value[key]
      return (
        Array.isArray(vectors) &&
        vectors.length > 0 &&
        vectors.every((vector) => record(vector) && typeof vector.name === 'string')
      )
    })
  )
    return failure('invalid_schema', 'Package vectors must contain all four versioned vector families.')
  return { ok: true, vectors: freezePackageValue(value as unknown as WorkflowPackageVectors) }
}
