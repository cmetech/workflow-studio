import type { WorkspaceFileEntry } from '../workspace/types'
import contract from '../../../contracts/workflow-package-v1.json'
import { comparePackagePaths, packagePathError, packagePathIdentity } from '../packages/paths'
import {
  NativeError,
  type PackageNativeBridge,
  type PackageMutationPlan,
  type WorkspacePackageSnapshot,
  type WorkspaceTransactionResult,
} from './types'

const INDEX = '.well-known/hermes-workflows/index.json'
const limits = contract.resource_rules
function fail(code: string, message = code): never {
  throw new NativeError(code, message)
}
async function hash(bytes: Uint8Array) {
  const value = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function validate(path: string) {
  const code = packagePathError(path)
  if (code) fail(code)
}
function equal(a: ReadonlyMap<string, Uint8Array>, b: ReadonlyMap<string, Uint8Array>) {
  return (
    a.size === b.size &&
    [...a].every(([path, bytes]) => {
      const other = b.get(path)
      return other?.length === bytes.length && bytes.every((byte, index) => byte === other[index])
    })
  )
}
function pathsSafe(paths: readonly string[], allowDirectoryExpectations = false) {
  const aliases = new Map<string, string>()
  const filePaths = new Set(paths)
  for (const path of paths) {
    validate(path)
    const segments = path.split('/')
    for (let end = 1; end <= segments.length; end += 1) {
      const prefix = segments.slice(0, end).join('/')
      const identity = packagePathIdentity(prefix)
      const previous = aliases.get(identity)
      if (previous && previous !== prefix) fail('package_path_collision')
      if (!allowDirectoryExpectations && end < segments.length && filePaths.has(prefix)) fail('package_path_collision')
      aliases.set(identity, prefix)
    }
  }
}
export function browserPackages(
  readAll: () => Map<string, Uint8Array>,
  writeAll: (values: Map<string, Uint8Array>) => void,
  changed: (paths: readonly string[]) => Promise<void>,
) {
  let generation = 0
  const captures = new Map<string, { generation: number; root: string; files: Map<string, Uint8Array> }>()
  async function apply(plan: PackageMutationPlan, guard?: () => void): Promise<WorkspaceTransactionResult> {
    const activeGeneration = generation
    if (plan.workspaceId !== 'browser-workspace') fail('workspace_root_changed')
    if (
      plan.expectedEntries.length > limits.max_traversal_entries ||
      plan.writes.length + plan.moves.length + plan.trashes.length > limits.max_files
    )
      fail('package_file_count_limit')
    const original = readAll()
    const expected = new Map(plan.expectedEntries.map((entry) => [entry.relativePath, entry.expectedCurrentHash]))
    if (expected.size !== plan.expectedEntries.length) fail('workspace_transaction_invalid')
    pathsSafe([...expected.keys()], true)
    for (const [path, expectedHash] of expected) {
      const bytes = original.get(path)
      if (expectedHash === null && [...original.keys()].some((entry) => entry.startsWith(`${path}/`)))
        fail('workspace_revision_conflict')
      if ((bytes ? await hash(bytes) : null) !== expectedHash) fail('workspace_revision_conflict')
    }
    const touched = new Set<string>()
    const touch = (path: string, value?: string | null) => {
      validate(path)
      if (!expected.has(path) || touched.has(path) || (value !== undefined && expected.get(path) !== value))
        fail('workspace_transaction_invalid')
      touched.add(path)
    }
    let total = 0
    const next = new Map(original)
    for (const write of plan.writes) {
      touch(write.relativePath, write.expectedCurrentHash)
      const bytes = new TextEncoder().encode(write.text)
      if (bytes.length > limits.max_file_bytes) fail('package_file_size_limit')
      total += bytes.length
      next.set(write.relativePath, bytes)
    }
    for (const move of plan.moves) {
      touch(move.sourcePath)
      touch(move.destinationPath, null)
      const bytes = original.get(move.sourcePath)
      if (!bytes || expected.get(move.sourcePath) === null) fail('workspace_transaction_invalid')
      total += bytes.length
      next.delete(move.sourcePath)
      next.set(move.destinationPath, bytes)
    }
    for (const trash of plan.trashes) {
      touch(trash.relativePath, trash.expectedCurrentHash)
      next.delete(trash.relativePath)
    }
    if (total > limits.max_total_bytes) fail('package_total_size_limit')
    pathsSafe([...next.keys()])
    if (activeGeneration !== generation || !equal(original, readAll())) fail('workspace_revision_conflict')
    guard?.()
    writeAll(next)
    await changed([...touched])
    return {
      status: 'committed',
      results: [
        ...plan.writes.map((write) => ({ relativePath: write.relativePath, status: 'written' as const })),
        ...plan.moves.map((move) => ({
          relativePath: move.sourcePath,
          destinationPath: move.destinationPath,
          status: 'moved' as const,
        })),
        ...plan.trashes.map((trash) => ({ relativePath: trash.relativePath, status: 'trashed' as const })),
      ],
    }
  }
  function packageFiles(root: string) {
    if (root !== '') validate(root)
    const prefix = root === '' ? '' : root + '/'
    const all = readAll()
    const files = new Map(
      [...all].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes]),
    )
    if (!files.size) fail('path_not_found')
    pathsSafe([...files.keys()])
    const entries = new Set<string>()
    let total = 0
    for (const [path, bytes] of files) {
      const parts = path.split('/')
      if (parts.length > 1 && packagePathIdentity(parts.at(-1)!) === 'workflow-package.json')
        fail('package_root_nested')
      for (let end = 1; end <= parts.length; end += 1) entries.add(parts.slice(0, end).join('/'))
      if (bytes.length > limits.max_file_bytes) fail('package_file_size_limit')
      if (path !== 'digests.json') total += bytes.length
    }
    if (entries.size > limits.max_traversal_entries) fail('package_traversal_limit')
    if (files.size - Number(files.has('digests.json')) > limits.max_files) fail('package_file_count_limit')
    if (total > limits.max_total_bytes) fail('package_total_size_limit')
    return files
  }
  const bridge: PackageNativeBridge = {
    workspaceApplyTransaction: apply,
    workspaceHashPackage: async (root): Promise<WorkspacePackageSnapshot> => {
      const capturedGeneration = generation
      const all = packageFiles(root)
      const files = await Promise.all(
        [...all]
          .filter(([path]) => path !== 'digests.json')
          .sort(([a], [b]) => comparePackagePaths(a, b))
          .map(async ([relativePath, bytes]) => {
            const sha256 = await hash(bytes)
            const size = bytes.length
            return { relativePath, sha256, size, identity: { sha256, size, modifiedAt: 'browser' } }
          }),
      )
      if (capturedGeneration !== generation || !equal(all, packageFiles(root))) fail('package_source_changed')
      const sourceSnapshotToken = crypto.randomUUID()
      if (captures.size >= 16) captures.clear()
      captures.set(sourceSnapshotToken, { generation, root, files: all })
      const entries = new Map<string, WorkspaceFileEntry>()
      for (const [path, bytes] of all) {
        const parts = path.split('/')
        for (let end = 1; end <= parts.length; end += 1) {
          const relativePath = (root === '' ? '' : root + '/') + parts.slice(0, end).join('/')
          entries.set(relativePath, {
            relativePath,
            kind: end === parts.length ? 'file' : 'directory',
            size: end === parts.length ? bytes.length : 0,
            modifiedAt: 'browser',
            symlink: 'none',
            readOnly: false,
          })
        }
      }
      const generated = all.get('digests.json')
      return {
        packageRoot: root,
        workspaceId: 'browser-workspace',
        sourceSnapshotToken,
        files,
        entries: [...entries.values()],
        generatedDigestHash: generated ? await hash(generated) : null,
      }
    },
    workspaceReplaceGeneratedFiles: async ({ sourceSnapshotToken, writes }) => {
      const captured = captures.get(sourceSnapshotToken)
      captures.delete(sourceSnapshotToken)
      if (!captured || captured.generation !== generation) fail('package_snapshot_invalid')
      if (captured.root === '') fail('package_root_required')
      if (!equal(captured.files, packageFiles(captured.root))) fail('package_source_changed')
      const projected = new Set(['digests.json'])
      for (const path of captured.files.keys()) {
        const segments = path.split('/')
        for (let end = 1; end <= segments.length; end += 1) projected.add(segments.slice(0, end).join('/'))
      }
      if (projected.size > limits.max_traversal_entries) fail('package_traversal_limit')
      const required = new Set([captured.root + '/digests.json', INDEX])
      if (writes.length !== 2 || writes.some((write) => !required.delete(write.relativePath)) || required.size)
        fail('workspace_transaction_invalid')
      return apply(
        {
          workspaceId: 'browser-workspace',
          expectedEntries: writes.map(({ relativePath, expectedCurrentHash }) => ({
            relativePath,
            expectedCurrentHash,
          })),
          writes,
          moves: [],
          trashes: [],
        },
        () => {
          if (captured.generation !== generation || !equal(captured.files, packageFiles(captured.root)))
            fail('package_source_changed')
        },
      )
    },
  }
  return {
    bridge,
    reset: () => {
      generation += 1
      captures.clear()
    },
  }
}
