import type { AuthoringContract } from '../contract/types'
import type { PackageMutationPlan, WorkspaceWriteRequest, WorkspaceMoveRequest } from '../native/types'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import type { WorkspaceFileEntry } from '../workspace/types'
import { analyzeWorkflowPair } from '../validation/analyze-workflow'
import { parsePackageManifest } from './manifest'
import { replaceManifestProperty } from './manifest-edit'
import { packagePathError, packagePathIdentity, validatePackagePaths } from './paths'
import { resolvePackageReferences } from './package-references'
import type { WorkflowPackageManifest, PackageWorkflowMember } from './types'

export interface PackageSourceFile {
  /** Canonical path relative to the destination package; never inferred from source text. */
  readonly path: string
  readonly text: string
  /** Required for workspace sources; resolved by the coordinator before planning. */
  readonly sourcePath?: string
}
export interface PackageWorkflowSource {
  readonly kind: 'blank' | 'example' | 'workspace'
  readonly authoring: AuthoringContract
  readonly definition: PackageSourceFile
  readonly companion: PackageSourceFile | null
  readonly resources: readonly PackageSourceFile[]
}
export interface PackageWorkflowOption {
  readonly id: string
  readonly label: string
  readonly source: PackageWorkflowSource
  readonly disabledReason?: string
}
export interface PackageCreationEntry extends WorkspaceFileEntry {
  readonly sha256?: string
  readonly text?: string
}
export interface PackageCreationSnapshot {
  readonly workspaceId: string
  readonly contract: WorkflowPackageContract
  readonly resourceContract: ResourceResolutionContract
  readonly entries: readonly PackageCreationEntry[]
  readonly packages: readonly { readonly root: string; readonly id: string }[]
  readonly hostPython?: string
}
export type PackageMetadata = Omit<WorkflowPackageManifest, 'schemaVersion' | 'workflows'>
export interface CreatePackageRequest {
  readonly root: string
  readonly metadata: PackageMetadata
  readonly workflow: PackageWorkflowSource
  readonly mode?: 'copy' | 'move'
}
export interface ImportWorkflowPackageRequest {
  readonly root: string
  readonly workflow: PackageWorkflowSource
  readonly mode: 'copy' | 'move'
}
export class PackageCreationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(message)
    this.name = 'PackageCreationError'
  }
}
function fail(code: string, path: string, message: string): never {
  throw new PackageCreationError(code, message, path)
}
const nested = (a: string, b: string) =>
  a === '' || b === '' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
const pathCheck = (path: string) => {
  const error = packagePathError(path)
  if (error) fail(error, path, 'Use a canonical relative path inside the workspace.')
}

export async function planPackageCreation(
  request: CreatePackageRequest,
  snapshot: PackageCreationSnapshot,
): Promise<PackageMutationPlan> {
  pathCheck(request.root)
  const rootId = packagePathIdentity(request.root)
  if (nested(rootId, '.well-known/hermes-workflows/index.json'))
    fail('package_root_reserved', request.root, 'The shared marketplace index must remain outside package roots.')
  if (snapshot.packages.some((pkg) => nested(rootId, packagePathIdentity(pkg.root))))
    fail('package_root_nested', request.root, 'Package roots may not nest or overlap.')
  if (snapshot.packages.some((pkg) => packagePathIdentity(pkg.id) === packagePathIdentity(request.metadata.id)))
    fail('package_id_duplicate', request.root, 'Choose a unique package ID.')
  for (const entry of snapshot.entries) {
    const id = packagePathIdentity(entry.relativePath)
    if (id === rootId || id.startsWith(`${rootId}/`))
      fail('package_path_collision', request.root, 'The destination package folder already exists.')
  }
  const member = workflowMember(request.workflow)
  const manifest = { ...request.metadata, schemaVersion: 1, workflows: [member] }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  validateManifest(manifestText, request.root, snapshot)
  return buildPlan(request, snapshot, manifestText, null, true)
}

export async function planWorkflowImport(
  request: ImportWorkflowPackageRequest,
  snapshot: PackageCreationSnapshot,
): Promise<PackageMutationPlan> {
  if (request.root !== '') pathCheck(request.root)
  if (!snapshot.packages.some((pkg) => pkg.root === request.root))
    fail('package_source_unverified', request.root, 'Select an existing package from the current workspace.')
  const manifestPath = packagePath(request.root, 'workflow-package.json')
  const entry = requireSource(manifestPath, snapshot)
  const parsed = parsePackageManifest(entry.text!, manifestPath, snapshot.contract)
  if (!parsed.ok) fail(parsed.findings[0]!.code, manifestPath, parsed.findings[0]!.message)
  const member = workflowMember(request.workflow)
  const paths = [member.definition, ...(member.companion ? [member.companion] : [])].map(packagePathIdentity)
  if (
    parsed.manifest.workflows.some((item) =>
      [item.definition, ...(item.companion ? [item.companion] : [])].some((path) =>
        paths.includes(packagePathIdentity(path)),
      ),
    )
  )
    fail('package_member_duplicate', member.definition, 'This workflow is already a package member.')
  const manifestText = replaceManifestProperty(entry.text!, 'workflows', [...parsed.manifest.workflows, member])
  validateManifest(manifestText, request.root, snapshot)
  return buildPlan(request, snapshot, manifestText, entry.sha256!, false)
}

