import { parseAllDocuments } from 'yaml'
import type { AuthoringContract } from '../contract/types'
import type { DocumentAnalysis } from '../documents/types'
import { freezePackageValue } from '../package-contract/package-contract-loader'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import type { WorkflowProjection } from '../projection/types'
import { comparePackagePaths, packagePathError } from './paths'
import {
  admitResourceResolution,
  collectMcpCandidates,
  interpretResourceDiscriminator,
  resolveCompilerResource,
  type ResourceFile,
} from './resource-resolution'
import type { PackageFinding, PackageWorkflowMember } from './types'

export interface PackageReference {
  readonly workflowPath: string
  /** Body nodes use group/node, preserving identity across scopes. */
  readonly nodeId: string
  readonly fieldPath: string
  readonly kind: string
  readonly ownership: 'packaged' | 'external'
  readonly artifactPath: string | null
  readonly reference: string
  readonly ruleId: string
  readonly runtime?: string
}
export interface InlinePackageScript {
  readonly workflowPath: string
  readonly nodeId: string
  readonly source: string
  readonly runtime: string | null
}
export interface PackageReferenceGraph {
  readonly references: readonly PackageReference[]
  readonly inlineScripts: readonly InlinePackageScript[]
  readonly findings: readonly PackageFinding[]
  readonly unreferencedPaths: readonly string[]
  forNode(nodeId: string, workflowPath?: string): readonly PackageReference[]
}
export interface PackageReferenceInput {
  readonly contract: ResourceResolutionContract
  readonly packageRoot: string
  readonly members: readonly PackageWorkflowMember[]
  readonly files: ReadonlyMap<string, ResourceFile>
  readonly artifactTexts: ReadonlyMap<string, string>
  readonly workflows: readonly {
    readonly path: string
    readonly authoring: AuthoringContract
    readonly analysis: DocumentAnalysis
  }[]
  /** Explicit target context, never guessed from the Studio host. */
  readonly hostPython?: string
  readonly maxArtifactBytes?: number
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function read(value: unknown, path: readonly string[]): unknown {
  for (const part of path) {
    if (!record(value) || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}
function projection(value: unknown): value is WorkflowProjection {
  return record(value) && Array.isArray(value.graphs) && record(value.definition)
}
export function sortPackageFindings(findings: readonly PackageFinding[]): readonly PackageFinding[] {
  return findings
    .slice()
    .sort(
      (a, b) =>
        comparePackagePaths(a.path, b.path) ||
        (a.line ?? 0) - (b.line ?? 0) ||
        (a.column ?? 0) - (b.column ?? 0) ||
        comparePackagePaths(a.code, b.code) ||
        comparePackagePaths(a.message, b.message),
    )
}

/** Pure derived view of current YAML analyses and a bounded package snapshot; never persists a second graph. */
export function resolvePackageReferences(input: PackageReferenceInput): PackageReferenceGraph {
  const references: PackageReference[] = []
  const inlineScripts: InlinePackageScript[] = []
  const findings: PackageFinding[] = []
  const { contract } = input
  const add = (code: string, path: string, message: string, causeCode?: string) => {
    findings.push({ code, path, message, severity: 'blocking', ...(causeCode ? { causeCode } : {}) })
  }
  const finish = (): PackageReferenceGraph => {
    const used = new Set([
      ...input.members.flatMap((m) => [m.definition, ...(m.companion ? [m.companion] : [])]),
      'workflow-package.json',
      'digests.json',
      ...references.flatMap((r) => (r.artifactPath ? [r.artifactPath] : [])),
    ])
    const sorted = references.sort(
      (a, b) =>
        comparePackagePaths(a.workflowPath, b.workflowPath) ||
        comparePackagePaths(a.nodeId, b.nodeId) ||
        comparePackagePaths(a.fieldPath, b.fieldPath) ||
        comparePackagePaths(a.artifactPath ?? a.reference, b.artifactPath ?? b.reference),
    )
    return freezePackageValue({
      references: sorted,
      inlineScripts,
      findings: sortPackageFindings(findings),
      unreferencedPaths: [...input.files]
        .filter(([path, file]) => file.kind === 'file' && !used.has(path))
        .map(([path]) => path)
        .sort(comparePackagePaths),
      forNode: (nodeId: string, workflowPath?: string) =>
        Object.freeze(
          sorted.filter((r) => r.nodeId === nodeId && (workflowPath === undefined || r.workflowPath === workflowPath)),
        ),
    })
  }
  const scope = contract.scope
  const mcp = contract.mcp_surface
  const surfaces = contract.surfaces
  const closure = contract.mcp_local_closure
  if (
    !record(scope) ||
    scope.root !== 'nodes[]' ||
    scope.body !== 'nodes[].loop_group.nodes[]' ||
    scope.root_effective_options !== 'normalized-node.options' ||
    JSON.stringify(scope.body_effective_options) !==
      JSON.stringify(['definition.options', 'group.options', 'node.options']) ||
    scope.option_merge !== 'shallow-last-wins' ||
    scope.body_depth_limit !== 1 ||
    scope.owner !== 'node.origin.package_key-to-source.root' ||
    !record(closure) ||
    closure.base !== 'owning-source-package-root' ||
    closure.selection !== 'cached-or-exists-or-symlink' ||
    closure.recursion !== 'selected-mcp-document-only-no-import-discovery' ||
    closure.normalizer_5_plus_exclusion !== 'host-python-executable' ||
    !record(mcp) ||
    mcp.source !== 'effective-scoped-node-options' ||
    typeof mcp.field !== 'string' ||
    typeof mcp.lookup_kind !== 'string' ||
    !Array.isArray(mcp.skip_node_types) ||
    !Array.isArray(surfaces) ||
    surfaces.some(
      (s: unknown) =>
        !record(s) ||
        !Array.isArray(s.node_types) ||
        typeof s.relative_path !== 'string' ||
        typeof s.field_path !== 'string' ||
        typeof s.lookup_kind !== 'string' ||
        typeof s.resource_kind !== 'string' ||
        !['root', 'body'].includes(String(s.scope)),
    )
  ) {
    add('unsupported_resource_contract', input.packageRoot, 'Resource descriptors are not supported by this editor.')
    return finish()
  }
  for (const member of input.members) {
    const matches = input.workflows.filter((w) => w.path === member.definition)
    const workflow = matches[0]
    const expectedPath = input.packageRoot ? `${input.packageRoot}/${member.definition}` : member.definition
    const expectedCompanion = member.companion
      ? input.packageRoot
        ? `${input.packageRoot}/${member.companion}`
        : member.companion
      : null
    if (
      matches.length !== 1 ||
      !workflow ||
      workflow.analysis.definitionPath !== expectedPath ||
      workflow.analysis.companionPath !== expectedCompanion ||
      workflow.analysis.contractDigest !== workflow.authoring.contract_digest ||
      !projection(workflow.analysis.projection)
    ) {
      add('package_analysis_required', member.definition, 'A current workflow analysis is required.')
      continue
    }
    const { analysis, authoring } = workflow
    const view = analysis.projection as WorkflowProjection
    if (!analysis.structurallyValid) {
      add('package_workflow_invalid', member.definition, 'Fix workflow structure before preparing the package.')
      continue
    }
    const admitted = admitResourceResolution(contract, {
      version: 1,
      profile: view.profile,
      normalizer_version: authoring.normalizer_version,
      origins_supplied: true,
      host_python_supplied: input.hostPython !== undefined,
    })
    if (admitted || view.profile !== authoring.profile) {
      add(admitted ?? 'package_analysis_required', member.definition, 'The workflow resource context is not supported.')
      continue
    }
    const root = view.graphs.find((g) => g.scope.kind === 'root')
    if (!root || !root.nodes.length) {
      add('package_analysis_required', member.definition, 'Workflow graph analysis is incomplete.')
      continue
    }
    for (const graph of view.graphs) {
      const body = graph.scope.kind === 'loop-group'
      if (
        body &&
        (!Array.isArray(scope.body_normalizer_versions) ||
          !scope.body_normalizer_versions.includes(authoring.normalizer_version))
      ) {
        add(
          'unsupported_resource_profile',
          member.definition,
          'Body resource resolution is unavailable for this normalizer.',
        )
        continue
      }
      const group = body ? root?.nodes.find((n) => n.id === graph.scope.groupId) : undefined
      for (const node of graph.nodes) {
        const nodeId = body ? `${graph.scope.groupId}/${node.id}` : node.id
        if (!authoring.node_kinds.some((kind) => kind.id === node.kind)) {
          add(
            'resource_resolution_context_required',
            member.definition,
            `Included workflow ${nodeId} requires catalog-selected source origins.`,
          )
          continue
        }
        const options = { ...(record(view.definition) ? view.definition : {}), ...group?.options, ...node.options }
        const runtimeField = authoring.node_kinds
          .find((k) => k.id === node.kind)
          ?.fields.find((f) => f.id === `${node.kind}.node.runtime`)
        const runtimeValue = runtimeField
          ? read(options, runtimeField.field_path.replace(/^nodes\[\]\./, '').split('.'))
          : undefined
        const runtime = typeof runtimeValue === 'string' ? runtimeValue : undefined
        const bind = (reference: string, kind: string, fieldPath: string, resourceKind: string): string | null => {
          const runtimeBound = record(read(contract.candidate_rules['compiler-source'], [kind]))
          const result = resolveCompilerResource({
            contract,
            kind,
            reference,
            ...(runtimeBound && runtime ? { runtime } : {}),
            files: input.files,
          })
          if ('code' in result) {
            const missing =
              record(contract.diagnostics) &&
              record(contract.diagnostics.compiler_missing) &&
              Object.values(contract.diagnostics.compiler_missing).includes(result.code)
            add(
              missing ? 'package_resource_missing' : result.code,
              member.definition,
              `${nodeId}: cannot resolve ${reference}.`,
              result.code,
            )
            return null
          }
          references.push({
            workflowPath: member.definition,
            nodeId,
            fieldPath,
            kind: resourceKind,
            ownership: 'packaged',
            artifactPath: result.path,
            reference,
            ruleId: fieldPath,
            ...(runtimeBound && runtime ? { runtime } : {}),
          })
          return result.path
        }
        for (const descriptor of surfaces) {
          const surface = descriptor as Record<string, unknown>
          if (surface.scope !== (body ? 'body' : 'root') || !(surface.node_types as unknown[]).includes(node.kind))
            continue
          const path = (surface.relative_path as string).split('.')
          if (path.shift() !== node.kind) {
            add('unsupported_resource_contract', member.definition, 'Resource selector does not match its node kind.')
            continue
          }
          const value = path.length ? read(node.value, path) : node.value
          if (value === undefined) continue
          if (typeof value !== 'string') {
            add('package_workflow_invalid', member.definition, `${nodeId}: resource reference must be text.`)
            continue
          }
          if (typeof surface.value_discriminator === 'string') {
            const discriminator = read(contract.value_discriminators_v1, [surface.value_discriminator])
            const inline = interpretResourceDiscriminator(discriminator, value)
            if (inline === null) {
              add('unsupported_resource_contract', member.definition, 'Resource discriminator is not supported.')
              continue
            }
            if (inline) {
              inlineScripts.push({ workflowPath: member.definition, nodeId, source: value, runtime: runtime ?? null })
              continue
            }
          }
          bind(value, surface.lookup_kind as string, surface.field_path as string, surface.resource_kind as string)
        }
        if (mcp.skip_node_types.includes(node.kind)) continue
        const mcpValue = options[mcp.field]
        if (mcpValue === undefined || mcpValue === null) continue
        if (typeof mcpValue !== 'string') {
          add('package_workflow_invalid', member.definition, `${nodeId}: MCP reference must be authored text.`)
          continue
        }
        const mcpPath = bind(mcpValue, mcp.lookup_kind, mcp.field, mcp.lookup_kind)
        if (!mcpPath) continue
        const text = input.artifactTexts.get(mcpPath)
        if (text === undefined) {
          add('package_analysis_required', mcpPath, 'MCP content is required to resolve local resources.')
          continue
        }
        if (new TextEncoder().encode(text).byteLength > (input.maxArtifactBytes ?? 1048576)) {
          add('resource_resolution_limit', mcpPath, 'MCP content exceeds the analysis limit.')
          continue
        }
        let document: unknown
        try {
          const docs = parseAllDocuments(text, { uniqueKeys: true, strict: true })
          if (docs.length !== 1 || docs[0]!.errors.length || docs[0]!.warnings.length) throw new Error('Invalid MCP')
          document = docs[0]!.toJS({ maxAliasCount: 100 })
        } catch {
          add('invalid_mcp', mcpPath, 'MCP content must be one valid YAML document.')
          continue
        }
        const collected = collectMcpCandidates(contract, document)
        if ('code' in collected) {
          add(collected.code, mcpPath, 'MCP resource analysis could not complete.')
          continue
        }
        for (const candidate of new Set(collected.candidates)) {
          if (authoring.normalizer_version >= 5 && candidate === input.hostPython) continue
          const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
          const uriAlias = uri && input.files.has(candidate.replace(/\/{2,}/g, '/'))
          if ((!uri && (packagePathError(candidate) || candidate.startsWith('~'))) || uriAlias) {
            add(
              'resource_resolution_context_required',
              mcpPath,
              'Nonportable MCP candidates require source filesystem context.',
            )
            continue
          }
          const entry = input.files.get(candidate)
          const unsafeParent = candidate
            .split('/')
            .slice(0, -1)
            .some((_, i, parts) => {
              const parent = input.files.get(parts.slice(0, i + 1).join('/'))
              return parent !== undefined && parent.kind !== 'directory'
            })
          if (entry && (entry.kind !== 'file' || unsafeParent)) {
            add('include_resource_invalid', candidate, 'MCP resource is not a contained regular file.')
            continue
          }
          references.push({
            workflowPath: member.definition,
            nodeId,
            fieldPath: mcp.field,
            kind: 'mcp_resource',
            ownership: entry ? 'packaged' : 'external',
            artifactPath: entry ? candidate : null,
            reference: candidate,
            ruleId: 'mcp_local_closure',
          })
        }
      }
    }
  }
  return finish()
}
