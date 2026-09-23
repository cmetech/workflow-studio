import type { AuthoringContract } from '../contract/types'
import type { DocumentAnalysis, WorkflowPairText } from '../documents/types'
import type { MutationAnalyzer } from '../documents/transactions'
import type { PackageMutationPlan } from '../native/types'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import { freezePackageValue } from '../package-contract/package-contract-loader'
import type { CapturedPackageAnalysis } from '../../features/packages/package-analysis'
import { analyzeWorkflowPair, selectWorkflowProfile } from '../validation/analyze-workflow'
import { parseWorkflowYaml } from '../yaml/parse-document'
import type { WorkflowProjection } from '../projection/types'
import { assertPackageContentLimits, type PackageCreationEntry } from './creation'
import { replaceManifestProperty } from './manifest-edit'
import { parsePackageManifest } from './manifest'
import { resolvePackageReferences, type PackageReference } from './package-references'
import { planResourceSelection } from './resource-actions'
import { packagePathError, packagePathIdentity, validatePackagePaths } from './paths'
import type { PackageWorkflowMember } from './types'

export type PackageArtifactAction = 'rename' | 'replace' | 'reveal' | 'open-externally' | 'trash' | 'remove-workflow'
export type PackageMutationRequest =
  | { readonly kind: 'remove-workflow'; readonly definition: string; readonly trashPair: boolean }
  | { readonly kind: 'rename-artifact'; readonly path: string; readonly destination: string }
  | { readonly kind: 'trash-artifact'; readonly path: string }