function workflowMember(source: PackageWorkflowSource): PackageWorkflowMember {
  return { definition: source.definition.path, ...(source.companion ? { companion: source.companion.path } : {}) }
}
function validateManifest(text: string, root: string, snapshot: PackageCreationSnapshot): void {
  const result = parsePackageManifest(text, packagePath(root, 'workflow-package.json'), snapshot.contract)
  if (!result.ok) fail(result.findings[0]!.code, root, result.findings[0]!.message)
}
function requireSource(path: string, snapshot: PackageCreationSnapshot): PackageCreationEntry {
  pathCheck(path)
  const entry = snapshot.entries.find((item) => item.relativePath === path)
  if (
    !entry ||
    entry.kind !== 'file' ||
    entry.symlink !== 'none' ||
    entry.readOnly ||
    typeof entry.text !== 'string' ||
    !entry.sha256 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)
  )
    fail('package_source_unverified', path, 'Read and identify the exact source file before planning.')
  for (const ancestor of snapshot.entries)
    if (path.startsWith(`${ancestor.relativePath}/`) && (ancestor.kind !== 'directory' || ancestor.symlink !== 'none'))
      fail('package_source_unverified', path, 'Source ancestors must be ordinary directories.')
  return entry
}

async function buildPlan(
  request: CreatePackageRequest | ImportWorkflowPackageRequest,
  snapshot: PackageCreationSnapshot,
  manifestText: string,
  manifestHash: string | null,
  creating: boolean,
): Promise<PackageMutationPlan> {
  if (!snapshot.workspaceId) fail('package_source_unverified', request.root, 'An active workspace is required.')
  const source = request.workflow
  const mode = request.mode ?? 'copy'
  if (mode === 'move' && source.kind !== 'workspace')
    fail('package_source_unverified', request.root, 'Only identified workspace workflows can be moved.')
  const supplied = [source.definition, ...(source.companion ? [source.companion] : []), ...source.resources]
  const manifestPath = packagePath(request.root, 'workflow-package.json')
  const writes: WorkspaceWriteRequest[] = [
    { relativePath: manifestPath, text: manifestText, expectedCurrentHash: manifestHash },
  ]
  const moves: WorkspaceMoveRequest[] = []
  const expectations = new Map<string, string | null>([[manifestPath, manifestHash]])
  if (creating) expectations.set(request.root, null)
  const packageEntries = snapshot.entries
    .filter((entry) => request.root === '' || entry.relativePath.startsWith(`${request.root}/`))
    .map((entry) => ({
      ...entry,
      relativePath: request.root === '' ? entry.relativePath : entry.relativePath.slice(request.root.length + 1),
    }))
  const occupied = new Set(packageEntries.map((entry) => packagePathIdentity(entry.relativePath)))
  const artifactTexts = new Map(
    packageEntries.filter((entry) => entry.text !== undefined).map((entry) => [entry.relativePath, entry.text!]),
  )
  for (const file of supplied) {
    pathCheck(file.path)
    if (
      packagePathIdentity(file.path) === 'workflow-package.json' ||
      packagePathIdentity(file.path) === 'digests.json' ||
      packagePathIdentity(file.path) === '.well-known/hermes-workflows/index.json'
    )
      fail('package_generated_file', file.path, 'Generated metadata is not a workflow source.')
    if (occupied.has(packagePathIdentity(file.path)))
      fail('package_path_collision', file.path, 'Destination files must not already exist.')
    occupied.add(packagePathIdentity(file.path))
    const destination = packagePath(request.root, file.path)
    expectations.set(destination, null)
    if (source.kind === 'workspace') {
      if (!file.sourcePath)
        fail(
          'package_source_unverified',
          file.path,
          'Every workspace resource needs its explicitly selected source path.',
        )
      const original = requireSource(file.sourcePath, snapshot)
      if (original.text !== file.text)
        fail('package_source_changed', file.sourcePath, 'Source bytes changed after selection.')
      expectations.set(file.sourcePath, original.sha256!)
    } else if (file.sourcePath !== undefined)
      fail('package_source_unverified', file.path, 'Bundled sources must not claim workspace origin.')
    const isWorkflow = file === source.definition || file === source.companion
    if (mode === 'move' && isWorkflow) {
      if (snapshot.packages.some((pkg) => pkg.root === '' || file.sourcePath!.startsWith(`${pkg.root}/`)))
        fail(
          'package_membership_conflict',
          file.sourcePath!,
          'Copy this workflow or remove its existing package membership first.',
        )
      moves.push({ sourcePath: file.sourcePath!, destinationPath: destination })
    } else writes.push({ relativePath: destination, text: file.text, expectedCurrentHash: null })
    artifactTexts.set(file.path, file.text)
    packageEntries.push({
      relativePath: file.path,
      kind: 'file',
      size: new TextEncoder().encode(file.text).byteLength,
      symlink: 'none',
      readOnly: false,
      modifiedAt: '',
    })
  }
  const rootParts = request.root.split('/')
  for (let depth = 1; depth < rootParts.length; depth++) {
    const ancestorPath = rootParts.slice(0, depth).join('/')
    const identity = packagePathIdentity(ancestorPath)
    for (const entry of snapshot.entries) {
      const prefix = entry.relativePath.split('/').slice(0, depth).join('/')
      if (packagePathIdentity(prefix) !== identity) continue
      if (
        prefix !== ancestorPath ||
        (entry.relativePath === prefix && (entry.kind !== 'directory' || entry.symlink !== 'none' || entry.readOnly))
      )
        fail(
          'package_path_collision',
          entry.relativePath,
          'Package ancestors must be unambiguous writable ordinary directories.',
        )
    }
  }
  const pathFindings = validatePackagePaths(packageEntries)
  if (pathFindings.length) fail(pathFindings[0]!.code, pathFindings[0]!.path, pathFindings[0]!.message)
  const limits = snapshot.contract.resource_rules
  assertPackageContentLimits(
    [
      ...packageEntries.filter((entry) => entry.relativePath !== 'workflow-package.json'),
      { relativePath: 'workflow-package.json', kind: 'file', size: new TextEncoder().encode(manifestText).byteLength },
    ],
    snapshot.contract,
  )
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'package-creation',
      workflowId: source.definition.path,
      pairGeneration: 0,
      definition: {
        path: packagePath(request.root, source.definition.path),
        text: source.definition.text,
        revision: 0,
      },
      companion: source.companion
        ? { path: packagePath(request.root, source.companion.path), text: source.companion.text, revision: 0 }
        : null,
      profile: source.authoring.profile,
      contractDigest: source.authoring.contract_digest,
      reason: 'explicit-validate',
    },
    source.authoring,
  )
  if (!analysis.structurallyValid)
    fail(
      'package_workflow_invalid',
      source.definition.path,
      'Resolve workflow structural errors before creating package files.',
    )
  const references = resolvePackageReferences({
    contract: snapshot.resourceContract,
    packageRoot: request.root,
    members: [workflowMember(source)],
    files: new Map(packageEntries.map((entry) => [entry.relativePath, { kind: entry.kind }])),
    artifactTexts,
    workflows: [{ path: source.definition.path, authoring: source.authoring, analysis }],
    ...(snapshot.hostPython !== undefined ? { hostPython: snapshot.hostPython } : {}),
    maxArtifactBytes: limits.max_file_bytes,
  })
  const blocker = references.findings.find((finding) => finding.severity === 'blocking')
  if (blocker) fail(blocker.code, blocker.path, blocker.message)
  for (const reference of references.references) {
    if (!reference.artifactPath || supplied.some((file) => file.path === reference.artifactPath)) continue
    const original = requireSource(packagePath(request.root, reference.artifactPath), snapshot)
    expectations.set(original.relativePath, original.sha256!)
  }
  return {
    workspaceId: snapshot.workspaceId,
    expectedEntries: [...expectations].map(([relativePath, expectedCurrentHash]) => ({
      relativePath,
      expectedCurrentHash,
    })),
    writes,
    moves,
    trashes: [],
  }
}

