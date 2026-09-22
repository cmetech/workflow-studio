import type { AuthoringContract } from '../contract/types'
import type { DocumentAnalysis, DocumentRevision, WorkflowPairText } from '../documents/types'
import { createDocumentRevision, isAnalysisCurrent } from '../documents/revisions'
import { applyWorkflowMutation, type YamlTransaction } from '../documents/transactions'
import type { ExpectedWorkspaceEntry, PackageMutationPlan } from '../native/types'
import type {
  ResourceResolutionContract,
  ResourceCandidateOperation,
} from '../package-contract/resource-contract-loader'
import type { GraphScopeKey, WorkflowProjection } from '../projection/types'
import { analyzeWorkflowPair } from '../validation/analyze-workflow'
import type { WorkflowMutation } from '../yaml/mutations'
import { assertPackageContentLimits, type PackageCreationSnapshot } from './creation'
import { parsePackageManifest } from './manifest'
import { packagePathError, packagePathIdentity, validatePackagePaths } from './paths'
import { admitResourceResolution, interpretResourceDiscriminator, resolveCompilerResource } from './resource-resolution'
import type { WorkflowPackageProjection } from './types'

export interface ResourceActionContext {
  readonly package: WorkflowPackageProjection
  readonly workflow: WorkflowPairText
  readonly analysis: DocumentAnalysis
  readonly authoring: AuthoringContract
  readonly workspace: PackageCreationSnapshot
  readonly nodeId: string
  readonly scopeKey: GraphScopeKey
  /** Exact field_path of the verified resource-contract surface. */
  readonly fieldPath: string
}
export interface ResourceCreationInput extends ResourceActionContext {
  readonly basename: string
  readonly suffix?: string
  readonly initialText: string
}
export interface ResourceExtractionInput extends ResourceActionContext {
  readonly basename: string
  readonly suffix?: string
}
export interface ResourceSelectionInput extends ResourceActionContext {
  readonly artifactPath: string
}
export interface ResourceCreationPlan {
  readonly packageId: string
  readonly artifactPath: string
  readonly reference: string
  readonly initialText?: string
  readonly yamlMutation: WorkflowMutation
  readonly transaction: YamlTransaction
  readonly nextPair: WorkflowPairText
  readonly expectedRevision: DocumentRevision
  readonly expectedWorkspaceEntries: readonly ExpectedWorkspaceEntry[]
  readonly nativePlan: PackageMutationPlan
}
export class ResourceActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ResourceActionError'
  }
}
function fail(code: string, message: string): never {
  throw new ResourceActionError(code, message)
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function at(value: unknown, path: readonly (string | number)[]): unknown {
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = Reflect.get(value, key)
  }
  return value
}

export async function planResourceCreation(input: ResourceCreationInput): Promise<ResourceCreationPlan> {
  const prepared = await prepare(input)
  if (prepared.inline)
    fail('resource_inline_requires_extraction', 'Extract the existing inline source to preserve its content.')
  return create(input, prepared, input.initialText)
}
export async function planResourceExtraction(input: ResourceExtractionInput): Promise<ResourceCreationPlan> {
  const prepared = await prepare(input)
  if (!prepared.inline) fail('resource_not_inline', 'The selected field is not an inline script.')
  return create(input, prepared, prepared.value)
}
export async function planResourceSelection(input: ResourceSelectionInput): Promise<ResourceCreationPlan> {
  const prepared = await prepare(input)
  if (prepared.inline)
    fail('resource_inline_requires_extraction', 'Extract the inline source before replacing it with another resource.')
  const relative = relativeArtifact(input.artifactPath, input.package.root)
  const file = input.workspace.entries.find((entry) => entry.relativePath === input.artifactPath)
  if (!file || file.kind !== 'file' || file.symlink !== 'none' || !file.sha256)
    fail('resource_source_changed', 'Read and identify the selected package resource first.')
  const candidates = prepared.operations.flatMap((operation) => {
    const prefix = operation.directory ? `${operation.directory}/` : ''
    return relative.startsWith(prefix) ? [relative.slice(prefix.length)] : []
  })
  const reference = candidates.find((candidate) => {
    const result = resolveCompilerResource({
      contract: input.workspace.resourceContract,
      kind: prepared.kind,
      reference: candidate,
      ...(prepared.runtime ? { runtime: prepared.runtime } : {}),
      files: prepared.files,
    })
    return 'path' in result && result.path === relative
  })
  if (!reference)
    fail('resource_selection_unsupported', 'The selected resource is not resolvable through this field contract.')
  return finish(input, prepared, relative, reference, undefined, file.sha256)
}

