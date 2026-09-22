import { parse } from 'yaml'
import type { AuthoringContract } from '../contract/types'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import type { WorkspacePackageSnapshot, WorkspaceReadResult } from '../native/types'
import { capturePackageAnalysis } from '../../features/packages/package-analysis'
import { verifyPackageDigests } from '../packages/digest'
import { packagePathError, packagePathIdentity } from '../packages/paths'
import type { PackageExampleDescriptor } from './types'

export interface PackageExampleContracts {
  contract: WorkflowPackageContract
  resourceContract: ResourceResolutionContract
  authoring: readonly AuthoringContract[]
}
export function parsePackageExampleCatalog(
  text: string,
): readonly { id: string; title: string; summary: string; path: string }[] {
  const value: unknown = parse(text)
  if (!value || typeof value !== 'object' || !('packages' in value) || !Array.isArray(value.packages))
    throw new Error('Package catalog requires packages.')
  const ids = new Set<string>(),
    paths = new Set<string>()
  return value.packages.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid package catalog entry.')
    const row = entry as Record<string, unknown>
    for (const key of ['id', 'title', 'summary', 'path'])
      if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error(`Package catalog requires ${key}.`)
    const result = row as { id: string; title: string; summary: string; path: string }
    if (packagePathError(result.path) || packagePathError(result.id))
      throw new Error('Unsafe package catalog path or ID.')
    if (ids.has(packagePathIdentity(result.id)) || paths.has(packagePathIdentity(result.path)))
      throw new Error('Duplicate package catalog identity.')
    ids.add(packagePathIdentity(result.id))
    paths.add(packagePathIdentity(result.path))
    return Object.freeze({ id: result.id, title: result.title, summary: result.summary, path: result.path })
  })
}
export async function capturePackageExample(
  example: PackageExampleDescriptor,
  contracts: PackageExampleContracts,
  root = `packages/${example.id}`,
) {
  const texts = new Map<string, WorkspaceReadResult>()
  for (const file of example.files) {
    if (texts.has(`${root}/${file.path}`)) throw new Error('package_path_collision')
    const bytes = new TextEncoder().encode(file.text)
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    texts.set(`${root}/${file.path}`, {
      relativePath: `${root}/${file.path}`,
      text: file.text,
      sha256,
      size: bytes.length,
      modifiedAt: '',
      readOnly: false,
    })
  }
  const directories = new Set<string>()
  for (const file of example.files) {
    const parts = file.path.split('/')
    for (let depth = 1; depth < parts.length; depth++) directories.add(`${root}/${parts.slice(0, depth).join('/')}`)
  }
  const snapshot: WorkspacePackageSnapshot = {
    packageRoot: root,
    workspaceId: 'bundled-example',
    sourceSnapshotToken: 'bundled-example',
    generatedDigestHash: texts.get(`${root}/digests.json`)?.sha256 ?? null,
    entries: [
      ...[...directories].map((relativePath) => ({
        relativePath,
        kind: 'directory' as const,
        symlink: 'none' as const,
        size: 0,
        modifiedAt: '',
        readOnly: false,
      })),
      ...[...texts.values()].map((file) => ({
        relativePath: file.relativePath,
        kind: 'file' as const,
        symlink: 'none' as const,
        size: file.size,
        modifiedAt: '',
        readOnly: false,
      })),
    ],
    files: [...texts.values()].map((file) => ({
      relativePath: file.relativePath.slice(root.length + 1),
      size: file.size,
      sha256: file.sha256,
      identity: { sha256: file.sha256, size: file.size, modifiedAt: '' },
    })),
  }
  const captured = await capturePackageAnalysis({
    ...contracts,
    packageRoot: root,
    index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
    native: {
      workspaceHashPackage: async () => snapshot,
      workspaceReadTextArtifact: async (path) => {
        const file = texts.get(path)
        if (!file) throw new Error('package_member_missing')
        return file
      },
    },
  })
  return captured
}
export async function validatePackageExample(
  example: PackageExampleDescriptor,
  contracts: PackageExampleContracts,
): Promise<readonly string[]> {
  try {
    const captured = await capturePackageExample(example, contracts)
    const errors = captured.analysis.blockers.map((finding) => `${finding.code}: ${finding.path}: ${finding.message}`)
    if (captured.package.id !== example.id) errors.push('package_example_id_mismatch')
    const digests = example.files.find((file) => file.path === 'digests.json')
    if (!digests) errors.push('package_digest_missing')
    else {
      const verification = await verifyPackageDigests(digests.text, captured.snapshot.files, contracts.contract)
      if (!verification.ok) errors.push(verification.code)
    }
    return errors
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}
