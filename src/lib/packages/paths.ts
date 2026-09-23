import type { WorkspaceFileEntry } from '../workspace/types'
import type { PackageFinding } from './types'
import {
  normalizeNfc,
  workflowMarketplaceCanonicalIdentity,
  workflowMarketplaceCasefold,
} from './unicode/workflow-marketplace-casefold'

export const packagePathIdentity = workflowMarketplaceCanonicalIdentity
export function comparePackagePaths(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0)!)
  const b = Array.from(right, (character) => character.codePointAt(0)!)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}
export function packageFinding(code: string, path: string, message: string): PackageFinding {
  return { code, path, message, severity: 'blocking' }
}
/** Version-one path rules; the loader rejects envelopes with unsupported rule semantics. */
export function packagePathError(path: string): string | null {
  const parts = path.split('/')
  if (path.includes('\0')) return 'package_path_nul'
  if (path.startsWith('/') || parts.some((part) => /^[A-Za-z]:/.test(part))) return 'package_path_absolute'
  if (path.includes('\\')) return 'package_path_backslash'
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return 'package_path_traversal'
  if (/[\ud800-\udfff]/u.test(path) || normalizeNfc(path) !== path) return 'package_path_collision'
  if (parts.some((part) => workflowMarketplaceCasefold(part) === '.git')) return 'package_repository_metadata'
  return null
}

export function validatePackagePaths(files: readonly WorkspaceFileEntry[]): PackageFinding[] {
  const findings: PackageFinding[] = []
  const identities = new Map<string, { path: string; kind: WorkspaceFileEntry['kind'] }>()
  const explicit = new Set<string>()
  for (const file of files) {
    const path = file.relativePath
    const code = packagePathError(path)
    if (code) {
      findings.push(packageFinding(code, path, 'Package path is not canonical and contained.'))
      continue
    }
    if (file.symlink !== 'none')
      findings.push(
        packageFinding('package_symlink_unsupported', path, 'Package files and directories must not be links.'),
      )
    const parts = path.split('/')
    if (parts.length > 1 && workflowMarketplaceCasefold(parts.at(-1)!) === 'workflow-package.json') {
      findings.push(packageFinding('package_root_nested', path, 'Package roots must not nest.'))
    }
    if (explicit.has(path))
      findings.push(packageFinding('package_path_collision', path, 'Package scan contains duplicate paths.'))
    explicit.add(path)
    for (let end = 1; end <= parts.length; end++) {
      const prefix = parts.slice(0, end).join('/')
      const kind = end === parts.length ? file.kind : 'directory'
      const identity = packagePathIdentity(prefix)
      const previous = identities.get(identity)
      if (previous && (previous.path !== prefix || previous.kind !== kind)) {
        findings.push(
          packageFinding('package_path_collision', path, 'Package paths have ambiguous file or directory identities.'),
        )
      } else identities.set(identity, { path: prefix, kind })
    }
  }
  return findings
}