type Prepared = Awaited<ReturnType<typeof prepare>>
async function prepare(input: ResourceActionContext) {
  const { workflow, authoring, workspace } = input
  if (
    workflow.generation !== workflow.savedGeneration ||
    [workflow.definition, ...(workflow.companion ? [workflow.companion] : [])].some(
      (file) => file.revision !== file.savedRevision || file.diskHash === null,
    )
  )
    fail('resource_unsaved_workflow', 'Save the workflow pair before creating or selecting a package resource.')
  const revision = createDocumentRevision(workflow, authoring.contract_digest)
  if (!input.analysis.structurallyValid || !isAnalysisCurrent(revision, input.analysis))
    fail('resource_stale_workflow', 'Validate the current workflow revision before changing resources.')
  const root = input.package.root
  if (
    (root !== '' && packagePathError(root)) ||
    !workspace.packages.some((pkg) => pkg.root === root && pkg.id === input.package.id)
  )
    fail('resource_package_required', 'Select a current package before changing its resources.')
  const definition = relativeArtifact(workflow.definition.path, root)
  const member = input.package.workflows.find((item) => item.definition === definition)
  const companion = workflow.companion ? relativeArtifact(workflow.companion.path, root) : null
  if (!member || (member.companion ?? null) !== companion)
    fail('resource_package_required', 'The workflow pair must belong to the selected package.')
  const manifestPath = packageArtifactPath(root, 'workflow-package.json')
  const manifestFile = workspace.entries.find((entry) => entry.relativePath === manifestPath)
  if (
    !manifestFile ||
    manifestFile.kind !== 'file' ||
    manifestFile.symlink !== 'none' ||
    !manifestFile.sha256 ||
    !/^[a-f0-9]{64}$/.test(manifestFile.sha256) ||
    manifestFile.text === undefined ||
    input.package.manifestPath !== manifestPath
  )
    fail('resource_package_required', 'Read the current package manifest before changing resources.')
  const parsedManifest = parsePackageManifest(manifestFile.text, manifestPath, workspace.contract)
  if (
    !parsedManifest.ok ||
    parsedManifest.manifest.id !== input.package.id ||
    JSON.stringify(parsedManifest.manifest.workflows) !== JSON.stringify(input.package.workflows)
  )
    fail('resource_package_required', 'Package membership changed; refresh the package before changing resources.')
  const expectations: ExpectedWorkspaceEntry[] = [
    { relativePath: manifestPath, expectedCurrentHash: manifestFile.sha256 },
  ]
  for (const file of [workflow.definition, ...(workflow.companion ? [workflow.companion] : [])]) {
    const disk = workspace.entries.find((entry) => entry.relativePath === file.path)
    if (
      !disk ||
      disk.text !== file.text ||
      disk.sha256 !== file.diskHash ||
      disk.kind !== 'file' ||
      disk.symlink !== 'none' ||
      disk.readOnly
    )
      fail('resource_source_changed', 'The saved workflow snapshot no longer matches the editor.')
    expectations.push({ relativePath: file.path, expectedCurrentHash: file.diskHash })
  }
  const entries = workspace.entries
    .filter((entry) => root === '' || entry.relativePath.startsWith(`${root}/`))
    .map((entry) => ({
      ...entry,
      relativePath: root === '' ? entry.relativePath : entry.relativePath.slice(root.length + 1),
    }))
  const pathErrors = validatePackagePaths(entries)
  if (pathErrors.length) fail(pathErrors[0]!.code, pathErrors[0]!.message)
  const admitted = admitResourceResolution(workspace.resourceContract, {
    version: workspace.resourceContract.contract_version,
    profile: authoring.profile,
    normalizer_version: authoring.normalizer_version,
    origins_supplied: true,
    host_python_supplied: workspace.hostPython !== undefined,
  })
  if (admitted) fail(admitted, 'The resource contract does not support this workflow context.')
  const analysis = await analyzePair(workflow, authoring)
  if (!analysis.structurallyValid)
    fail('resource_stale_workflow', 'The exact current workflow is not structurally valid.')
  if (!record(analysis.projection) || !Array.isArray(analysis.projection.graphs))
    fail('resource_stale_workflow', 'The workflow projection is unavailable.')
  const view = analysis.projection as unknown as WorkflowProjection
  const graph = view.graphs.find((item) => item.scope.key === input.scopeKey)
  const node = graph?.nodes.find((item) => item.id === input.nodeId)
  if (!graph || !node) fail('resource_node_missing', 'The selected node no longer exists in this scope.')
  const surface = resolveResourceFieldSurface(
    workspace.resourceContract,
    input.fieldPath,
    node.kind,
    graph.scope.kind === 'root' ? 'root' : 'body',
  )
  if (!surface || typeof surface.relative_path !== 'string' || typeof surface.lookup_kind !== 'string')
    fail('resource_field_unsupported', 'Only contract-declared resource fields can be changed.')
  const relativePath = surface.relative_path.split('.')
  if (
    (surface.optionSurface !== true && relativePath[0] !== node.kind) ||
    relativePath.some((part) => !part || part === '__proto__' || part === 'constructor' || part === 'prototype')
  )
    fail('resource_field_unsupported', 'The resource field selector is unsupported.')
  const descriptor = authoring.node_kinds.find((kind) => kind.id === node.kind)
  if (!descriptor?.fields.some((field) => field.field_path === `nodes[].${surface.relative_path}`))
    fail('resource_field_unsupported', 'The authoring contract does not declare this resource field.')
  const nodeIndex = graph.definitionOrder.indexOf(node.id)
  if (nodeIndex < 0) fail('resource_stale_workflow', 'The node source position is unavailable.')
  const path = [...graph.sourcePath, nodeIndex, ...relativePath]
  const authoredValue = at(view.definition, path)
  const value = surface.optionSurface === true && authoredValue === undefined ? '' : authoredValue
  if (typeof value !== 'string')
    fail('resource_field_unsupported', 'The selected resource field must contain authored text.')
  let inline = false
  if (typeof surface.value_discriminator === 'string') {
    const result = interpretResourceDiscriminator(
      at(workspace.resourceContract.value_discriminators_v1, [surface.value_discriminator]),
      value,
    )
    if (result === null) fail('unsupported_resource_contract', 'The resource discriminator is unsupported.')
    inline = result
  }
  const runtimeDescriptor = descriptor.fields.find((field) => field.id === `${node.kind}.node.runtime`)
  const rootGraph = view.graphs.find((item) => item.scope.kind === 'root')
  const group =
    graph.scope.kind === 'loop-group' ? rootGraph?.nodes.find((item) => item.id === graph.scope.groupId) : undefined
  const options = { ...(record(view.definition) ? view.definition : {}), ...group?.options, ...node.options }
  const runtimeValue = runtimeDescriptor
    ? at(options, runtimeDescriptor.field_path.replace(/^nodes\[\]\./, '').split('.'))
    : undefined
  const runtime = typeof runtimeValue === 'string' ? runtimeValue : undefined
  const kind = surface.lookup_kind
  const candidates = at(workspace.resourceContract.candidate_rules['compiler-source'], [kind])
  const selected = record(candidates) && runtime ? candidates[runtime] : candidates
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    !selected.every(
      (operation) =>
        record(operation) &&
        typeof operation.directory === 'string' &&
        typeof operation.suffix === 'string' &&
        (operation.operation === 'identity' || operation.operation === 'replace-suffix'),
    )
  )
    fail('resource_runtime_required', 'Select a supported resource runtime before creating a file.')
  const operations = selected as unknown as readonly ResourceCandidateOperation[]
  const files = new Map(entries.map((entry) => [entry.relativePath, { kind: entry.kind }]))
  return {
    expectations,
    revision,
    analysis,
    path,
    value,
    inline,
    kind,
    runtime,
    runtimeBound: record(candidates),
    surface,
    operations,
    files,
    entries,
  }
}

