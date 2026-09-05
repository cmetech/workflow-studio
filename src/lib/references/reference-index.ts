import { readScopedDagCapabilities, type ScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { GraphScopeKey, ProjectedGraph, ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'
import { SCANNER_UNICODE_PROFILE } from './unicode'
import {
  scanReferences,
  type ReferenceScanError,
  type ReferenceScanMode,
  type ScannedReference,
} from './scan-references'

export type ReferenceSurfaceScope = 'root' | 'body' | 'group-control'
export type ReferenceProducerNamespace = 'root' | 'body' | 'previous'

export interface IndexedProducerIdentity {
  readonly namespace: ReferenceProducerNamespace
  readonly scopeKey: GraphScopeKey
  readonly nodeId: string
  readonly sourcePath: string
}

export interface IndexedReferenceToken extends ScannedReference {
  readonly resolvedProducer?: IndexedProducerIdentity
}

export interface IndexedReferenceOccurrence {
  readonly document: 'definition'
  readonly scope: ReferenceSurfaceScope
  readonly scopeKey: GraphScopeKey
  readonly groupId?: string
  readonly consumerId: string
  readonly consumerPath: string
  readonly valuePath: readonly (string | number)[]
  readonly field: string
  readonly surfacePath: string
  readonly callerPolicy: string
  readonly mode: ReferenceScanMode
  readonly previousOutputs: boolean
  readonly authoredText: string
  readonly references: readonly IndexedReferenceToken[]
  readonly errors: readonly ReferenceScanError[]
}

export interface ReferenceIndexMetrics {
  readonly indexBuilds: 1
  readonly definitionTraversals: 1
  readonly graphVisits: number
  readonly nodeVisits: number
  readonly traversalGroupVisits: number
  readonly occurrenceScans: number
}

export interface ReferenceIndex {
  readonly occurrences: readonly IndexedReferenceOccurrence[]
  readonly metrics: ReferenceIndexMetrics
}

interface SurfacePolicy {
  readonly fieldPath: string
  readonly relativePath: string
  readonly scope: ReferenceSurfaceScope
  readonly nodeTypes: readonly string[]
  readonly authoredValue: string
  readonly callerPolicy: string
  readonly mode: ReferenceScanMode
  readonly previousOutputs: boolean
  readonly discriminatorId?: string
}

interface TraversalGroup {
  readonly relativePath: string
  readonly orderedLeafPaths: readonly string[]
  readonly scopes: readonly {
    readonly scope: ReferenceSurfaceScope
    readonly nodeTypes: readonly string[]
  }[]
  readonly discriminatorId?: string
}

export interface PreparedReferenceContract {
  readonly contract: AuthoringContract
  readonly capabilities: ScopedDagCapabilities
  readonly normalizerVersion: number
  readonly unicodeProfile: typeof SCANNER_UNICODE_PROFILE
  readonly traversalGroups: readonly TraversalGroup[]
  readonly policies: ReadonlyMap<string, SurfacePolicy>
  readonly discriminators: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

const preparedContracts = new WeakMap<AuthoringContract, PreparedReferenceContract | null>()
let preparedBuildCount = 0
let referenceIndexBuildCount = 0

export function preparedReferenceContractBuildCountForTest(): number {
  return preparedBuildCount
}

export function referenceIndexBuildCountForTest(): number {
  return referenceIndexBuildCount
}

export function prepareReferenceContract(contract: AuthoringContract): PreparedReferenceContract | null {
  if (preparedContracts.has(contract)) return preparedContracts.get(contract) ?? null
  preparedBuildCount += 1
  if (contract.contract_reader_version !== 3) {
    preparedContracts.set(contract, null)
    return null
  }
  const capabilities = readScopedDagCapabilities(contract)
  const scanner = record(contract.extensions.reference_scanner_v1)
  const interpolation = record(scanner?.interpolation_surface)
  const groups = interpolation?.groups
  const fields = interpolation?.fields
  const discriminators = record(interpolation?.value_discriminators_v1)
  if (
    !Array.isArray(groups) ||
    !Array.isArray(fields) ||
    !discriminators ||
    !Object.values(discriminators).every((value) => record(value) !== null)
  ) {
    throw new Error('The reference scanner interpolation surface is unsupported by this Studio reader.')
  }
  const traversalGroups = groups.map(readTraversalGroup)
  const policies = new Map<string, SurfacePolicy>()
  for (const value of fields) {
    const policy = readSurfacePolicy(value)
    const key = policyKey(policy.scope, policy.relativePath)
    if (policies.has(key)) throw new Error(`Duplicate reference scanner surface policy: ${key}`)
    policies.set(key, policy)
  }
  const prepared: PreparedReferenceContract = Object.freeze({
    contract,
    capabilities,
    normalizerVersion: contract.normalizer_version,
    unicodeProfile: SCANNER_UNICODE_PROFILE,
    traversalGroups,
    policies,
    discriminators: discriminators as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  })
  preparedContracts.set(contract, prepared)
  return prepared
}

export function buildReferenceIndex(
  definition: unknown,
  projection: WorkflowProjection,
  prepared: PreparedReferenceContract,
): ReferenceIndex {
  referenceIndexBuildCount += 1
  const occurrences: IndexedReferenceOccurrence[] = []
  const root = projection.graphs.find(({ scope }) => scope.key === 'root')
  if (!root) return freezeIndex(occurrences, 0, 0, 0)
  const rootById = uniqueNodes(root.nodes)
  const bodyByGroup = new Map<string, { graph: ProjectedGraph; nodes: ReadonlyMap<string, ProjectedNode> }>()
  for (const graph of projection.graphs) {
    if (graph.scope.kind === 'loop-group' && graph.scope.groupId) {
      bodyByGroup.set(graph.scope.groupId, { graph, nodes: uniqueNodes(graph.nodes) })
    }
  }
  let graphVisits = 0
  let nodeVisits = 0
  let traversalGroupVisits = 0

  const visitGraph = (graph: ProjectedGraph, scope: 'root' | 'body'): void => {
    graphVisits += 1
    const rawNodes = valueAtPath(definition, graph.sourcePath)
    if (!Array.isArray(rawNodes)) return
    for (const [index, rawNode] of rawNodes.entries()) {
      if (!isRecord(rawNode)) continue
      nodeVisits += 1
      const node = graph.nodes[index]
      if (!node) continue
      for (const group of prepared.traversalGroups) {
        const applicability = group.scopes.find(
          (candidate) => candidate.scope === scope && candidate.nodeTypes.includes(node.kind),
        )
        if (!applicability) continue
        traversalGroupVisits += 1
        collectGroupOccurrences({
          rawNode,
          graph,
          node,
          nodeIndex: index,
          scope,
          group,
          prepared,
          rootById,
          bodyByGroup,
          occurrences,
        })
      }
      if (scope === 'root' && node.kind === prepared.capabilities.groupKind) {
        for (const group of prepared.traversalGroups) {
          const applicability = group.scopes.find(
            (candidate) => candidate.scope === 'group-control' && candidate.nodeTypes.includes(node.kind),
          )
          if (!applicability) continue
          traversalGroupVisits += 1
          collectGroupOccurrences({
            rawNode,
            graph,
            node,
            nodeIndex: index,
            scope: 'group-control',
            group,
            prepared,
            rootById,
            bodyByGroup,
            occurrences,
          })
        }
      }
    }
  }

  visitGraph(root, 'root')
  for (const graph of projection.graphs) if (graph.scope.kind === 'loop-group') visitGraph(graph, 'body')
  return freezeIndex(occurrences, graphVisits, nodeVisits, traversalGroupVisits)
}

interface CollectGroupInput {
  readonly rawNode: Readonly<Record<string, unknown>>
  readonly graph: ProjectedGraph
  readonly node: ProjectedNode
  readonly nodeIndex: number
  readonly scope: ReferenceSurfaceScope
  readonly group: TraversalGroup
  readonly prepared: PreparedReferenceContract
  readonly rootById: ReadonlyMap<string, ProjectedNode>
  readonly bodyByGroup: ReadonlyMap<string, { graph: ProjectedGraph; nodes: ReadonlyMap<string, ProjectedNode> }>
  readonly occurrences: IndexedReferenceOccurrence[]
}

function collectGroupOccurrences(input: CollectGroupInput): void {
  const bases = expandPath(input.rawNode, parseRelativePath(input.group.relativePath))
  for (const base of bases) {
    const leaves = input.group.orderedLeafPaths.length ? input.group.orderedLeafPaths : ['']
    for (const leaf of leaves) {
      const leafPath = leaf ? leaf.split('.') : []
      const value = leafPath.length ? valueAtPath(base.value, leafPath) : base.value
      if (typeof value !== 'string') continue
      const relativePath = [input.group.relativePath, leaf].filter(Boolean).join('.')
      const policy = input.prepared.policies.get(policyKey(input.scope, relativePath))
      if (
        !policy ||
        !policy.nodeTypes.includes(input.node.kind) ||
        !admittedAuthoredValue(value, policy, input.prepared)
      )
        continue
      const valuePath = [...input.graph.sourcePath, input.nodeIndex, ...base.path, ...leafPath]
      const scan = scanReferences(value, policy.mode, {
        normalizerVersion: input.prepared.normalizerVersion,
        unicodeProfile: input.prepared.unicodeProfile,
        includePrevious: policy.previousOutputs,
        includeScalars: false,
      })
      const groupId =
        input.scope === 'body'
          ? input.graph.scope.groupId
          : input.node.kind === 'loop_group'
            ? input.node.id
            : undefined
      const targetGraph =
        input.scope === 'group-control' && groupId
          ? (input.bodyByGroup.get(groupId)?.graph ?? input.graph)
          : input.graph
      const references = scan.references.map((reference): IndexedReferenceToken => {
        const resolvedProducer = resolveProducer(
          reference,
          input.scope,
          policy.callerPolicy,
          targetGraph,
          input.rootById,
          input.bodyByGroup,
        )
        return resolvedProducer ? { ...reference, resolvedProducer } : { ...reference }
      })
      const nodeValuePath = [...input.graph.sourcePath, input.nodeIndex]
      const exactField = valuePath
        .slice(nodeValuePath.length)
        .filter((segment): segment is string => typeof segment === 'string')
        .join('.')
      input.occurrences.push({
        document: 'definition',
        scope: input.scope,
        scopeKey: targetGraph.scope.key,
        ...(groupId ? { groupId } : {}),
        consumerId: input.node.id,
        consumerPath: input.node.source.path,
        valuePath,
        field: exactField || relativePath,
        surfacePath: policy.fieldPath,
        callerPolicy: policy.callerPolicy,
        mode: policy.mode,
        previousOutputs: policy.previousOutputs,
        authoredText: value,
        references,
        errors: scan.errors,
      })
    }
  }
}

function resolveProducer(
  reference: ScannedReference,
  scope: ReferenceSurfaceScope,
  callerPolicy: string,
  graph: ProjectedGraph,
  rootById: ReadonlyMap<string, ProjectedNode>,
  bodyByGroup: ReadonlyMap<string, { graph: ProjectedGraph; nodes: ReadonlyMap<string, ProjectedNode> }>,
): IndexedProducerIdentity | undefined {
  const body = graph.scope.groupId ? bodyByGroup.get(graph.scope.groupId) : undefined
  if (reference.kind === 'previous') {
    const producer = body?.nodes.get(reference.producerId)
    return producer && body ? producerIdentity('previous', body.graph, producer) : undefined
  }
  if (scope === 'body' || (scope === 'group-control' && callerPolicy === 'group-until-bash-references')) {
    const bodyProducer = body?.nodes.get(reference.producerId)
    if (bodyProducer) {
      return body ? producerIdentity('body', body.graph, bodyProducer) : undefined
    }
  }
  const rootProducer = rootById.get(reference.producerId)
  return rootProducer ? producerIdentity('root', graph, rootProducer) : undefined
}

function producerIdentity(
  namespace: ReferenceProducerNamespace,
  graph: ProjectedGraph,
  node: ProjectedNode,
): IndexedProducerIdentity {
  return {
    namespace,
    scopeKey: namespace === 'root' ? 'root' : graph.scope.key,
    nodeId: node.id,
    sourcePath: node.source.path,
  }
}

function admittedAuthoredValue(value: string, policy: SurfacePolicy, prepared: PreparedReferenceContract): boolean {
  if (policy.authoredValue === 'reference-template') return true
  if (policy.authoredValue === 'literal-resource-name') return false
  if (policy.authoredValue !== 'reference-template-if-inline-otherwise-literal-resource-name') return false
  const discriminator = policy.discriminatorId ? prepared.discriminators[policy.discriminatorId] : undefined
  if (!discriminator || discriminator.operation !== 'contains-listed-codepoint') return false
  const characters =
    typeof discriminator.characters === 'string' ? new Set(discriminator.characters) : new Set<string>()
  const ranges = Array.isArray(discriminator.codepoint_ranges) ? discriminator.codepoint_ranges : []
  return Array.from(value).some((character) => {
    if (characters.has(character)) return true
    const point = character.codePointAt(0)
    return (
      point !== undefined &&
      ranges.some(
        (range) =>
          Array.isArray(range) &&
          typeof range[0] === 'number' &&
          typeof range[1] === 'number' &&
          point >= range[0] &&
          point <= range[1],
      )
    )
  })
}

function readTraversalGroup(value: unknown): TraversalGroup {
  const group = record(value)
  const relativePath = group?.relative_path
  const leaves = group?.ordered_leaf_paths
  const scopes = group?.scopes
  if (
    typeof relativePath !== 'string' ||
    !stringArray(leaves) ||
    !Array.isArray(scopes) ||
    !scopes.every((scope) => {
      const entry = record(scope)
      return isSurfaceScope(entry?.scope) && stringArray(entry?.node_types)
    })
  )
    throw new Error('The reference scanner traversal group is unsupported by this Studio reader.')
  return {
    relativePath,
    orderedLeafPaths: leaves,
    scopes: scopes.map((scope) => {
      const entry = record(scope)!
      return { scope: entry.scope as ReferenceSurfaceScope, nodeTypes: entry.node_types as string[] }
    }),
    ...(typeof group?.value_discriminator === 'string' ? { discriminatorId: group.value_discriminator } : {}),
  }
}

function readSurfacePolicy(value: unknown): SurfacePolicy {
  const field = record(value)
  if (
    typeof field?.field_path !== 'string' ||
    typeof field.relative_path !== 'string' ||
    !isSurfaceScope(field.scope) ||
    !stringArray(field.node_types) ||
    typeof field.authored_value !== 'string' ||
    typeof field.caller_policy !== 'string' ||
    !isReferenceMode(field.scanner_mode) ||
    typeof field.previous_outputs !== 'boolean'
  )
    throw new Error('The reference scanner surface policy is unsupported by this Studio reader.')
  return {
    fieldPath: field.field_path,
    relativePath: field.relative_path,
    scope: field.scope,
    nodeTypes: field.node_types,
    authoredValue: field.authored_value,
    callerPolicy: field.caller_policy,
    mode: field.scanner_mode,
    previousOutputs: field.previous_outputs,
    ...(typeof field.value_discriminator === 'string' ? { discriminatorId: field.value_discriminator } : {}),
  }
}

function parseRelativePath(path: string): readonly string[] {
  return path.split('.').filter(Boolean)
}

interface ExpandedValue {
  readonly value: unknown
  readonly path: readonly (string | number)[]
}

function expandPath(value: unknown, segments: readonly string[]): readonly ExpandedValue[] {
  let current: readonly ExpandedValue[] = [{ value, path: [] }]
  for (const segment of segments) {
    const sequence = segment.endsWith('[]')
    const key = sequence ? segment.slice(0, -2) : segment
    const next: ExpandedValue[] = []
    for (const candidate of current) {
      if (key === '*') {
        if (!isRecord(candidate.value)) continue
        for (const [entryKey, child] of Object.entries(candidate.value)) {
          if (sequence) {
            if (!Array.isArray(child)) continue
            child.forEach((item, index) => next.push({ value: item, path: [...candidate.path, entryKey, index] }))
          } else next.push({ value: child, path: [...candidate.path, entryKey] })
        }
      } else {
        if (!isRecord(candidate.value) || !Object.hasOwn(candidate.value, key)) continue
        const child = candidate.value[key]
        if (sequence) {
          if (!Array.isArray(child)) continue
          child.forEach((item, index) => next.push({ value: item, path: [...candidate.path, key, index] }))
        } else next.push({ value: child, path: [...candidate.path, key] })
      }
    }
    current = next
  }
  return current
}

function uniqueNodes(nodes: readonly ProjectedNode[]): ReadonlyMap<string, ProjectedNode> {
  const counts = new Map<string, number>()
  for (const node of nodes) if (node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
  return new Map(nodes.filter(({ id }) => id && counts.get(id) === 1).map((node) => [node.id, node]))
}

function freezeIndex(
  occurrences: readonly IndexedReferenceOccurrence[],
  graphVisits: number,
  nodeVisits: number,
  traversalGroupVisits: number,
): ReferenceIndex {
  return deepFreeze({
    occurrences,
    metrics: {
      indexBuilds: 1,
      definitionTraversals: 1,
      graphVisits,
      nodeVisits,
      traversalGroupVisits,
      occurrenceScans: occurrences.length,
    },
  })
}

function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (!isRecord(current)) return undefined
      current = current[segment]
    }
  }
  return current
}

function policyKey(scope: ReferenceSurfaceScope, relativePath: string): string {
  return `${scope}\u0000${relativePath}`
}

function isSurfaceScope(value: unknown): value is ReferenceSurfaceScope {
  return value === 'root' || value === 'body' || value === 'group-control'
}

function isReferenceMode(value: unknown): value is ReferenceScanMode {
  return value === 'text' || value === 'bash' || value === 'condition-v3' || value === 'body-when'
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return record(value) !== null
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
