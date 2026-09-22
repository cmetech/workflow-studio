import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import { packagePathError } from './paths'

type Rule = Readonly<Record<string, unknown>>
export interface ResourceFile {
  readonly kind: 'file' | 'directory' | 'symlink'
  readonly cached?: boolean
}
export interface ResourceResolutionContext {
  readonly version: number
  readonly profile: string
  readonly normalizer_version: number
  readonly origins_supplied: boolean
  readonly host_python_supplied: boolean
  readonly host_sensitive_mcp_candidates?: boolean
}
type ResolutionFailure = { readonly code: string }

function record(value: unknown): value is Rule {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function strings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
function diagnostic(contract: ResourceResolutionContract, key: string): string {
  const value = record(contract.diagnostics) ? contract.diagnostics[key] : undefined
  return typeof value === 'string' ? value : 'unsupported_resource_contract'
}

export function admitResourceResolution(
  contract: ResourceResolutionContract,
  context: ResourceResolutionContext,
): string | null {
  if (context.version !== 1 || contract.contract_version !== 1) return diagnostic(contract, 'unsupported_contract')
  const compiler = record(contract.applicability) ? contract.applicability['compiler-source'] : undefined
  const admission = contract.admission
  if (
    !record(compiler) ||
    !record(admission) ||
    !Array.isArray(compiler.normalizer_versions) ||
    admission.origins_required !== true ||
    !record(admission.host_python_identity_required_when)
  )
    return diagnostic(contract, 'unsupported_contract')
  if (context.profile !== compiler.profile || !compiler.normalizer_versions.includes(context.normalizer_version))
    return diagnostic(contract, 'unsupported_profile_or_version')
  const host = admission.host_python_identity_required_when
  if (!Array.isArray(host.normalizer_versions) || host.host_sensitive_mcp_candidates !== true)
    return diagnostic(contract, 'unsupported_contract')
  if (
    !context.origins_supplied ||
    (context.host_sensitive_mcp_candidates === true &&
      host.normalizer_versions.includes(context.normalizer_version) &&
      !context.host_python_supplied)
  )
    return diagnostic(contract, 'unsupported_context')
  return null
}

/** Candidate-stage interpreter only; callers must admit the workflow/profile and supply a bounded file snapshot. */
export function resolveCompilerResource(input: {
  readonly contract: ResourceResolutionContract
  readonly kind: string
  readonly reference: string
  readonly runtime?: string
  readonly files: ReadonlyMap<string, ResourceFile>
}): { readonly path: string } | ResolutionFailure {
  const { contract, kind, reference, runtime, files } = input
  const selection = record(contract.selection) ? contract.selection['compiler-source'] : undefined
  if (
    !record(selection) ||
    selection.accept !== 'first-cached-or-exists-or-symlink' ||
    selection.validation !== 'after-selection' ||
    selection.unsafe !== 'reject-no-fallback' ||
    selection.containment !== 'owning-source-package-root'
  )
    return { code: diagnostic(contract, 'unsupported_contract') }
  if (packagePathError(reference) || reference.startsWith('~')) return { code: diagnostic(contract, 'compiler_unsafe') }
  const compiler: Rule = contract.candidate_rules['compiler-source']
  if (!Object.hasOwn(compiler, kind)) return { code: diagnostic(contract, 'unsupported_context') }
  let operations = compiler[kind]
  if (record(operations)) {
    if (!runtime || !Object.hasOwn(operations, runtime)) return { code: diagnostic(contract, 'unsupported_context') }
    operations = operations[runtime]
  }
  if (!Array.isArray(operations) || operations.length === 0)
    return { code: diagnostic(contract, 'unsupported_contract') }
  const candidates: string[] = []
  for (const operation of operations) {
    if (
      !record(operation) ||
      typeof operation.directory !== 'string' ||
      typeof operation.suffix !== 'string' ||
      (operation.directory !== '' && packagePathError(operation.directory))
    )
      return { code: diagnostic(contract, 'unsupported_contract') }
    const base = operation.directory ? `${operation.directory}/${reference}` : reference
    if (operation.operation === 'identity' && operation.suffix === '') candidates.push(base)
    else if (operation.operation === 'replace-suffix' && /^\.[a-z]+$/.test(operation.suffix)) {
      // The exported suffix baseline is pathlib on Python 3.11: a trailing dot is not a suffix.
      const slash = base.lastIndexOf('/')
      const dot = base.lastIndexOf('.')
      candidates.push(`${dot > slash + 1 && dot < base.length - 1 ? base.slice(0, dot) : base}${operation.suffix}`)
    } else return { code: diagnostic(contract, 'unsupported_contract') }
  }
  for (const path of candidates) {
    const entry = files.get(path)
    if (!entry) continue
    const parents = path.split('/').slice(0, -1)
    const unsafeParent = parents.some((_, index) => {
      const parent = files.get(parents.slice(0, index + 1).join('/'))
      return parent !== undefined && parent.kind !== 'directory'
    })
    if (entry.kind !== 'file' || unsafeParent || packagePathError(path))
      return { code: diagnostic(contract, 'compiler_unsafe') }
    return { path }
  }
  const missing = record(contract.diagnostics) ? contract.diagnostics.compiler_missing : undefined
  return {
    code:
      record(missing) && typeof missing[kind] === 'string'
        ? missing[kind]
        : diagnostic(contract, 'unsupported_contract'),
  }
}

export function interpretResourceDiscriminator(rule: unknown, value: string): boolean | null {
  if (
    !record(rule) ||
    rule.operation !== 'contains-listed-codepoint' ||
    typeof rule.characters !== 'string' ||
    !Array.isArray(rule.codepoint_ranges) ||
    rule.match !== 'reference-template' ||
    rule.otherwise !== 'literal-resource-name'
  )
    return null
  const ranges: readonly unknown[] = rule.codepoint_ranges
  if (
    !ranges.every(
      (range) =>
        Array.isArray(range) &&
        range.length === 2 &&
        Number.isInteger(range[0]) &&
        Number.isInteger(range[1]) &&
        range[0] >= 0 &&
        range[1] <= 0x10ffff &&
        range[0] <= range[1],
    )
  )
    return null
  const characters = new Set(rule.characters)
  return Array.from(value).some((character) => {
    if (characters.has(character)) return true
    const point = character.codePointAt(0)!
    return ranges.some((range) => {
      const [start, end] = range as [number, number]
      return point >= start && point <= end
    })
  })
}

/** Visits data only. Budgets bound analysis, rather than redefining the package's permitted YAML shape. */
export function collectMcpCandidates(
  contract: ResourceResolutionContract,
  document: unknown,
  budget: { readonly maxEntries?: number; readonly maxDepth?: number } = {},
): { readonly candidates: readonly string[] } | ResolutionFailure {
  const rule = contract.mcp_local_closure
  if (
    !record(rule) ||
    rule.traversal !== 'mapping-values-and-sequence-items-depth-first' ||
    !strings(rule.candidates) ||
    rule.candidates.join('|') !== 'whole-string|substring-after-first-equals-if-starts-with-dash' ||
    rule.ignore_empty !== true ||
    !strings(rule.ignore_prefixes)
  )
    return { code: diagnostic(contract, 'unsupported_contract') }
  const prefixes = rule.ignore_prefixes
  const maxEntries = budget.maxEntries ?? 1024 * 1024
  const maxDepth = budget.maxDepth ?? 512
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1)
    return { code: 'resource_resolution_limit' }
  const ancestors = new Set<object>()
  const candidates: string[] = []
  let entries = 0
  function visit(value: unknown, depth: number): boolean {
    if (++entries > maxEntries || depth > maxDepth) return false
    if (typeof value === 'string') {
      const values = [value]
      if (value.startsWith('-') && value.includes('=')) values.push(value.slice(value.indexOf('=') + 1))
      for (const candidate of values)
        if (candidate && !prefixes.some((prefix) => candidate.startsWith(prefix))) candidates.push(candidate)
    } else if (Array.isArray(value) || record(value)) {
      if (ancestors.has(value)) return false
      ancestors.add(value)
      for (const child of Object.values(value)) if (!visit(child, depth + 1)) return false
      ancestors.delete(value)
    }
    return true
  }
  return visit(document, 0) ? { candidates: Object.freeze(candidates) } : { code: 'resource_resolution_limit' }
}