async function create(
  input: ResourceExtractionInput,
  prepared: Prepared,
  initialText: string,
): Promise<ResourceCreationPlan> {
  if (
    packagePathError(input.basename) ||
    input.basename.includes('/') ||
    input.basename.includes('.') ||
    input.basename.startsWith('~')
  )
    fail('resource_name_invalid', 'Choose a single resource name without an extension.')
  const suffixes = prepared.operations.filter((operation) => operation.operation === 'replace-suffix')
  const selected =
    input.suffix === undefined ? suffixes[0] : suffixes.find((operation) => operation.suffix === input.suffix)
  if (!selected || !selected.suffix || (selected.directory && packagePathError(selected.directory)))
    fail('resource_suffix_unsupported', 'Choose an extension declared by this resource rule.')
  const relative = `${selected.directory ? `${selected.directory}/` : ''}${input.basename}${selected.suffix}`
  if (packagePathError(relative)) fail('resource_name_invalid', 'The resulting resource path is not canonical.')
  const proposed = {
    relativePath: relative,
    kind: 'file' as const,
    symlink: 'none' as const,
    readOnly: false,
    modifiedAt: '',
    size: new TextEncoder().encode(initialText).byteLength,
  }
  if (prepared.entries.some((entry) => packagePathIdentity(entry.relativePath) === packagePathIdentity(relative)))
    fail('package_path_collision', 'The resource path already exists.')
  const invalid = validatePackagePaths([...prepared.entries, proposed])
  if (invalid.length) fail(invalid[0]!.code, invalid[0]!.message)
  const reference = input.suffix === undefined ? input.basename : `${input.basename}${selected.suffix}`
  const result = resolveCompilerResource({
    contract: input.workspace.resourceContract,
    kind: prepared.kind,
    reference,
    ...(prepared.runtime ? { runtime: prepared.runtime } : {}),
    files: new Map([...prepared.files, [relative, { kind: 'file' as const }]]),
  })
  if (!('path' in result) || result.path !== relative)
    fail('resource_resolution_ambiguous', 'An existing resource shadows the requested name; choose another name.')
  return finish(input, prepared, relative, reference, initialText, null)
}