export interface PackageMutationContext {
  readonly analyzePair?: MutationAnalyzer
  readonly capture: CapturedPackageAnalysis
  readonly contract: WorkflowPackageContract
  readonly resourceContract: ResourceResolutionContract
  readonly authoring: readonly AuthoringContract[]
}
export interface PackageMutationChange {
  readonly path: string
  readonly operation: 'write' | 'move' | 'trash' | 'replace'
  readonly expectedHash: string | null
  readonly destination?: string
  readonly before?: string
  readonly after?: string
}
export interface PackageMutationPreview {
  readonly root: string
  readonly request: PackageMutationRequest
  readonly plan: PackageMutationPlan
  readonly changes: readonly PackageMutationChange[]
  readonly referenceChanges: readonly {
    readonly workflowPath: string
    readonly nodeId: string
    readonly from: string
    readonly to: string
  }[]
}
export class PackageMutationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly references: readonly PackageReference[] = [],
    readonly manualReferences: readonly { readonly path: string; readonly line: number }[] = [],
  ) {
    super(message)
    this.name = 'PackageMutationError'
  }
}
function fail(code: string, message: string): never {
  throw new PackageMutationError(code, message)
}
interface WorkflowState {
  path: string
  authoring: AuthoringContract
  pair: WorkflowPairText
  analysis: DocumentAnalysis
}
const analyzePair: MutationAnalyzer = (pair, contract) =>
  analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'package-mutation:' + pair.workflowId,
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
async function workflows(
  context: PackageMutationContext,
  members: readonly PackageWorkflowMember[],
  entries: readonly PackageCreationEntry[],
): Promise<WorkflowState[]> {
  const root = context.capture.package.root
  const full = (path: string) => (root ? root + '/' + path : path)
  const result: WorkflowState[] = []
  for (const member of members) {
    const file = (path: string, kind: 'definition' | 'companion') => {
      const entry = entries.find((value) => value.relativePath === full(path))
      if (!entry || entry.text === undefined || !entry.sha256)
        fail('package_member_missing', `Read the declared member first: ${path}`)
      return {
        id: full(path),
        kind,
        path: full(path),
        text: entry.text,
        diskHash: entry.sha256,
        revision: 0,
        savedRevision: 0,
      }
    }
    const definition = file(member.definition, 'definition')
    const companion = member.companion ? file(member.companion, 'companion') : null
    const value = companion
      ? parseWorkflowYaml(companion.text, {
          document: 'companion',
          maxBytes: context.contract.resource_rules.max_file_bytes,
        }).parsed?.document.toJS({ maxAliasCount: 1000 })
      : null
    const profile = selectWorkflowProfile(value)
    const matches = context.authoring.filter((contract) => contract.profile === profile.profile)
    if (!profile.recognized || matches.length !== 1)
      fail('package_authoring_contract_required', 'Select an unambiguous authoring contract for every member.')
    const authoring = matches[0]!
    const pair: WorkflowPairText = {
      workflowId: full(member.definition),
      generation: 0,
      savedGeneration: 0,
      definition,
      companion,
    }
    const analysis = await (context.analyzePair ?? analyzePair)(pair, authoring)
    if (!analysis.structurallyValid)
      fail('package_workflow_invalid', `Fix workflow structure before changing references: ${member.definition}`)
    result.push({ path: member.definition, authoring, pair, analysis })
  }
  return result
}
/** No I/O: all proposals remain bound to the complete captured package and original file hashes. */
export async function planPackageMutation(
  context: PackageMutationContext,
  request: PackageMutationRequest,
): Promise<PackageMutationPreview> {
  const analyses = new Map<string, Promise<DocumentAnalysis>>()
  const analyze: MutationAnalyzer = (pair, contract) => {
    const key = JSON.stringify([
      pair.workflowId,
      pair.generation,
      pair.definition.path,
      pair.definition.text,
      pair.definition.revision,
      pair.companion?.path,
      pair.companion?.text,
      pair.companion?.revision,
      contract.contract_digest,
    ])
    let result = analyses.get(key)
    if (!result) {
      result = (context.analyzePair ?? analyzePair)(pair, contract)
      analyses.set(key, result)
    }
    return result
  }
  const analysisContext = { ...context, analyzePair: analyze }
  const { capture } = context
  const root = capture.package.root,
    prefix = root ? root + '/' : ''
  const full = (path: string) => prefix + path
  if ((root && packagePathError(root)) || capture.snapshot.packageRoot !== root)
    fail('package_path_invalid', 'The package root is not canonical.')
  const original = new Map(capture.snapshot.files.map((file) => [file.relativePath, file]))
  const entries: PackageCreationEntry[] = capture.snapshot.entries.map((entry) => {
    const relative = entry.relativePath.slice(prefix.length),
      hash = original.get(relative)?.sha256,
      text = capture.artifactTexts.get(relative)
    return { ...entry, ...(hash ? { sha256: hash } : {}), ...(text !== undefined ? { text } : {}) }
  })
  const parsed = parsePackageManifest(capture.manifestText, full('workflow-package.json'), context.contract)
  if (!parsed.ok) fail('package_manifest_invalid', 'Repair the package manifest before changing membership.')
  let members = [...parsed.manifest.workflows]
  const manifestFile = original.get('workflow-package.json')
  if (!manifestFile) fail('package_manifest_invalid', 'The captured manifest hash is missing.')
  const expected = new Map([...original].map(([path, file]) => [full(path), file.sha256 as string | null]))
  const writes: PackageMutationPlan['writes'][number][] = [],
    moves: PackageMutationPlan['moves'][number][] = [],
    trashes: PackageMutationPlan['trashes'][number][] = []
  const referenceChanges: PackageMutationPreview['referenceChanges'][number][] = []
  const writable = (path: string) => {
    if (packagePathError(path)) fail('package_path_invalid', 'Use a canonical path inside the selected package.')
    const entry = entries.find((entry) => entry.relativePath === full(path))
    if (!entry || entry.kind !== 'file' || !entry.sha256 || entry.readOnly || entry.symlink !== 'none')
      fail('package_artifact_unavailable', `The file is missing, read-only, or not a regular captured file: ${path}`)
    return entry
  }
  writable('workflow-package.json')
  const writeManifest = () => {
    const text = replaceManifestProperty(capture.manifestText, 'workflows', members)
    if (!parsePackageManifest(text, full('workflow-package.json'), context.contract).ok)
      fail('package_manifest_invalid', 'The proposed membership is not valid.')
    writes.push({ relativePath: full('workflow-package.json'), text, expectedCurrentHash: manifestFile.sha256 })
  }
  if (request.kind === 'remove-workflow') {
    const member = members.find((member) => member.definition === request.definition)
    if (!member) fail('package_member_missing', 'Select a declared workflow member.')
    if (members.length === 1)
      fail(
        'package_last_workflow',
        'A package requires at least one workflow. Add another workflow before removing this one.',
      )
    for (const path of [member.definition, ...(member.companion ? [member.companion] : [])]) {
      const file = writable(path)
      if (request.trashPair) trashes.push({ relativePath: file.relativePath, expectedCurrentHash: file.sha256! })
    }
    members = members.filter((candidate) => candidate !== member)
    writeManifest()
  } else {
    const path = request.path,
      source = writable(path)
    if (
      ['workflow-package.json', 'digests.json', '.well-known/hermes-workflows/index.json'].includes(
        packagePathIdentity(path),
      )
    )
      fail('package_artifact_reserved', 'Generated package metadata cannot be renamed or trashed.')
    const declared = members.some((member) => member.definition === path || member.companion === path)
    if (request.kind === 'trash-artifact' && declared)
      fail('package_member_removal_required', 'Use Remove Workflow to remove a declared pair.')
    const beforeWorkflows = await workflows(analysisContext, members, entries)
    const resolve = (
      currentMembers: readonly PackageWorkflowMember[],
      currentEntries: readonly PackageCreationEntry[],
      currentWorkflows: readonly WorkflowState[],
    ) =>
      resolvePackageReferences({
        contract: context.resourceContract,
        packageRoot: root,
        members: currentMembers,
        files: new Map(
          currentEntries.map((entry) => [
            entry.relativePath.slice(prefix.length),
            { kind: entry.symlink === 'none' ? entry.kind : 'symlink' },
          ]),
        ),
        artifactTexts: new Map(
          currentEntries.flatMap((entry) =>
            entry.text === undefined ? [] : [[entry.relativePath.slice(prefix.length), entry.text] as const],
          ),
        ),
        workflows: currentWorkflows.map(({ path, authoring, analysis }) => ({ path, authoring, analysis })),
      })
    const before = resolve(members, entries, beforeWorkflows)
    if (before.findings.some((finding) => finding.severity === 'blocking'))
      fail('package_reference_analysis_required', 'Resolve package resource findings before changing artifact paths.')
    const consumers = before.references.filter((reference) => reference.artifactPath === path)
    if (request.kind === 'trash-artifact' && consumers.length)
      throw new PackageMutationError(
        'package_artifact_referenced',
        'The artifact is referenced. Update these consumers before moving it to Trash.',
        consumers,
      )
    let projected = entries.filter((entry) => entry.relativePath !== source.relativePath)
    if (request.kind === 'rename-artifact') {
      const destination = request.destination
      if (
        packagePathError(destination) ||
        ['workflow-package.json', 'digests.json'].includes(packagePathIdentity(destination))
      )
        fail('package_path_invalid', 'Choose a canonical, non-reserved destination inside this package.')
      if (entries.some((entry) => packagePathIdentity(entry.relativePath) === packagePathIdentity(full(destination))))
        fail('package_path_collision', 'The destination already exists or has the same case-fold identity.')
      projected.push({ ...source, relativePath: full(destination) })
      const invalid = validatePackagePaths(
        projected.map((entry) => ({ ...entry, relativePath: entry.relativePath.slice(prefix.length) })),
      )[0]
      if (invalid) fail(invalid.code, invalid.message)
      expected.set(full(destination), null)
      moves.push({ sourcePath: full(path), destinationPath: full(destination) })
      if (declared) {
        members = members.map((member) => ({
          ...member,
          definition: member.definition === path ? destination : member.definition,
          ...(member.companion === path ? { companion: destination } : {}),
        }))
        writeManifest()
      }
      for (const reference of consumers) {
        if (declared)
          throw new PackageMutationError(
            'package_manual_references',
            'This resource reference requires manual editing before renaming.',
            [reference],
          )
        const currentWorkflows = await workflows(
          analysisContext,
          members.filter((member) => member.definition === reference.workflowPath),
          projected,
        )
        const workflow = currentWorkflows.find((item) => item.path === reference.workflowPath)!
        const projection = workflow.analysis.projection as WorkflowProjection
        const graph = projection.graphs.find((graph) =>
          graph.nodes.some(
            (node) =>
              (graph.scope.kind === 'loop-group' ? graph.scope.groupId + '/' + node.id : node.id) === reference.nodeId,
          ),
        )
        const node = graph?.nodes.find(
          (node) =>
            (graph.scope.kind === 'loop-group' ? graph.scope.groupId + '/' + node.id : node.id) === reference.nodeId,
        )
        if (!graph || !node)
          fail('package_reference_analysis_required', 'The resource consumer cannot be identified unambiguously.')
        const selected = await planResourceSelection({
          analyzePair: analyze,
          package: capture.package,
          workflow: workflow.pair,
          analysis: workflow.analysis,
          authoring: workflow.authoring,
          workspace: {
            workspaceId: capture.snapshot.workspaceId,
            contract: context.contract,
            resourceContract: context.resourceContract,
            entries: projected,
            packages: [{ root, id: capture.package.id }],
          },
          nodeId: node.id,
          scopeKey: graph.scope.key,
          fieldPath: reference.fieldPath,
          artifactPath: full(destination),
        }).catch(() => {
          throw new PackageMutationError(
            'package_manual_references',
            'This resource reference requires manual editing before renaming.',
            [reference],
          )
        })
        const text = selected.nextPair.definition.text
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        const sha256 = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        projected = projected.map((entry) =>
          entry.relativePath === workflow.pair.definition.path
            ? { ...entry, text, sha256, size: new TextEncoder().encode(text).length }
            : entry,
        )
        referenceChanges.push({
          workflowPath: reference.workflowPath,
          nodeId: reference.nodeId,
          from: reference.reference,
          to: selected.reference,
        })
      }
      const after = resolve(members, projected, await workflows(analysisContext, members, projected))
      if (after.findings.some((finding) => finding.severity === 'blocking'))
        fail('package_reference_rewrite_ambiguous', 'The proposed paths do not have a proven resource resolution.')
      for (const reference of before.references) {
        const workflowPath = reference.workflowPath === path ? destination : reference.workflowPath
        const next = after.references.filter(
          (item) =>
            item.workflowPath === workflowPath &&
            item.nodeId === reference.nodeId &&
            item.fieldPath === reference.fieldPath,
        )
        const expectedPath = reference.artifactPath === path ? destination : reference.artifactPath
        if (next.length !== 1 || next[0]!.artifactPath !== expectedPath || next[0]!.ownership !== reference.ownership)
          fail('package_reference_rewrite_ambiguous', 'Renaming would change or shadow another resource binding.')
      }
      for (const entry of projected) {
        const prior = entries.find((item) => item.relativePath === entry.relativePath)
        if (prior && entry.text !== undefined && entry.text !== prior.text)
          writes.push({ relativePath: entry.relativePath, text: entry.text, expectedCurrentHash: prior.sha256! })
      }
    } else trashes.push({ relativePath: full(path), expectedCurrentHash: source.sha256! })
    const tokens = [path, path.split('/').at(-1)!]
    const manualReferences = projected.flatMap((entry) => {
      const relative = entry.relativePath.slice(prefix.length)
      if (['workflow-package.json', 'digests.json'].includes(relative) || entry.text === undefined) return []
      return entry.text
        .split(/\r?\n/)
        .flatMap((line, index) =>
          tokens.some((token) => line.includes(token)) ? [{ path: relative, line: index + 1 }] : [],
        )
    })
    if (manualReferences.length)
      throw new PackageMutationError(
        'package_manual_references',
        'These textual references need manual edits before changing the artifact path.',
        [],
        manualReferences,
      )
    assertPackageContentLimits(
      projected.map((entry) => ({ ...entry, relativePath: entry.relativePath.slice(prefix.length) })),
      context.contract,
    )
  }
  const plan: PackageMutationPlan = {
    workspaceId: capture.snapshot.workspaceId,
    packageSnapshotToken: capture.snapshot.sourceSnapshotToken,
    expectedEntries: [...expected].map(([relativePath, expectedCurrentHash]) => ({
      relativePath,
      expectedCurrentHash,
    })),
    writes,
    moves,
    trashes,
  }
  const changes: PackageMutationChange[] = [
    ...writes.map((write) => ({
      path: write.relativePath,
      operation: 'write' as const,
      expectedHash: write.expectedCurrentHash,
      before: capture.artifactTexts.get(write.relativePath.slice(prefix.length)) ?? '',
      after: write.text,
    })),
    ...moves.map((move) => ({
      path: move.sourcePath,
      operation: 'move' as const,
      destination: move.destinationPath,
      expectedHash: expected.get(move.sourcePath)!,
    })),
    ...trashes.map((trash) => ({
      path: trash.relativePath,
      operation: 'trash' as const,
      expectedHash: trash.expectedCurrentHash,
    })),
  ]
  return freezePackageValue({ root, request: { ...request }, plan, changes, referenceChanges })
}
