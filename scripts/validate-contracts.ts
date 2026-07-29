import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadAuthoringContract } from '../src/lib/contract/contract-loader'
import type { WorkflowProfile } from '../src/lib/contract/types'
import { compareCodePoints, deterministicJson } from './sync-contracts'

const profiles = ['archon-2026-07', 'hermes-legacy'] as const

export async function validateContractResources(directory = resolve('contracts')): Promise<readonly string[]> {
  const errors: string[] = []
  const loaded = new Map<
    WorkflowProfile,
    { file: string; contract: Awaited<ReturnType<typeof loadAuthoringContract>> }
  >()
  for (const profile of profiles) {
    const file = `${profile}-v1.json`
    try {
      const bytes = await readFile(join(directory, file))
      const result = await loadAuthoringContract(bytes, { kind: 'bundled', identifier: file })
      loaded.set(profile, { file, contract: result })
      if (!result.ok) errors.push(`${file}: ${result.code}: ${result.message}`)
      else if (result.contract.profile !== profile) errors.push(`${file}: profile is ${result.contract.profile}.`)
      const text = new TextDecoder().decode(bytes)
      const parsed: unknown = JSON.parse(text)
      if (text !== deterministicJson(parsed)) errors.push(`${file}: deterministic JSON drift detected.`)
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    const manifestText = await readFile(join(directory, 'manifest.json'), 'utf8')
    const manifest: unknown = JSON.parse(manifestText)
    if (manifestText !== deterministicJson(manifest)) errors.push('manifest.json: deterministic JSON drift detected.')
    if (!isRecord(manifest) || typeof manifest.generated_at !== 'string' || !Array.isArray(manifest.contracts)) {
      errors.push('manifest.json: invalid manifest shape.')
    } else {
      const generated = new Date(manifest.generated_at)
      if (Number.isNaN(generated.valueOf()) || generated.toISOString() !== manifest.generated_at) {
        errors.push('manifest.json: generated_at must be an exact ISO timestamp.')
      }
      const entries = manifest.contracts
      const sorted = [...entries].sort((left, right) => compareCodePoints(profileOf(left), profileOf(right)))
      if (JSON.stringify(entries) !== JSON.stringify(sorted))
        errors.push('manifest.json: contracts must be profile-sorted.')
      if (entries.length !== profiles.length) {
        errors.push(`manifest.json: expected exactly ${profiles.length} contract resources.`)
      }
      for (const entry of entries) {
        const profile = profileOf(entry)
        if (!profiles.includes(profile as (typeof profiles)[number])) {
          errors.push(`manifest.json: unexpected profile ${profile || '<missing>'}.`)
          continue
        }
        if (!isRecord(entry) || entry.file !== `${profile}-v1.json`) {
          errors.push(`manifest.json: unexpected file ${isRecord(entry) ? String(entry.file) : '<missing>'}.`)
        }
      }
      for (const profile of profiles) {
        const resource = loaded.get(profile)
        const contract = resource?.contract
        const matching = entries.filter((candidate) => profileOf(candidate) === profile)
        if (matching.length !== 1) {
          errors.push(`manifest.json: expected exactly one ${profile} entry.`)
        }
        const entry = matching[0]
        if (!isRecord(entry) || !contract?.ok) {
          errors.push(`manifest.json: missing valid ${profile} entry.`)
          continue
        }
        const expected = {
          file: resource.file,
          profile,
          schema_version: contract.contract.schema_version,
          normalizer_version: contract.contract.normalizer_version,
          contract_digest: contract.contract.contract_digest,
        }
        if (
          Object.keys(expected).some((key) => entry[key] !== expected[key as keyof typeof expected]) ||
          Object.keys(entry).length !== Object.keys(expected).length
        ) {
          errors.push(`manifest.json: ${profile} metadata drift.`)
        }
      }
    }
  } catch (error) {
    errors.push(`manifest.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  return errors
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
  process.stdout.write('Validated bundled authoring contracts.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
