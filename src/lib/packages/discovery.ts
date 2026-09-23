import { freezePackageValue } from '../package-contract/package-contract-loader'
import type { WorkspaceFileEntry } from '../workspace/types'
import { parsePackageManifest } from './manifest'
import {
  comparePackagePaths,
  packageFinding,
  packagePathError,
  packagePathIdentity,
  validatePackagePaths,
} from './paths'
import type { PackageCatalog, PackageCatalogInput, PackageFinding, WorkflowPackageProjection } from './types'

export function findPackageManifestPaths(files: readonly WorkspaceFileEntry[]): readonly string[] {
  return [
    ...new Set(
      files
        .filter((file) => file.kind === 'file' && file.relativePath.split('/').at(-1) === 'workflow-package.json')
        .map((file) => file.relativePath),
    ),
  ].sort(comparePackagePaths)
}
const inside = (root: string, path: string) => root === '' || path.startsWith(`${root}/`)
const relativeTo = (root: string, path: string) => (root === '' ? path : path.slice(root.length + 1))

export function buildPackageCatalog(input: PackageCatalogInput): PackageCatalog {
  const findings: PackageFinding[] = []
  const candidates = findPackageManifestPaths(input.files).map((manifestPath) => ({
    manifestPath,
    root: manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/')) : '',
  }))
  const rejected = new Set<string>()
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const left = candidates[i]!,
        right = candidates[j]!
      const a = packagePathIdentity(left.root),
        b = packagePathIdentity(right.root)
      if (a === b || inside(a, b) || inside(b, a)) {
        for (const candidate of [left, right]) {
          rejected.add(candidate.manifestPath)
          findings.push(
            packageFinding(
              a === b ? 'package_path_collision' : 'package_root_nested',
              candidate.manifestPath,
              'Package roots must be distinct and must not overlap.',
            ),
          )
        }
      }
    }
  const projections: WorkflowPackageProjection[] = []
  const safeManifestPaths: string[] = []
  for (const { root, manifestPath } of candidates) {
    if (rejected.has(manifestPath)) continue
    const code = packagePathError(manifestPath)
    if (code) {
      findings.push(packageFinding(code, manifestPath, 'Package manifest path is not canonical.'))
      continue
    }
    const ancestors = input.files.filter(
      (file) => file.relativePath === root || root.startsWith(`${file.relativePath}/`),
    )
    if (ancestors.some((file) => file.symlink !== 'none' || file.kind !== 'directory')) {
      findings.push(
        packageFinding('package_symlink_unsupported', manifestPath, 'Package ancestors must be real directories.'),
      )
      continue
    }
    const entries = input.files
      .filter((file) => inside(root, file.relativePath))
      .map((file) => ({ ...file, relativePath: relativeTo(root, file.relativePath) }))
    const pathFindings = validatePackagePaths(entries)
    if (pathFindings.length) {
      findings.push(
        ...pathFindings.map((finding) => ({ ...finding, path: root ? `${root}/${finding.path}` : finding.path })),
      )
      continue
    }
    safeManifestPaths.push(manifestPath)
    const text = input.manifestTexts.get(manifestPath)
    if (text === undefined) {
      findings.push(
        packageFinding('package_manifest_invalid', manifestPath, 'Package manifest content is unavailable.'),
      )
      continue
    }
    const result = parsePackageManifest(text, manifestPath, input.contract)
    if (!result.ok) {
      findings.push(...result.findings)
      continue
    }
    const members = result.manifest.workflows.flatMap((member) =>
      member.companion ? [member.definition, member.companion] : [member.definition],
    )
    const filePaths = new Set(entries.filter((file) => file.kind === 'file').map((file) => file.relativePath))
    const missing = members.filter((path) => !filePaths.has(path))
    if (missing.length) {
      findings.push(
        ...missing.map((path) =>
          packageFinding(
            'package_member_missing',
            root ? `${root}/${path}` : path,
            'Declared workflow member is missing.',
          ),
        ),
      )
      continue
    }
    projections.push({
      id: result.manifest.id,
      root,
      manifestPath,
      manifest: result.manifest,
      workflows: result.manifest.workflows,
      artifacts: entries
        .sort((a, b) => comparePackagePaths(a.relativePath, b.relativePath))
        .map((entry) => ({
          path: entry.relativePath,
          workspacePath: root ? `${root}/${entry.relativePath}` : entry.relativePath,
          kind: entry.kind,
          size: entry.size,
          readOnly: entry.readOnly,
        })),
    })
  }
  const ids = new Map<string, WorkflowPackageProjection[]>()
  for (const projection of projections) ids.set(projection.id, [...(ids.get(projection.id) ?? []), projection])
  for (const group of ids.values())
    if (group.length > 1)
      for (const projection of group) {
        rejected.add(projection.manifestPath)
        findings.push(
          packageFinding(
            'package_manifest_invalid',
            projection.manifestPath,
            'Package IDs must be unique within the workspace.',
          ),
        )
      }
  const packages = projections.filter((projection) => !rejected.has(projection.manifestPath))
  return freezePackageValue({
    packages,
    repairableManifestPaths: safeManifestPaths.filter((path) => !packages.some((pkg) => pkg.manifestPath === path)),
    findings: findings.sort((a, b) => comparePackagePaths(a.path, b.path) || comparePackagePaths(a.code, b.code)),
  })
}
