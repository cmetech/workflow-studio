import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { loadAuthoringContract } from '../src/lib/contract/contract-loader'
import type { AuthoringContract, WorkflowProfile } from '../src/lib/contract/types'

const runFile = promisify(execFile)
const profiles = ['hermes-legacy', 'archon-2026-07'] as const

export type SyncSource =
  | { readonly kind: 'cli'; readonly command: string }
  | { readonly kind: 'files'; readonly files: Readonly<Record<WorkflowProfile, string>> }

export interface SyncOptions {
  readonly source: SyncSource
  readonly generatedAt: string
  readonly outputDirectory: string
}

export function parseSyncArguments(arguments_: readonly string[]): SyncOptions {
  let hermesCommand: string | undefined
  const contractFiles = new Map<WorkflowProfile, string>()
  let generatedAt: string | undefined
  let outputDirectory = resolve('contracts')

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (!value) throw new TypeError(`${argument ?? 'argument'} requires a value.`)
    if (argument === '--hermes-command') hermesCommand = absolutePath(value, argument)
    else if (argument === '--contract-file') {
      const separator = value.indexOf('=')
      const profile = value.slice(0, separator) as WorkflowProfile
      const path = value.slice(separator + 1)
      if (separator < 1 || !profiles.includes(profile))
        throw new TypeError(`Invalid --contract-file profile: ${value}.`)
      if (contractFiles.has(profile)) throw new TypeError(`Duplicate --contract-file for ${profile}.`)
      contractFiles.set(profile, absolutePath(path, argument))
    } else if (argument === '--generated-at') generatedAt = value
    else if (argument === '--output-dir') outputDirectory = absolutePath(value, argument)
    else throw new TypeError(`Unknown argument: ${argument}.`)
    index += 1
  }

  if (!generatedAt) throw new TypeError('--generated-at is required for reproducible contract resources.')
  const parsedDate = new Date(generatedAt)
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString() !== generatedAt) {
    throw new TypeError('--generated-at must be an exact ISO timestamp.')
  }
  if (hermesCommand && contractFiles.size > 0) {
    throw new TypeError('--hermes-command and --contract-file are mutually exclusive.')
  }
  if (!hermesCommand && contractFiles.size === 0) {
    throw new TypeError('Supply an explicit --hermes-command or both --contract-file arguments.')
  }
  if (contractFiles.size > 0 && profiles.some((profile) => !contractFiles.has(profile))) {
    throw new TypeError('Both hermes-legacy and archon-2026-07 --contract-file inputs are required.')
  }

  return {
    source: hermesCommand
      ? { kind: 'cli', command: hermesCommand }
      : { kind: 'files', files: Object.fromEntries(contractFiles) as Record<WorkflowProfile, string> },
    generatedAt,
    outputDirectory,
  }
}

export async function syncContracts(options: SyncOptions): Promise<void> {
  const candidates = await Promise.all(
    profiles.map(async (profile) => {
      const bytes = await readCandidate(options.source, profile)
      const loaded = await loadAuthoringContract(bytes, {
        kind: 'user',
        identifier: `${options.source.kind}:${profile}`,
      })
      if (!loaded.ok) throw new TypeError(`${profile} contract is invalid: ${loaded.message}`)
      if (loaded.contract.profile !== profile) {
        throw new TypeError(`${profile} source emitted ${loaded.contract.profile}.`)
      }
      return {
        profile,
        contract: loaded.contract,
        text: deterministicJson(JSON.parse(new TextDecoder().decode(bytes))),
      }
    }),
  )

  const manifest = {
    generated_at: options.generatedAt,
    contracts: candidates
      .map(({ profile, contract }) => manifestEntry(profile, contract))
      .sort((left, right) => left.profile.localeCompare(right.profile)),
  }
  const resources = new Map<string, string>([
    ...candidates.map(({ profile, text }) => [`${profile}-v1.json`, text] as const),
    ['manifest.json', deterministicJson(manifest)],
  ])

  await mkdir(options.outputDirectory, { recursive: true })
  const staging = join(options.outputDirectory, `.sync-${process.pid}-${Date.now()}`)
  await mkdir(staging)
  try {
    await Promise.all([...resources].map(([file, text]) => writeFile(join(staging, file), text, { flag: 'wx' })))
    for (const file of [...resources.keys()].sort())
      await rename(join(staging, file), join(options.outputDirectory, file))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function manifestEntry(profile: WorkflowProfile, contract: AuthoringContract) {
  return {
    file: `${profile}-v1.json`,
    profile,
    schema_version: contract.schema_version,
    normalizer_version: contract.normalizer_version,
    contract_digest: contract.contract_digest,
  }
}

async function readCandidate(source: SyncSource, profile: WorkflowProfile): Promise<Uint8Array> {
  if (source.kind === 'files') return readFile(source.files[profile])
  try {
    const { stdout } = await runFile(source.command, ['workflow', 'schema', '--profile', profile, '--json'], {
      encoding: 'buffer',
      maxBuffer: 512 * 1024,
      windowsHide: true,
    })
    return Uint8Array.from(stdout)
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? Buffer.from((error as { stderr: Uint8Array }).stderr)
            .toString('utf8')
            .trim()
        : ''
    throw new Error(`Hermes failed to emit ${profile}${stderr ? `: ${stderr}` : '.'}`, { cause: error })
  }
}

export function deterministicJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  )
}

function absolutePath(value: string, flag: string): string {
  if (!isAbsolute(value)) throw new TypeError(`${flag} requires an absolute path.`)
  return value
}

async function main(): Promise<void> {
  await syncContracts(parseSyncArguments(process.argv.slice(2)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