async function finish(
  input: ResourceActionContext,
  prepared: Prepared,
  relative: string,
  reference: string,
  initialText: string | undefined,
  expectedHash: string | null,
): Promise<ResourceCreationPlan> {
  if (typeof prepared.surface.value_discriminator === 'string') {
    const discriminator = at(input.workspace.resourceContract.value_discriminators_v1, [
      prepared.surface.value_discriminator,
    ])
    if (interpretResourceDiscriminator(discriminator, reference) !== false)
      fail('resource_name_invalid', 'Choose a resource name that cannot be interpreted as inline source.')
  }
  const runtimeValidation = input.workspace.resourceContract.runtime_validation
  const namePattern = at(runtimeValidation, [`${prepared.kind}_name_pattern`])
  if (typeof namePattern === 'string' && !new RegExp(namePattern).test(reference))
    fail('resource_name_invalid', 'The resource name does not match its contract.')
  if (prepared.runtimeBound) {
    const suffixes = at(runtimeValidation, [`${prepared.runtime}_suffixes`])
    const suffix = relative.slice(relative.lastIndexOf('.')).toLowerCase()
    if (!Array.isArray(suffixes) || !suffixes.includes(suffix))
      fail('resource_suffix_unsupported', 'The selected file extension does not match the resource runtime.')
  }
  const yamlMutation: WorkflowMutation = {
    type: 'set-field',
    document: 'definition',
    path: prepared.path,
    value: reference,
  }
  const result = await applyWorkflowMutation(
    input.workflow,
    yamlMutation,
    input.authoring,
    analyzePair,
    prepared.analysis,
  )
  if (!result.ok) fail(result.code, result.message)
  const validated = result.analysis ?? (await analyzePair(result.pair, input.authoring))
  if (!validated.structurallyValid)
    fail('resource_invalid_workflow', 'The proposed resource reference makes the workflow invalid.')
  const artifactPath = packageArtifactPath(input.package.root, relative)
  const expected = new Map(prepared.expectations.map((entry) => [entry.relativePath, entry.expectedCurrentHash]))
  // Run the production resolver against a traced map. Its reads before the selected file
  // are the higher-priority candidates whose absence must survive until native commit.
  let selectedRead = false
  const lookupFiles = new Map(prepared.files)
  if (initialText !== undefined) lookupFiles.set(relative, { kind: 'file' })
  const originalGet = lookupFiles.get.bind(lookupFiles)
  lookupFiles.get = (path: string) => {
    if (!selectedRead) {
      const known = input.workspace.entries.find(
        (entry) => entry.relativePath === packageArtifactPath(input.package.root, path),
      )
      expected.set(
        packageArtifactPath(input.package.root, path),
        path === relative ? expectedHash : (known?.sha256 ?? null),
      )
    }
    if (path === relative) selectedRead = true
    return originalGet(path)
  }
  const resolved = resolveCompilerResource({
    contract: input.workspace.resourceContract,
    kind: prepared.kind,
    reference,
    ...(prepared.runtime ? { runtime: prepared.runtime } : {}),
    files: lookupFiles,
  })
  if (!('path' in resolved) || resolved.path !== relative)
    fail('resource_resolution_ambiguous', 'Resource lookup changed during planning.')
  const expectedWorkspaceEntries = [...expected].map(([relativePath, expectedCurrentHash]) => ({
    relativePath,
    expectedCurrentHash,
  }))
  const proposedEntries = prepared.entries.map((entry) =>
    entry.relativePath === relativeArtifact(input.workflow.definition.path, input.package.root)
      ? { ...entry, size: new TextEncoder().encode(result.pair.definition.text).byteLength }
      : entry,
  )
  if (initialText !== undefined)
    proposedEntries.push({
      relativePath: relative,
      kind: 'file',
      symlink: 'none',
      readOnly: false,
      modifiedAt: '',
      size: new TextEncoder().encode(initialText).byteLength,
    })
  assertPackageContentLimits(proposedEntries, input.workspace.contract)
  const nativePlan: PackageMutationPlan = {
    workspaceId: input.workspace.workspaceId,
    expectedEntries: expectedWorkspaceEntries,
    writes: [
      ...(initialText !== undefined
        ? [{ relativePath: artifactPath, text: initialText, expectedCurrentHash: null }]
        : []),
      {
        relativePath: input.workflow.definition.path,
        text: result.pair.definition.text,
        expectedCurrentHash: input.workflow.definition.diskHash,
      },
    ],
    moves: [],
    trashes: [],
  }
  return {
    packageId: input.package.id,
    artifactPath,
    reference,
    ...(initialText !== undefined ? { initialText } : {}),
    yamlMutation,
    transaction: result.transaction,
    nextPair: result.pair,
    expectedRevision: prepared.revision,
    expectedWorkspaceEntries,
    nativePlan,
  }
}
function relativeArtifact(path: string, root: string): string {
  if (packagePathError(path) || (root !== '' && !path.startsWith(`${root}/`)))
    fail('resource_package_required', 'The artifact must remain inside the selected package.')
  return root === '' ? path : path.slice(root.length + 1)
}
async function analyzePair(pair: WorkflowPairText, contract: AuthoringContract): Promise<DocumentAnalysis> {
  return analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'resource-action',
      workflowId: pair.workflowId,
      pairGeneration: pair.generation,
      definition: pair.definition,
      companion: pair.companion,
      profile: contract.profile,
      contractDigest: contract.contract_digest,
      reason: 'explicit-validate',
    },
    contract,
  )
}

