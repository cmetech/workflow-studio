import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import pinned from '../contracts/workflow-package-provenance.json'
import {
  loadWorkflowPackageContract,
  loadWorkflowPackageVectors,
} from '../src/lib/package-contract/package-contract-loader'
import {
  loadResourceResolutionContract,
  loadResourceResolutionVectors,
} from '../src/lib/package-contract/resource-contract-loader'

const run = promisify(execFile)
const files = [
  'workflow-package-v1.json',
  'workflow-package-v1-vectors.json',
  'workflow-package-resource-resolution-v1.json',
  'workflow-package-resource-resolution-v1-vectors.json',
] as const
const loaders = {
  'workflow-package-v1.json': loadWorkflowPackageContract,
  'workflow-package-v1-vectors.json': loadWorkflowPackageVectors,
  'workflow-package-resource-resolution-v1.json': loadResourceResolutionContract,
  'workflow-package-resource-resolution-v1-vectors.json': loadResourceResolutionVectors,
} as const
type ArtifactName = (typeof files)[number]
interface Provenance {
  readonly commit: string
  readonly directory: string
  readonly files: Readonly<Record<ArtifactName, string>>
}
interface SyncOptions {
  readonly sourceRoot: string
  readonly destinationRoot: string
  readonly provenance?: Provenance
}

function validateProvenance(provenance: Provenance): void {
  if (
    !/^[a-f0-9]{40}$/.test(provenance.commit) ||
    provenance.directory !== 'plugins/workflow/contracts' ||
    Object.keys(provenance.files).length !== files.length ||
    files.some((name) => !/^[a-f0-9]{64}$/.test(provenance.files[name]))
  ) {
    throw new TypeError('Invalid package contract provenance.')
  }
}
async function verify(name: ArtifactName, bytes: Uint8Array, provenance: Provenance): Promise<void> {
  const loader = loaders[name]
  const result = await loader(bytes, { sha256: provenance.files[name] })
  if (!result.ok) throw new TypeError(`${name}: ${result.code}: ${result.message}`)
}

/** Developer tooling only. Runtime package I/O remains in capability-scoped native commands. */
async function rejectLinkedPath(path: string): Promise<void> {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) await rejectLinkedPath(parent)
  try {
    if ((await lstat(absolute)).isSymbolicLink())
      throw new TypeError('Package contract paths must not contain symlinks or junctions.')
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
}

export async function checkPackageContracts(
  directory = resolve('contracts'),
  provenance: Provenance = pinned,
): Promise<void> {
  validateProvenance(provenance)
  for (const name of files) {
    const path = join(directory, name)
    await rejectLinkedPath(path)
    await verify(name, await readFile(path), provenance)
  }
}

export async function syncPackageContracts(options: SyncOptions): Promise<{ readonly files: readonly ArtifactName[] }> {
  const provenance = options.provenance ?? pinned
  validateProvenance(provenance)
  // Drain every Git child even on failure; callers may immediately remove their fixture/output roots.
  const settled = await Promise.allSettled(
    files.map(async (name) => {
      const path = `${provenance.directory}/${name}`
      const tree = await run('git', ['-C', options.sourceRoot, 'ls-tree', provenance.commit, '--', path], {
        encoding: 'utf8',
      })
      if (!new RegExp(`^100644 blob [a-f0-9]{40}\\t${path.replaceAll('.', '\\.')}\\r?\\n$`).test(tree.stdout)) {
        throw new TypeError(`${name}: expected a regular committed artifact, not a symlink.`)
      }
      const result = await run('git', ['-C', options.sourceRoot, 'show', `${provenance.commit}:${path}`], {
        encoding: 'buffer',
        maxBuffer: 8 * 1024 * 1024,
      })
      await verify(name, result.stdout, provenance)
      return { name, bytes: result.stdout }
    }),
  )
  const candidates = settled.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
  for (const { name } of candidates) await rejectLinkedPath(join(options.destinationRoot, name))
  await mkdir(options.destinationRoot, { recursive: true })
  for (const { name, bytes } of candidates) {
    const destination = join(options.destinationRoot, name)
    const temporary = join(options.destinationRoot, `.${name}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  await checkPackageContracts(options.destinationRoot, provenance)
  return { files }
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--check') {
    await checkPackageContracts()
    console.log('Package contract resources match pinned upstream bytes.')
    return
  }
  if (args.length !== 2 || args[0] !== '--source-root' || !args[1]) {
    throw new TypeError('Use --check, or --source-root <local agent repository>. No network access is performed.')
  }
  await syncPackageContracts({ sourceRoot: resolve(args[1]), destinationRoot: resolve('contracts') })
  console.log('Synchronized pinned package and resource-resolution contract artifacts.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
