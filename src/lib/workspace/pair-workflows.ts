import type { OrphanCompanionEntry, WorkflowPairEntry, WorkspaceEntry, WorkspaceFileEntry } from './types'

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.pnpm',
  '.svelte-kit',
  '.vite',
  '.workflow-studio',
  '.yarn',
  'build',
  'coverage',
  'deps',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
])

const DEFINITION_EXTENSION = /\.(?:yaml|yml)$/
const COMPANION_SUFFIX = '.hermes.yaml'

/**
 * Pairs scan metadata without reading workflow content. Paths are normalized by
 * the native boundary and compared byte-for-byte so case-sensitive workspaces
 * retain distinct filenames on every renderer platform.
 */
export function pairWorkflowFiles(
  workspaceId: string,
  scannedEntries: readonly WorkspaceFileEntry[],
): readonly WorkspaceEntry[] {
  const files = new Map<string, WorkspaceFileEntry>()

  for (const entry of scannedEntries) {
    if (!isEligibleFile(entry)) continue
    const prior = files.get(entry.relativePath)
    if (!prior) {
      files.set(entry.relativePath, entry)
    } else if (entry.readOnly && !prior.readOnly) {
      files.set(entry.relativePath, { ...prior, readOnly: true })
    }
  }

  const paths = [...files.keys()].sort(compareCodePoints)
  const companionPaths = new Set(paths.filter(isCanonicalCompanion))
  const pairedCompanions = new Set<string>()
  const results: WorkspaceEntry[] = []

  for (const definitionPath of paths) {
    if (!isDefinition(definitionPath)) continue

    const companionPath = canonicalCompanionFor(definitionPath)
    const companion = companionPaths.has(companionPath) ? files.get(companionPath) : undefined
    if (companion) pairedCompanions.add(companionPath)

    const definition = files.get(definitionPath)
    if (!definition) continue
    results.push(createWorkflowPair(workspaceId, definition, companion ?? null))
  }

  for (const companionPath of companionPaths) {
    if (pairedCompanions.has(companionPath)) continue
    const companion = files.get(companionPath)
    if (companion) results.push(createOrphanCompanion(workspaceId, companion))
  }

  return Object.freeze(results.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath)))
}

export function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isEligibleFile(entry: WorkspaceFileEntry): boolean {
  if (entry.kind !== 'file' || entry.symlink === 'unsafe') return false
  if (!isNormalizedRelativePath(entry.relativePath)) return false
  return !entry.relativePath
    .split('/')
    .slice(0, -1)
    .some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))
}

function isNormalizedRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isDefinition(path: string): boolean {
  return DEFINITION_EXTENSION.test(path) && !isCanonicalCompanion(path)
}

function isCanonicalCompanion(path: string): boolean {
  return path.endsWith(COMPANION_SUFFIX)
}

function canonicalCompanionFor(definitionPath: string): string {
  return definitionPath.replace(DEFINITION_EXTENSION, COMPANION_SUFFIX)
}

function createWorkflowPair(
  workspaceId: string,
  definition: WorkspaceFileEntry,
  companion: WorkspaceFileEntry | null,
): WorkflowPairEntry {
  const state = companion ? 'paired' : 'legacy'
  return Object.freeze({
    kind: 'workflow',
    id: `workflow:${workspaceId}:${definition.relativePath}`,
    name: fileName(definition.relativePath),
    relativePath: definition.relativePath,
    definitionPath: definition.relativePath,
    companionPath: companion?.relativePath ?? null,
    state,
    readOnly: definition.readOnly || Boolean(companion?.readOnly),
  })
}

function createOrphanCompanion(workspaceId: string, companion: WorkspaceFileEntry): OrphanCompanionEntry {
  return Object.freeze({
    kind: 'orphan-companion',
    id: `orphan:${workspaceId}:${companion.relativePath}`,
    name: fileName(companion.relativePath),
    relativePath: companion.relativePath,
    companionPath: companion.relativePath,
    state: 'orphan',
    readOnly: companion.readOnly,
  })
}

function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1)
}