export function resolveResourceFieldSurface(
  contract: ResourceResolutionContract,
  fieldPath: string,
  nodeKind: string,
  scope: 'root' | 'body',
): Readonly<Record<string, unknown>> | null {
  if (!Array.isArray(contract.surfaces)) return null
  const matches = contract.surfaces.filter(
    (surface) =>
      record(surface) &&
      surface.field_path === fieldPath &&
      surface.scope === scope &&
      Array.isArray(surface.node_types) &&
      surface.node_types.includes(nodeKind),
  )
  if (matches.length === 1 && record(matches[0])) return matches[0]
  if (matches.length > 1) return null
  const mcp = contract.mcp_surface
  const scopePath = at(contract.scope, [scope])
  if (
    !record(mcp) ||
    typeof mcp.field !== 'string' ||
    typeof mcp.lookup_kind !== 'string' ||
    mcp.source !== 'effective-scoped-node-options' ||
    !Array.isArray(mcp.skip_node_types) ||
    mcp.skip_node_types.includes(nodeKind) ||
    typeof scopePath !== 'string' ||
    fieldPath !== `${scopePath}.${mcp.field}`
  )
    return null
  return { field_path: fieldPath, relative_path: mcp.field, lookup_kind: mcp.lookup_kind, optionSurface: true }
}

function packageArtifactPath(root: string, path: string): string {
  return root ? `${root}/${path}` : path
}
