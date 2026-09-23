import { freezePackageValue, verifiedPackageJson } from './package-contract-loader'
import type { PackageContractFailure, PackageContractSource } from './types'

type RuleRecord = Readonly<Record<string, unknown>>
export interface ResourceCandidateOperation {
  readonly directory: string
  readonly operation: 'identity' | 'replace-suffix' | 'append-unless-ends-with'
  readonly suffix: string
}
export interface ResourceResolutionContract extends RuleRecord {
  readonly contract_id: 'workflow-package-resource-resolution'
  readonly contract_version: 1
  readonly candidate_rules: {
    readonly 'compiler-source': {
      readonly command: readonly ResourceCandidateOperation[]
      readonly mcp: readonly ResourceCandidateOperation[]
      readonly script: Readonly<Record<string, readonly ResourceCandidateOperation[]>>
    }
    readonly runtime: RuleRecord
  }
  readonly coverage: RuleRecord
}
export interface ResourceResolutionVectors extends RuleRecord {
  readonly contract_id: 'workflow-package-resource-resolution'
  readonly contract_version: 1
  readonly lookup: readonly RuleRecord[]
  readonly compilation: readonly RuleRecord[]
  readonly discriminator: readonly RuleRecord[]
  readonly mcp_candidates: readonly RuleRecord[]
  readonly admission: readonly RuleRecord[]
  readonly filesystem_recipes: readonly RuleRecord[]
}
type Result<K extends string, T> = ({ readonly ok: true } & Readonly<Record<K, T>>) | PackageContractFailure

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(message: string): PackageContractFailure {
  return { ok: false, code: 'invalid_schema', message }
}
function identity(value: unknown): PackageContractFailure | null {
  if (!record(value) || value.contract_id !== 'workflow-package-resource-resolution')
    return invalid('Resource resolution artifact has an invalid contract identity.')
  if (value.contract_version !== 1)
    return { ok: false, code: 'unsupported_contract', message: 'Resource resolution contract version is unsupported.' }
  return null
}
function operations(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      if (!record(item) || typeof item.directory !== 'string' || typeof item.suffix !== 'string') return false
      if (Object.keys(item).length !== 3) return false
      if (item.directory !== '' && !item.directory.split('/').every((part) => /^[A-Za-z0-9_-]+$/.test(part)))
        return false
      if (item.operation === 'identity') return item.suffix === ''
      return (
        (item.operation === 'replace-suffix' || item.operation === 'append-unless-ends-with') &&
        /^\.[a-z]+$/.test(item.suffix)
      )
    })
  )
}

/** Verifies the offline artifact boundary. Readiness still requires a supported interpreter and context. */
export async function loadResourceResolutionContract(
  bytes: Uint8Array,
  source: PackageContractSource,
): Promise<Result<'contract', ResourceResolutionContract>> {
  const parsed = await verifiedPackageJson(bytes, source, 1024 * 1024)
  if (!parsed.ok) return parsed
  const issue = identity(parsed.value)
  if (issue) return issue
  const value = parsed.value as Record<string, unknown>
  for (const key of [
    'applicability',
    'value_discriminators_v1',
    'mcp_surface',
    'scope',
    'selection',
    'runtime_validation',
    'mcp_local_closure',
    'ownership',
    'diagnostics',
    'coverage',
  ]) {
    if (!record(value[key])) return invalid(`Resource resolution artifact is missing ${key}.`)
  }
  const rules = value.candidate_rules
  if (!record(rules) || !record(rules['compiler-source']) || !record(rules.runtime))
    return invalid('Resource candidate rules must distinguish compilation and runtime.')
  const compiler = rules['compiler-source']
  const runtime = rules.runtime
  if (
    !operations(compiler.command) ||
    !operations(compiler.mcp) ||
    !record(compiler.script) ||
    Object.keys(compiler.script).length === 0 ||
    !Object.values(compiler.script).every(operations) ||
    !operations(runtime.command) ||
    !operations(runtime.mcp) ||
    !record(runtime.script) ||
    runtime.script.operation !== 'append-suffix' ||
    runtime.script.explicit_suffix !== 'identity-only'
  )
    return invalid('Resource candidate rules contain unsupported operations.')
  if (
    !Array.isArray(value.surfaces) ||
    value.surfaces.length === 0 ||
    !value.surfaces.every(
      (surface) =>
        record(surface) &&
        typeof surface.relative_path === 'string' &&
        typeof surface.lookup_kind === 'string' &&
        Object.hasOwn(compiler, surface.lookup_kind),
    )
  )
    return invalid('Resource reference surfaces must select declared lookup rules.')
  return { ok: true, contract: freezePackageValue(value as unknown as ResourceResolutionContract) }
}

export async function loadResourceResolutionVectors(
  bytes: Uint8Array,
  source: PackageContractSource,
): Promise<Result<'vectors', ResourceResolutionVectors>> {
  const parsed = await verifiedPackageJson(bytes, source, 8 * 1024 * 1024)
  if (!parsed.ok) return parsed
  const issue = identity(parsed.value)
  if (issue) return issue
  const value = parsed.value as Record<string, unknown>
  for (const key of ['lookup', 'compilation', 'discriminator', 'mcp_candidates', 'admission', 'filesystem_recipes']) {
    const family = value[key]
    if (!Array.isArray(family) || family.length === 0 || !family.every(record))
      return invalid(`Resource resolution vectors are missing ${key}.`)
  }
  return { ok: true, vectors: freezePackageValue(value as unknown as ResourceResolutionVectors) }
}
