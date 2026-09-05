import { canonicalizeJsonValue } from './canonical-json'
import { sha256Sync } from './sha256-sync'
import type { AuthoringContract, WorkflowProfile } from './types'

export interface ConformanceCase {
  readonly id: string
  readonly profile: WorkflowProfile
  readonly normalizerVersion: number
  readonly definitionYaml: string
  readonly companionYaml?: string
  readonly valid: boolean
  readonly codes: readonly string[]
  readonly diagnostics: readonly unknown[]
  readonly features: readonly string[]
}

export interface ConformanceCorpus {
  readonly formatVersion: 1 | 2
  readonly scannerCases: readonly ScannerConformanceCase[]
  readonly structuredPathCases: readonly ScannerConformanceCase[]
  readonly substitutionCases: readonly ScannerConformanceCase[]
  readonly profile: WorkflowProfile
  readonly normalizerVersion: number
  readonly contractDigest: `sha256:${string}`
  readonly cases: readonly ConformanceCase[]
}

export function loadConformanceCorpus(bytes: Uint8Array, contract: AuthoringContract): ConformanceCorpus {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('The Hermes conformance corpus must be valid UTF-8 JSON.')
  }
  if (
    !isRecord(parsed) ||
    (parsed.format_version !== 1 && parsed.format_version !== 2) ||
    parsed.profile !== contract.profile ||
    parsed.normalizer_version !== contract.normalizer_version
  )
    throw new Error('The Hermes conformance corpus profile or normalizer does not match its paired contract.')
  const identity = isRecord(parsed.contract) ? parsed.contract : null
  if (
    !identity ||
    identity.schema_version !== contract.schema_version ||
    identity.contract_digest !== contract.contract_digest ||
    identity.contract_reader_version !== contract.contract_reader_version ||
    identity.normalizer !== 'plugins.workflow.language.normalize_workflow' ||
    identity.validator !== 'plugins.workflow.schema._compile_workflow_source_document'
  )
    throw new Error('The Hermes conformance corpus contract identity does not match its paired contract.')
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0)
    throw new Error('The Hermes conformance corpus has no cases.')
  const cases = parsed.cases.map(parseCase)
  if (parsed.format_version === 2) {
    if (contract.contract_reader_version !== 3) throw new Error('Scanner corpus requires contract reader 3.')
    const payload = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'corpus_digest'))
    if (parsed.corpus_digest !== `sha256:${sha256Sync(canonicalizeJsonValue(payload))}`)
      throw new Error('The Hermes conformance corpus digest does not match its canonical payload.')
  } else if (contract.contract_reader_version === 3) throw new Error('Reader 3 requires corpus format 2.')
  if (
    cases.some(
      (fixture) => fixture.profile !== contract.profile || fixture.normalizerVersion !== contract.normalizer_version,
    )
  )
    throw new Error('The Hermes conformance corpus case identity does not match its paired contract.')
  if (new Set(cases.map((fixture) => fixture.id)).size !== cases.length)
    throw new Error('The Hermes conformance corpus case IDs must be unique.')
  return Object.freeze({
    formatVersion: parsed.format_version,
    scannerCases: parseScannerCases(parsed, 'scanner_cases'),
    structuredPathCases: parseScannerCases(parsed, 'structured_path_cases'),
    substitutionCases: parseScannerCases(parsed, 'substitution_cases'),
    profile: contract.profile,
    normalizerVersion: contract.normalizer_version,
    contractDigest: contract.contract_digest,
    cases: Object.freeze(cases),
  })
}

export async function loadBundledConformanceCorpora(
  contracts: readonly AuthoringContract[],
): Promise<readonly ConformanceCorpus[]> {
  const sources = import.meta.glob('/contracts/*.corpus.json', {
    eager: true,
    import: 'default',
    query: '?raw',
  }) as Readonly<Record<string, string>>
  const corpora: ConformanceCorpus[] = []
  for (const contract of contracts) {
    const suffix =
      contract.profile === 'archon-2026-07' ? 'archon-2026-07-v6.corpus.json' : 'hermes-legacy-v2.corpus.json'
    const source = Object.entries(sources).find(([identifier]) => identifier.endsWith(`/${suffix}`))?.[1]
    if (!source) throw new Error(`Missing bundled Hermes conformance corpus for ${contract.profile}.`)
    corpora.push(loadConformanceCorpus(new TextEncoder().encode(source), contract))
  }
  return Object.freeze(corpora)
}

function parseCase(value: unknown): ConformanceCase {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isProfile(value.profile) ||
    !positive(value.normalizer_version) ||
    typeof value.definition_yaml !== 'string' ||
    (value.companion_yaml !== null && value.companion_yaml !== undefined && typeof value.companion_yaml !== 'string') ||
    typeof value.valid !== 'boolean' ||
    !stringArray(value.codes) ||
    !Array.isArray(value.diagnostics) ||
    !stringArray(value.features)
  )
    throw new Error('The Hermes conformance corpus contains an invalid case.')
  return Object.freeze({
    id: value.id,
    profile: value.profile,
    normalizerVersion: value.normalizer_version,
    definitionYaml: value.definition_yaml,
    ...(typeof value.companion_yaml === 'string' ? { companionYaml: value.companion_yaml } : {}),
    valid: value.valid,
    codes: value.codes,
    diagnostics: value.diagnostics,
    features: value.features,
  })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isProfile(value: unknown): value is WorkflowProfile {
  return value === 'archon-2026-07' || value === 'hermes-legacy'
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export interface ScannerConformanceCase {
  readonly id: string
  readonly api: string
  readonly input: Readonly<Record<string, unknown>>
  readonly normalizer_version: number | boolean
  readonly unicode_profiles: readonly string[]
  readonly requirements: readonly string[]
  readonly expected: Readonly<Record<string, unknown>>
}
function parseScannerCases(corpus: Record<string, unknown>, key: string): readonly ScannerConformanceCase[] {
  if (corpus.format_version === 1) return []
  const cases = corpus[key]
  if (!Array.isArray(cases) || !cases.length) throw new Error(`Missing scanner corpus section ${key}.`)
  for (const value of cases) {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.api !== 'string' ||
      !isRecord(value.input) ||
      !isRecord(value.expected) ||
      !stringArray(value.unicode_profiles) ||
      !stringArray(value.requirements) ||
      !['number', 'boolean'].includes(typeof value.normalizer_version)
    )
      throw new Error(`Invalid scanner corpus case in ${key}.`)
  }
  if (new Set(cases.map((value) => value.id)).size !== cases.length) throw new Error('Scanner case IDs must be unique.')
  return Object.freeze(cases as ScannerConformanceCase[])
}
