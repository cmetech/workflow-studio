import { canonicalizeJsonValue, sha256Hex } from './canonical-json'
import { loadAuthoringContract } from './contract-loader'
import type { AuthoringContract, WorkflowProfile } from './types'

const MAX_MANIFEST_BYTES = 128 * 1024
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024
const MAX_CONTRACTS = 16
const SAFE_JSON_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u
const SHA256 = /^sha256:[0-9a-f]{64}$/u

export interface BundledCorpusResource {
  readonly profile: WorkflowProfile
  readonly normalizerVersion: number
  readonly contract: AuthoringContract
  readonly text: string
  readonly digest: `sha256:${string}`
  readonly file: string
}

export interface BundledResourceSet {
  readonly contracts: readonly AuthoringContract[]
  readonly corpusResources: readonly BundledCorpusResource[]
}

interface ManifestEntry {
  readonly profile: WorkflowProfile
  readonly schemaVersion: number
  readonly normalizerVersion: number
  readonly contractDigest: `sha256:${string}`
  readonly corpusDigest: `sha256:${string}`
  readonly file: string
  readonly corpusFile: string
}

export async function loadBundledResourceSet(
  manifestText: string,
  readResource: (file: string) => string | Promise<string>,
): Promise<BundledResourceSet> {
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES)
    throw new Error('The bundled contract manifest exceeds its maximum size.')
  const entries = parseManifest(manifestText)
  const contracts: AuthoringContract[] = []
  const corpusResources: BundledCorpusResource[] = []

  for (const entry of entries) {
    const contractText = await boundedRead(readResource, entry.file)
    const loaded = await loadAuthoringContract(new TextEncoder().encode(contractText), {
      kind: 'bundled',
      identifier: entry.file,
    })
    if (!loaded.ok) throw new Error(`${entry.file}: ${loaded.message}`)
    const contract = loaded.contract
    if (
      contract.profile !== entry.profile ||
      contract.schema_version !== entry.schemaVersion ||
      contract.normalizer_version !== entry.normalizerVersion ||
      contract.contract_digest !== entry.contractDigest
    )
      throw new Error(
        `${entry.file}: contract profile, schema, normalizer, or digest does not match its manifest entry.`,
      )

    const corpusText = await boundedRead(readResource, entry.corpusFile)
    const corpus = parseJsonObject(corpusText, entry.corpusFile)
    const corpusDigest = `sha256:${await sha256Hex(canonicalizeJsonValue(corpus))}` as const
    if (corpusDigest !== entry.corpusDigest)
      throw new Error(`${entry.corpusFile}: corpus digest does not match its manifest entry.`)
    if (corpus.profile !== entry.profile || corpus.normalizer_version !== entry.normalizerVersion)
      throw new Error(`${entry.corpusFile}: corpus profile or normalizer does not match its manifest entry.`)
    const identity = isRecord(corpus.contract) ? corpus.contract : undefined
    if (
      !identity ||
      identity.contract_digest !== entry.contractDigest ||
      identity.schema_version !== entry.schemaVersion ||
      identity.contract_reader_version !== contract.contract_reader_version ||
      identity.normalizer !== 'plugins.workflow.language.normalize_workflow' ||
      identity.validator !== 'plugins.workflow.schema._compile_workflow_source_document'
    )
      throw new Error(`${entry.corpusFile}: corpus contract identity does not match its manifest entry.`)

    contracts.push(contract)
    corpusResources.push({
      profile: entry.profile,
      normalizerVersion: entry.normalizerVersion,
      contract,
      text: corpusText,
      digest: entry.corpusDigest,
      file: entry.corpusFile,
    })
  }

  return Object.freeze({ contracts: Object.freeze(contracts), corpusResources: Object.freeze(corpusResources) })
}

function parseManifest(text: string): readonly ManifestEntry[] {
  const manifest = parseJsonObject(text, 'manifest.json')
  if (
    !Array.isArray(manifest.contracts) ||
    manifest.contracts.length === 0 ||
    manifest.contracts.length > MAX_CONTRACTS
  )
    throw new Error(`The bundled contract manifest must contain between 1 and ${MAX_CONTRACTS} contracts.`)
  const profiles = new Set<string>()
  const files = new Set<string>()
  const entries: ManifestEntry[] = []
  for (const value of manifest.contracts) {
    if (!isRecord(value)) throw new Error('The bundled contract manifest contains an invalid entry.')
    const profile = value.profile
    const file = value.file
    const corpusFile = value.corpus_file
    if (profile !== 'archon-2026-07' && profile !== 'hermes-legacy')
      throw new Error('The bundled contract manifest contains an unsupported profile.')
    if (typeof file !== 'string' || !SAFE_JSON_BASENAME.test(file) || file.endsWith('.corpus.json'))
      throw new Error('Contract resources must use a safe JSON basename.')
    if (typeof corpusFile !== 'string' || !SAFE_JSON_BASENAME.test(corpusFile) || !corpusFile.endsWith('.corpus.json'))
      throw new Error('Corpus resources must use a safe JSON basename.')
    if (profiles.has(profile)) throw new Error('Bundled contract manifest profiles must be unique.')
    if (files.has(file) || files.has(corpusFile) || file === corpusFile)
      throw new Error('Bundled contract manifest files must be unique.')
    if (
      !positiveInteger(value.schema_version) ||
      !positiveInteger(value.normalizer_version) ||
      typeof value.contract_digest !== 'string' ||
      !SHA256.test(value.contract_digest) ||
      typeof value.corpus_digest !== 'string' ||
      !SHA256.test(value.corpus_digest)
    )
      throw new Error('The bundled contract manifest contains an invalid identity.')
    profiles.add(profile)
    files.add(file)
    files.add(corpusFile)
    entries.push({
      profile,
      schemaVersion: value.schema_version,
      normalizerVersion: value.normalizer_version,
      contractDigest: value.contract_digest as `sha256:${string}`,
      corpusDigest: value.corpus_digest as `sha256:${string}`,
      file,
      corpusFile,
    })
  }
  return entries
}

async function boundedRead(readResource: (file: string) => string | Promise<string>, file: string): Promise<string> {
  const text = await readResource(file)
  if (typeof text !== 'string') throw new Error(`Bundled resource ${file} must be UTF-8 text.`)
  if (new TextEncoder().encode(text).byteLength > MAX_RESOURCE_BYTES)
    throw new Error(`Bundled resource ${file} exceeds its maximum size.`)
  return text
}

function parseJsonObject(text: string, file: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error(`Bundled resource ${file} must be valid JSON.`)
  }
  if (!isRecord(parsed)) throw new Error(`Bundled resource ${file} must contain a JSON object.`)
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
