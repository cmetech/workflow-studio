import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { sha256Hex } from '../src/lib/contract/canonical-json'
import { loadConformanceCorpus } from '../src/lib/contract/conformance'
import { loadAuthoringContract } from '../src/lib/contract/contract-loader'
import type { AuthoringContract, WorkflowProfile } from '../src/lib/contract/types'

const runFile = promisify(execFile)
const profiles = ['hermes-legacy', 'archon-2026-07'] as const
type ContractFiles = Readonly<Record<WorkflowProfile, string>>
export type SyncSource =
  | { readonly kind: 'cli'; readonly command: string }
  | { readonly kind: 'files'; readonly contracts: ContractFiles; readonly corpora: ContractFiles }
export interface SyncOptions {
  readonly source: SyncSource
  readonly generatedAt: string
  readonly outputDirectory: string
}
export interface SyncFileOperations {
  readonly rename: (from: string, to: string) => Promise<void>
}
const defaultFileOperations: SyncFileOperations = { rename }

export function parseSyncArguments(arguments_: readonly string[]): SyncOptions {
  let command: string | undefined
  const contracts = new Map<WorkflowProfile, string>()
  const corpora = new Map<WorkflowProfile, string>()
  let generatedAt: string | undefined
  let outputDirectory = resolve('contracts')
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (!value) throw new TypeError(`${argument ?? 'argument'} requires a value.`)
    if (argument === '--hermes-command') command = absolutePath(value, argument)
    else if (argument === '--contract-file') addProfileFile(contracts, value, argument)
    else if (argument === '--corpus-file') addProfileFile(corpora, value, argument)
    else if (argument === '--generated-at') generatedAt = value
    else if (argument === '--output-dir') outputDirectory = absolutePath(value, argument)
    else throw new TypeError(`Unknown argument: ${argument}.`)
    index += 1
  }
  if (!generatedAt) throw new TypeError('--generated-at is required for reproducible contract resources.')
  const date = new Date(generatedAt)
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== generatedAt)
    throw new TypeError('--generated-at must be an exact ISO timestamp.')
  if (command && (contracts.size > 0 || corpora.size > 0))
    throw new TypeError('--hermes-command and file inputs are mutually exclusive.')
  if (!command && (contracts.size !== profiles.length || corpora.size !== profiles.length))
    throw new TypeError('Both contract and corpus inputs are required for hermes-legacy and archon-2026-07.')
  return {
    source: command
      ? { kind: 'cli', command }
      : {
          kind: 'files',
          contracts: Object.fromEntries(contracts) as ContractFiles,
          corpora: Object.fromEntries(corpora) as ContractFiles,
        },
    generatedAt,
    outputDirectory,
  }
}

export async function syncContracts(
  options: SyncOptions,
  fileOperations: SyncFileOperations = defaultFileOperations,
): Promise<void> {
  const candidates = await Promise.all(
    profiles.map(async (profile) => {
      const contractBytes = await readCandidate(options.source, profile, 'contract')
      const loaded = await loadAuthoringContract(contractBytes, {
        kind: 'user',
        identifier: `${options.source.kind}:${profile}`,
      })
      if (!loaded.ok) throw new TypeError(`${profile} contract is invalid: ${loaded.message}`)
      if (loaded.contract.profile !== profile)
        throw new TypeError(`${profile} source emitted ${loaded.contract.profile}.`)
      const corpusBytes = await readCandidate(options.source, profile, 'corpus')
      const corpus = loadConformanceCorpus(corpusBytes, loaded.contract)
      return {
        profile,
        contract: loaded.contract,
        corpus,
        contractText: generatedArtifactText(contractBytes),
        corpusText: generatedArtifactText(corpusBytes),
      }
    }),
  )
  const entries = await Promise.all(
    candidates.map(async ({ profile, contract, corpus, corpusText }) =>
      manifestEntry(profile, contract, corpus.normalizerVersion, await sha256Hex(canonicalArtifactText(corpusText))),
    ),
  )
  const manifest = {
    generated_at: options.generatedAt,
    contracts: entries.sort((left, right) => compareCodePoints(left.profile, right.profile)),
  }
  const resources = new Map<string, string>([
    ...(await retainedResources(options.outputDirectory)),
    ...candidates.flatMap(({ profile, contract, corpus, contractText, corpusText }) => [
      [`${profile}-v${contract.normalizer_version}.json`, contractText] as const,
      [`${profile}-v${corpus.normalizerVersion}.corpus.json`, corpusText] as const,
    ]),
    ['manifest.json', deterministicJson(manifest)],
  ])
  await replaceDirectory(resources, options.outputDirectory, fileOperations)
}