/** Counts the complete proposed scan, including implicit directories but excluding generated root metadata from payload budgets. */
export function assertPackageContentLimits(
  entries: readonly Pick<WorkspaceFileEntry, 'relativePath' | 'kind' | 'size'>[],
  contract: WorkflowPackageContract,
): void {
  const paths = new Set<string>()
  for (const entry of entries) {
    const parts = entry.relativePath.split('/')
    for (let depth = 1; depth <= parts.length; depth++) paths.add(parts.slice(0, depth).join('/'))
  }
  const files = entries.filter((entry) => entry.kind === 'file')
  const payload = files.filter((entry) => !contract.digest_rules.excluded_paths.includes(entry.relativePath))
  const limits = contract.resource_rules
  if (files.some((entry) => !Number.isSafeInteger(entry.size) || entry.size < 0))
    fail('package_size_invalid', '', 'Package file sizes must be known and valid.')
  if (
    payload.length > limits.max_files ||
    files.some((entry) => entry.size > limits.max_file_bytes) ||
    payload.reduce((sum, entry) => sum + entry.size, 0) > limits.max_total_bytes ||
    paths.size > limits.max_traversal_entries
  )
    fail('package_size_limit', '', 'The package exceeds its contract limits.')
}

function packagePath(root: string, path: string): string {
  return root ? `${root}/${path}` : path
}
