import { replaceManifestProperty } from '../packages/manifest-edit'
import catalogText from '../../../examples/packages/catalog.yaml?raw'
import type { PackageExampleDescriptor } from './types'
import type { PackageNativeBridge, WorkspaceNativeBridge } from '../native/types'
import type { WorkflowPackageProjection } from '../packages/types'
import {
  capturePackageExample,
  parsePackageExampleCatalog,
  validatePackageExample,
  type PackageExampleContracts,
} from './package-example-analysis'
import { buildPackageCatalog } from '../packages/discovery'
import { generatePackageDigests } from '../packages/digest'
import { packagePathIdentity } from '../packages/paths'

const sources = import.meta.glob('../../../examples/packages/**/*', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, string>>
let catalog: Promise<readonly PackageExampleDescriptor[]> | undefined
export function loadPackageExampleCatalog(): Promise<readonly PackageExampleDescriptor[]> {
  catalog ??= Promise.resolve().then(() =>
    Object.freeze(
      parsePackageExampleCatalog(catalogText).map((entry) => {
        const prefix = `../../../examples/packages/${entry.path}/`
        const files = Object.entries(sources)
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, text]) => Object.freeze({ path: path.slice(prefix.length), text }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        if (!files.length) throw new Error(`Missing package example: ${entry.id}`)
        return Object.freeze({
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          files: Object.freeze(files),
          readOnly: true as const,
        })
      }),
    ),
  )
  return catalog
}
export interface PackageExampleCopyDependencies extends PackageExampleContracts {
  workspaceId: string
  native: Pick<WorkspaceNativeBridge, 'workspaceScan' | 'workspaceReadTextArtifact'> &
    Pick<PackageNativeBridge, 'workspaceApplyTransaction'>
  open?: (pkg: WorkflowPackageProjection) => void | Promise<void>
}
export async function createPackageExampleCopy(
  example: PackageExampleDescriptor,
  deps: PackageExampleCopyDependencies,
): Promise<WorkflowPackageProjection> {
  if (!deps.workspaceId) throw new Error('An active workspace is required.')
  const errors = await validatePackageExample(example, deps)
  if (errors.length) throw new Error(errors.join('\n'))
  const entries = await deps.native.workspaceScan()
  const manifestTexts = new Map<string, string>()
  for (const entry of entries)
    if (packagePathIdentity(entry.relativePath.split('/').at(-1)!) === 'workflow-package.json') {
      if (entry.kind !== 'file' || entry.symlink !== 'none')
        throw new Error('Existing package manifest is not an ordinary file.')
      manifestTexts.set(entry.relativePath, (await deps.native.workspaceReadTextArtifact(entry.relativePath)).text)
    }
  const existing = buildPackageCatalog({ contract: deps.contract, files: entries, manifestTexts })
  if (existing.findings.some((finding) => finding.severity === 'blocking'))
    throw new Error('Resolve existing package catalog findings before copying an example.')
  const roots = existing.packages.map((pkg) => packagePathIdentity(pkg.root))
  if (roots.some((root) => root === '' || root === 'packages')) throw new Error('Package roots cannot nest.')
  const ids = new Set(existing.packages.map((pkg) => packagePathIdentity(pkg.id)))
  let id = example.id,
    root = `packages/${id}`
  for (let suffix = 2; ; suffix++) {
    const identity = packagePathIdentity(root)
    const overlaps = roots.some(
      (other) => identity.startsWith(`${other}/`) || other.startsWith(`${identity}/`) || identity === other,
    )
    const occupied = entries.some((entry) => {
      const path = packagePathIdentity(entry.relativePath)
      return (
        path === identity ||
        path.startsWith(`${identity}/`) ||
        (identity.startsWith(`${path}/`) && (entry.kind !== 'directory' || entry.symlink !== 'none'))
      )
    })
    if (!ids.has(packagePathIdentity(id)) && !overlaps && !occupied) break
    if (
      entries.some(
        (entry) =>
          packagePathIdentity(entry.relativePath) === 'packages' &&
          (entry.kind !== 'directory' || entry.symlink !== 'none'),
      )
    )
      throw new Error('Package destination is unavailable.')
    id = `${example.id}-${suffix}`
    root = `packages/${id}`
  }
  const files = example.files.map((file) =>
    file.path === 'workflow-package.json' && id !== example.id
      ? { path: file.path, text: replaceManifestProperty(file.text, 'id', id) }
      : file,
  )
  const copy = { ...example, id, files }
  const captured = await capturePackageExample(copy, deps, root)
  if (!captured.analysis.ready) throw new Error(captured.analysis.blockers.map((finding) => finding.message).join('\n'))
  const digests = await generatePackageDigests(captured.snapshot.files, deps.contract)
  const writes = files.map((file) => ({
    relativePath: `${root}/${file.path}`,
    text: file.path === 'digests.json' ? digests : file.text,
    expectedCurrentHash: null,
  }))
  const result = await deps.native.workspaceApplyTransaction({
    workspaceId: deps.workspaceId,
    expectedEntries: [{ relativePath: root, expectedCurrentHash: null }],
    writes,
    moves: [],
    trashes: [],
  })
  if (result.status !== 'committed') throw new Error('Package copy did not complete.')
  await deps.open?.(captured.package)
  return captured.package
}
