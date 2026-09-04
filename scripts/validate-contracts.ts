import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sha256Hex } from '../src/lib/contract/canonical-json'
import { loadConformanceCorpus } from '../src/lib/contract/conformance'
import { loadAuthoringContract } from '../src/lib/contract/contract-loader'
import type { WorkflowProfile } from '../src/lib/contract/types'
import { compareCodePoints, deterministicJson } from './sync-contracts'

const profiles = ['archon-2026-07', 'hermes-legacy'] as const

export async function validateContractResources(directory = resolve('contracts')): Promise<readonly string[]> {
  const errors: string[] = []
  let manifest: unknown
  try {
    const text = await readFile(join(directory, 'manifest.json'), 'utf8')
    manifest = JSON.parse(text)
    if (text !== deterministicJson(manifest)) errors.push('manifest.json: deterministic JSON drift detected.')
  } catch (error) {
    return [`manifest.json: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (!isRecord(manifest) || typeof manifest.generated_at !== 'string' || !Array.isArray(manifest.contracts))
    return ['manifest.json: invalid manifest shape.']
  const date = new Date(manifest.generated_at)
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== manifest.generated_at)
    errors.push('manifest.json: generated_at must be an exact ISO timestamp.')
  const entries = manifest.contracts
  const sorted = [...entries].sort((left, right) => compareCodePoints(profileOf(left), profileOf(right)))
  if (JSON.stringify(entries) !== JSON.stringify(sorted))
    errors.push('manifest.json: contracts must be profile-sorted.')
  if (entries.length !== profiles.length)
    errors.push(`manifest.json: expected exactly ${profiles.length} paired resources.`)
  for (const profile of profiles)
    await validatePair(
      directory,
      profile,
      entries.filter((entry) => profileOf(entry) === profile),
      errors,
    )
  for (const entry of entries) {
    const profile = profileOf(entry)
    if (!profiles.includes(profile as (typeof profiles)[number]))
      errors.push(`manifest.json: unexpected profile ${profile || '<missing>'}.`)
    else if (
      !isRecord(entry) ||
      typeof entry.file !== 'string' ||
      !new RegExp(`^${profile}-v\\d+\\.json$`).test(entry.file)
    )
      errors.push(`manifest.json: unexpected file ${isRecord(entry) ? String(entry.file) : '<missing>'}.`)
  }
  return errors
}

async function validatePair(
  directory: string,
  profile: WorkflowProfile,
  entries: unknown[],
  errors: string[],
): Promise<void> {
  if (entries.length !== 1) {
    errors.push(`manifest.json: expected exactly one ${profile} entry.`)
    return
  }
  const entry = entries[0]
  if (
    !isRecord(entry) ||
    typeof entry.file !== 'string' ||
    typeof entry.corpus_file !== 'string' ||
    typeof entry.corpus_digest !== 'string'
  ) {
    errors.push(`manifest.json: invalid ${profile} pairing metadata.`)
    return
  }
  try {
    const contractBytes = await readFile(join(directory, entry.file))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(contractBytes)
    const parsed = JSON.parse(text)
    if (text !== canonicalArtifactJson(parsed)) errors.push(`${entry.file}: canonical JSON drift detected.`)
    const loaded = await loadAuthoringContract(contractBytes, { kind: 'bundled', identifier: entry.file })
    if (!loaded.ok) {
      errors.push(`${entry.file}: ${loaded.code}: ${loaded.message}`)
      return
    }
    const expected = {
      file: entry.file,
      corpus_file: entry.corpus_file,
      corpus_digest: entry.corpus_digest,
      profile,
      schema_version: loaded.contract.schema_version,
      normalizer_version: loaded.contract.normalizer_version,
      contract_digest: loaded.contract.contract_digest,
    }
    if (
      Object.keys(expected).some((key) => entry[key] !== expected[key as keyof typeof expected]) ||
      Object.keys(entry).length !== Object.keys(expected).length
    )
      errors.push(`manifest.json: ${profile} metadata drift.`)
    const corpusBytes = await readFile(join(directory, entry.corpus_file))
    const corpusText = new TextDecoder('utf-8', { fatal: true }).decode(corpusBytes)
    const corpusParsed = JSON.parse(corpusText)
    if (corpusText !== canonicalArtifactJson(corpusParsed))
      errors.push(`${entry.corpus_file}: canonical JSON drift detected.`)
    const digest = `sha256:${await sha256Hex(canonicalArtifactText(corpusText))}`
    if (digest !== entry.corpus_digest) errors.push(`${entry.corpus_file}: digest does not match manifest.`)
    loadConformanceCorpus(corpusBytes, loaded.contract)
  } catch (error) {
    errors.push(`${profile}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function canonicalArtifactJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value))}\n`
}
function canonicalArtifactText(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, sortJson(child)]),
  )
}
function profileOf(value: unknown): string {
  return isRecord(value) && typeof value.profile === 'string' ? value.profile : ''
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
async function main(): Promise<void> {
  const errors = await validateContractResources()
  if (errors.length > 0) throw new Error(errors.join('\n'))
  process.stdout.write('Validated bundled authoring contracts and conformance corpora.\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