async function manifestEntry(
  profile: WorkflowProfile,
  contract: AuthoringContract,
  corpusNormalizerVersion: number,
  corpusDigest: string,
) {
  return {
    file: `${profile}-v${contract.normalizer_version}.json`,
    corpus_file: `${profile}-v${corpusNormalizerVersion}.corpus.json`,
    corpus_digest: `sha256:${corpusDigest}`,
    profile,
    schema_version: contract.schema_version,
    normalizer_version: contract.normalizer_version,
    contract_digest: contract.contract_digest,
  }
}

async function replaceDirectory(
  resources: ReadonlyMap<string, string>,
  outputDirectory: string,
  fileOperations: SyncFileOperations,
): Promise<void> {
  const parent = dirname(outputDirectory)
  const name = basename(outputDirectory)
  const id = `${process.pid}-${Date.now()}`
  const staging = join(parent, `.${name}.sync-${id}`)
  const backup = join(parent, `.${name}.backup-${id}`)
  await mkdir(parent, { recursive: true })
  await mkdir(staging)
  let backedUp = false
  let committed = false
  try {
    await Promise.all([...resources].map(([file, text]) => writeFile(join(staging, file), text, { flag: 'wx' })))
    if (await pathExists(outputDirectory)) {
      await fileOperations.rename(outputDirectory, backup)
      backedUp = true
    }
    try {
      await fileOperations.rename(staging, outputDirectory)
      committed = true
    } catch (error) {
      if (backedUp) {
        try {
          await fileOperations.rename(backup, outputDirectory)
          backedUp = false
        } catch (rollback) {
          throw new AggregateError([error, rollback], 'Contract bundle commit and rollback both failed.')
        }
      }
      throw error
    }
    if (backedUp) {
      await rm(backup, { recursive: true })
      backedUp = false
    }
  } finally {
    if (!committed) await rm(staging, { recursive: true, force: true })
  }
}

async function retainedResources(directory: string): Promise<readonly (readonly [string, string])[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return Promise.all(
      entries
        .filter((entry) => entry.isFile() && !isGeneratedResource(entry.name))
        .map(async (entry) => [entry.name, await readFile(join(directory, entry.name), 'utf8')] as const),
    )
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

function isGeneratedResource(name: string): boolean {
  return name === 'manifest.json' || /^(?:archon-2026-07|hermes-legacy)-v\d+(?:\.corpus)?\.json$/.test(name)
}

function addProfileFile(files: Map<WorkflowProfile, string>, value: string, flag: string): void {
  const separator = value.indexOf('=')
  const profile = value.slice(0, separator) as WorkflowProfile
  const path = value.slice(separator + 1)
  if (separator < 1 || !profiles.includes(profile)) throw new TypeError(`Invalid ${flag} profile: ${value}.`)
  if (files.has(profile)) throw new TypeError(`Duplicate ${flag} for ${profile}.`)
  files.set(profile, absolutePath(path, flag))
}

async function readCandidate(
  source: SyncSource,
  profile: WorkflowProfile,
  kind: 'contract' | 'corpus',
): Promise<Uint8Array> {
  if (source.kind === 'files')
    return readFile(kind === 'contract' ? source.contracts[profile] : source.corpora[profile])
  const action = kind === 'contract' ? 'schema' : 'schema-corpus'
  try {
    const { stdout } = await runFile(source.command, ['workflow', action, '--profile', profile, '--json'], {
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
    throw new Error(`Hermes failed to emit ${profile} ${kind}${stderr ? `: ${stderr}` : '.'}`, { cause: error })
  }
}

export function deterministicJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}
function generatedArtifactText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const canonical = canonicalArtifactJson(JSON.parse(text))
  return text === canonical ? text : canonical
}
function canonicalArtifactText(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text
}
function canonicalArtifactJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value))}\n`
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
export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
function absolutePath(value: string, flag: string): string {
  if (!isAbsolute(value)) throw new TypeError(`${flag} requires an absolute path.`)
  return value
}
async function main(): Promise<void> {
  await syncContracts(parseSyncArguments(process.argv.slice(2)))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
