import type { AuthoringContract, NodeKindDescriptor, SemanticRuleDescriptor } from '$src/lib/contract/types'
import {
  applyWorkflowMutation,
  type ApplyWorkflowMutationResult,
  type YamlTransaction,
  type MutationAnalyzer,
} from '$src/lib/documents/transactions'
import { createDocumentRevision, editDocumentText, isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import type { GraphScopeKey, ProjectedGraph, ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import { patchWorkflowPair } from '$src/lib/yaml/patch-document'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import { readScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import type {
  IndexedReferenceOccurrence,
  ReferenceIndex,
  ReferenceProducerNamespace,
} from '$src/lib/references/reference-index'
import { expandFieldPath } from '$src/lib/validation/scoped-dag-validator'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import type { CanvasPosition } from './types'

export interface CanvasActionContext {
  readonly pair: WorkflowPairText
  readonly revision: DocumentRevision
  readonly projection: WorkflowProjection
  readonly contract: AuthoringContract
  readonly scopeKey: GraphScopeKey
  readonly graph: ProjectedGraph
  readonly currentAnalysis?: DocumentAnalysis | undefined
  readonly referenceIndex?: ReferenceIndex | undefined
  readonly positions: Readonly<Record<string, CanvasPosition>>
  readonly analyzePrepared?: MutationAnalyzer
  readonly applyMutation?: typeof applyWorkflowMutation
  readonly getCurrentSnapshot: () => {
    readonly pair: WorkflowPairText
    readonly revision: DocumentRevision
    readonly scopeKey: GraphScopeKey
  } | null
  readonly commit: (
    pair: WorkflowPairText,
    transaction: YamlTransaction,
    analysis?: import('$src/lib/documents/types').DocumentAnalysis,
  ) => void | Promise<void>
  readonly commitIdentityChanges?: (
    changes: CanvasIdentityChanges,
    transaction: YamlTransaction,
  ) => void | Promise<void>
  readonly commitPositions: (updates: Readonly<Record<string, CanvasPosition | null>>) => void | Promise<void>
  readonly announce: (message: string) => void
}

function rootGraph(projection: WorkflowProjection) {
  return projection.graphs.find((graph) => graph.scope.key === 'root')!
}

type MutationRejectionCode = Exclude<ApplyWorkflowMutationResult, { ok: true }>['code']

export type CanvasRejectionCode =
  | 'self_edge'
  | 'duplicate_edge'
  | 'cycle'
  | 'missing_endpoint'
  | 'dependency_missing'
  | 'node_missing'
  | 'node_id_invalid'
  | 'node_id_duplicate'
  | 'descriptor_unavailable'
  | 'profile_disallowed'
  | 'selection_empty'
  | 'stale_document'
  | 'analysis_unavailable'
  | 'worker_runtime_error'
  | 'worker_message_error'
  | 'worker_timeout'
  | 'analysis_failed'
  | MutationRejectionCode

export interface ClipboardDependency {
  readonly consumer: ScopedNodeIdentity
  readonly producer: ScopedNodeIdentity
}

export interface ClipboardResolutionImpact {
  readonly sourceScopeKey: GraphScopeKey
  readonly destinationScopeKey: GraphScopeKey
  readonly dependencies: readonly ClipboardDependency[]
  readonly references: readonly IndexedReferenceOccurrence[]
}

export type CanvasActionResult =
  | {
      readonly status: 'resolution_required'
      readonly code: 'resolution_required'
      readonly message: string
      readonly clipboardImpact: ClipboardResolutionImpact
    }
  | {
      readonly status: 'committed'
      readonly pair: WorkflowPairText
      readonly transaction: YamlTransaction
      readonly identityChanges: CanvasIdentityChanges
      readonly nodeId?: string
      readonly nodeIds?: readonly string[]
    }
  | { readonly status: 'rejected'; readonly code: CanvasRejectionCode; readonly message: string }
  | {
      readonly status: 'resolution_required'
      readonly code: 'resolution_required'
      readonly message: string
      readonly impact: DeleteImpact
    }

export interface ScopedNodeIdentity {
  readonly document: 'definition'
  readonly scopeKey: GraphScopeKey
  readonly groupId?: string
  readonly nodeId: string
}

export interface CanvasActionLease {
  readonly revision: DocumentRevision
  readonly scopeKey: GraphScopeKey
  readonly savedGeneration: number
  readonly definitionSavedRevision: number
  readonly definitionDiskHash: string | null
  readonly companionSavedRevision: number | null
  readonly companionDiskHash: string | null
}

export interface CanvasIdentityChanges {
  readonly copySource?: { readonly workflowId: string; readonly definitionPath: string }
  readonly nodeRenames: readonly { scopeKey: GraphScopeKey; from: string; to: string }[]
  readonly scopeRenames: readonly { from: GraphScopeKey; to: GraphScopeKey }[]
  readonly nodeCopies: readonly { from: ScopedNodeIdentity; to: ScopedNodeIdentity }[]
  readonly scopeCopies: readonly { from: GraphScopeKey; to: GraphScopeKey }[]
  readonly removedNodes: readonly ScopedNodeIdentity[]
  readonly removedScopes: readonly GraphScopeKey[]
}

export function emptyIdentityChanges(): CanvasIdentityChanges {
  return { nodeRenames: [], scopeRenames: [], nodeCopies: [], scopeCopies: [], removedNodes: [], removedScopes: [] }
}

export function nodeIdentity(scopeKey: GraphScopeKey, nodeId: string): ScopedNodeIdentity {
  return {
    document: 'definition',
    scopeKey,
    ...(scopeKey === 'root' ? {} : { groupId: scopeKey.slice('loop-group:'.length) }),
    nodeId,
  }
}

export interface DependencyImpact {
  readonly document: 'definition'
  readonly consumer: ScopedNodeIdentity
  readonly producer: ScopedNodeIdentity
  readonly key: string
  readonly nodeId: string
  readonly fieldPath: readonly (string | number)[]
  readonly yamlPath: readonly (string | number)[]
  readonly dependencyId: string
}

export interface ReferenceImpact {
  readonly document: 'definition'
  readonly scopeKey: GraphScopeKey
  readonly groupId?: string
  readonly consumer: ScopedNodeIdentity
  readonly producer: ScopedNodeIdentity
  readonly namespace: ReferenceProducerNamespace
  readonly kind: 'ordinary' | 'previous'
  readonly key: string
  readonly nodeId: string
  readonly fieldPath: readonly (string | number)[]
  readonly yamlPath: readonly (string | number)[]
  readonly value: string
  readonly referencedId: string
  readonly occurrence: number
  readonly start: number
  readonly end: number
}

export interface CompanionImpact {
  readonly document: 'companion'
  readonly key: string
  readonly yamlPath: readonly (string | number)[]
  readonly value: string
  readonly target: ScopedNodeIdentity
}

export interface DeleteImpact {
  readonly lease: CanvasActionLease
  readonly targets: readonly ScopedNodeIdentity[]
  readonly companions: readonly CompanionImpact[]
  readonly unavailable?: Extract<CanvasActionResult, { status: 'rejected' }>

  readonly nodeIds: readonly string[]
  readonly dependencies: readonly DependencyImpact[]
  readonly references: readonly ReferenceImpact[]
}

export interface GraphContractFields {
  readonly nodesPath: readonly string[]
  readonly idPath: readonly string[]
  readonly dependenciesPath: readonly string[]
}

export async function connectNodes(
  context: CanvasActionContext,
  sourceId: string,
  targetId: string,
): Promise<CanvasActionResult> {
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  const source = context.graph.nodes.find(({ id }) => id === sourceId)
  const target = context.graph.nodes.find(({ id }) => id === targetId)
  if (!source || !target) return reject(context, 'missing_endpoint', 'Both connection endpoints must exist.')
  if (sourceId === targetId) return reject(context, 'self_edge', 'A node cannot depend on itself.')
  if (target.dependsOn.includes(sourceId)) {
    return reject(context, 'duplicate_edge', `${targetId} already depends on ${sourceId}.`)
  }
  if (hasDependencyPath(context.graph, sourceId, targetId)) {
    return reject(context, 'cycle', `Connecting ${sourceId} to ${targetId} would create a cycle.`)
  }
  return commitMutation(context, {
    type: 'set-dependencies',
    scopeKey: context.scopeKey,
    nodeId: targetId,
    dependsOn: [...target.dependsOn, sourceId],
  })
}

export async function disconnectNodes(
  context: CanvasActionContext,
  sourceId: string,
  targetId: string,
): Promise<CanvasActionResult> {
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  const target = context.graph.nodes.find(({ id }) => id === targetId)
  if (!target || !context.graph.nodes.some(({ id }) => id === sourceId)) {
    return reject(context, 'missing_endpoint', 'Both connection endpoints must exist.')
  }
  if (!target.dependsOn.includes(sourceId)) {
    return reject(context, 'dependency_missing', `${targetId} does not depend on ${sourceId}.`)
  }
  return commitMutation(context, {
    type: 'set-dependencies',
    scopeKey: context.scopeKey,
    nodeId: targetId,
    dependsOn: target.dependsOn.filter((dependency) => dependency !== sourceId),
  })
}

export async function addLoopGroupDependency(
  context: CanvasActionContext,
  groupId: string,
  producerId: string,
): Promise<CanvasActionResult> {
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  const root = rootGraph(context.projection)
  const group = root.nodes.find(({ id, kind }) => id === groupId && kind === 'loop_group')
  const producer = root.nodes.find(({ id }) => id === producerId)
  if (!group || !producer) return reject(context, 'missing_endpoint', 'The group or outer producer no longer exists.')
  if (group.dependsOn.includes(producerId))
    return reject(context, 'duplicate_edge', `${groupId} already depends on ${producerId}.`)
  if (hasDependencyPath(root, producerId, groupId))
    return reject(context, 'cycle', `Adding ${producerId} to ${groupId} would create a cycle.`)
  return commitMutation(context, {
    type: 'set-dependencies',
    scopeKey: 'root',
    nodeId: groupId,
    dependsOn: [...group.dependsOn, producerId],
  })
}

export async function addNode(
  context: CanvasActionContext,
  descriptor: NodeKindDescriptor,
  options: { readonly afterNodeId?: string; readonly viewportCenter: CanvasPosition },
): Promise<CanvasActionResult> {
  if (
    descriptor.status !== 'supported' ||
    !descriptor.applicability.profiles.includes(context.contract.profile) ||
    !descriptor.applicability.documents.includes('definition')
  ) {
    return reject(context, 'descriptor_unavailable', `${descriptor.label} is unavailable in the active profile.`)
  }
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  if (
    context.scopeKey !== 'root' &&
    !readScopedDagCapabilities(context.contract).allowedNodeKinds.includes(descriptor.id)
  )
    return reject(context, 'profile_disallowed', 'This node kind is not allowed in a loop group body.')
  const fields = graphContractFields(context.contract)
  if (!fields) return reject(context, 'descriptor_unavailable', 'The contract does not publish graph fields.')
  const after = options.afterNodeId ? context.graph.nodes.find(({ id }) => id === options.afterNodeId) : undefined
  if (options.afterNodeId && !after) return reject(context, 'node_missing', 'The selected node no longer exists.')

  const nodeId = collisionFreeId(descriptor.id, new Set(context.graph.nodes.map(({ id }) => id)))
  const node: Record<string, unknown> = {}
  setPath(node, fields.idPath, nodeId)
  const kindPath = relativeDescriptorPath(descriptor.field_path, fields.nodesPath)
  if (kindPath.length === 0) {
    return reject(context, 'descriptor_unavailable', 'The node descriptor has no usable kind field path.')
  }
  const initialValue = descriptorInitialValue(context.contract, descriptor)
  if (
    context.scopeKey === 'root' &&
    descriptor.id === 'loop_group' &&
    descriptor.id === readScopedDagCapabilities(context.contract).groupKind
  ) {
    const bodyPath = readScopedDagCapabilities(context.contract).bodyPath
    const groupPath = kindPath
    setPath(node, groupPath, initialValue)
    setPath(node, bodyPath, [])
  } else setPath(node, kindPath, initialValue)
  if (after) setPath(node, fields.dependenciesPath, [after.id])

  const result = await commitMutation(context, {
    type: 'add-node',
    scopeKey: context.scopeKey,
    node,
    ...(after ? { afterNodeId: after.id } : {}),
  })
  if (result.status !== 'committed') return result
  const position = after
    ? {
        x: (context.positions[after.id]?.x ?? options.viewportCenter.x) + 320,
        y: context.positions[after.id]?.y ?? options.viewportCenter.y,
      }
    : { ...options.viewportCenter }
  await context.commitPositions({ [nodeId]: position })
  return { ...result, nodeId }
}

function legacyDeleteImpacts(projection: WorkflowProjection, nodeIds: readonly string[], contract: AuthoringContract) {
  const selected = new Set(nodeIds)
  const fields = graphContractFields(contract)
  const nodes = rawNodes(projection, contract)
  const dependencies: Omit<DependencyImpact, 'document' | 'consumer' | 'producer'>[] = []
  for (const [nodeIndex, rawNode] of nodes.entries()) {
    const nodeId = String(valueAtPath(rawNode, fields?.idPath ?? ['id']))
    if (selected.has(nodeId)) continue
    const rawDependencies = valueAtPath(rawNode, fields?.dependenciesPath ?? ['depends_on'])
    for (const [dependencyIndex, dependencyValue] of (Array.isArray(rawDependencies)
      ? rawDependencies
      : []
    ).entries()) {
      const dependency = String(dependencyValue)
      if (selected.has(dependency)) {
        const fieldPath = dependencyFieldPath(contract)
        const yamlPath = [...(fields?.nodesPath ?? ['nodes']), nodeIndex, ...fieldPath, dependencyIndex]
        dependencies.push({
          key: `dependency:${yamlPointer(yamlPath)}`,
          nodeId,
          fieldPath,
          yamlPath,
          dependencyId: dependency,
        })
      }
    }
  }

  const references: Omit<
    ReferenceImpact,
    'document' | 'scopeKey' | 'groupId' | 'consumer' | 'producer' | 'namespace' | 'kind'
  >[] = []
  for (const [nodeIndex, rawNode] of nodes.entries()) {
    const nodeId = String(valueAtPath(rawNode, fields?.idPath ?? ['id']))
    if (selected.has(nodeId)) continue
    const projectedNode = rootGraph(projection).nodes.find((candidate) => candidate.id === nodeId)
    if (!projectedNode) continue
    for (const rule of referenceRules(contract, projectedNode)) {
      for (const path of rule.field_paths) {
        const relative = nodeRelativePath(path)
        if (!relative) continue
        const value = valueAtPath(rawNode, relative)
        for (const leaf of stringLeaves(value, relative)) {
          let occurrence = 0
          for (const match of findReferenceMatches(leaf.value, rule)) {
            if (selected.has(match.referencedId)) {
              const yamlPath = [...(fields?.nodesPath ?? ['nodes']), nodeIndex, ...leaf.path]
              references.push({
                key: `reference:${yamlPointer(yamlPath)}:${match.start}-${match.end}`,
                nodeId,
                fieldPath: leaf.path,
                yamlPath,
                value: leaf.value,
                referencedId: match.referencedId,
                occurrence,
                start: match.start,
                end: match.end,
              })
            }
            occurrence += 1
          }
        }
      }
    }
  }
  return { nodeIds: [...selected], dependencies, references }
}

export function occurrenceConsumer(occurrence: IndexedReferenceOccurrence): ScopedNodeIdentity {
  return nodeIdentity(occurrence.scope === 'group-control' ? 'root' : occurrence.scopeKey, occurrence.consumerId)
}

export function identitySelected(
  context: CanvasActionContext,
  selected: ReadonlySet<string>,
  identity: ScopedNodeIdentity,
): boolean {
  return (
    (identity.scopeKey === context.scopeKey && selected.has(identity.nodeId)) ||
    (context.scopeKey === 'root' && identity.groupId !== undefined && selected.has(identity.groupId))
  )
}

export function actionLease(context: CanvasActionContext): CanvasActionLease {
  return {
    revision: { ...context.revision },
    scopeKey: context.scopeKey,
    savedGeneration: context.pair.savedGeneration,
    definitionSavedRevision: context.pair.definition.savedRevision,
    definitionDiskHash: context.pair.definition.diskHash,
    companionSavedRevision: context.pair.companion?.savedRevision ?? null,
    companionDiskHash: context.pair.companion?.diskHash ?? null,
  }
}

function leaseIsCurrent(context: CanvasActionContext, lease: CanvasActionLease): boolean {
  const current = context.getCurrentSnapshot()
  return (
    !!current &&
    current.scopeKey === lease.scopeKey &&
    context.scopeKey === lease.scopeKey &&
    isAnalysisCurrent(current.revision, lease.revision) &&
    isAnalysisCurrent(context.revision, lease.revision) &&
    current.pair.workflowId === lease.revision.workflowId &&
    current.pair.generation === lease.revision.pairGeneration &&
    current.pair.definition.path === lease.revision.definitionPath &&
    current.pair.definition.revision === lease.revision.definitionRevision &&
    (current.pair.companion?.path ?? null) === lease.revision.companionPath &&
    (current.pair.companion?.revision ?? null) === lease.revision.companionRevision &&
    current.pair.savedGeneration === lease.savedGeneration &&
    current.pair.definition.savedRevision === lease.definitionSavedRevision &&
    current.pair.definition.diskHash === lease.definitionDiskHash &&
    (current.pair.companion?.savedRevision ?? null) === lease.companionSavedRevision &&
    (current.pair.companion?.diskHash ?? null) === lease.companionDiskHash
  )
}

export function validateActionContext(
  context: CanvasActionContext,
): Extract<CanvasActionResult, { status: 'rejected' }> | null {
  if (!leaseIsCurrent(context, actionLease(context)))
    return reject(context, 'stale_document', 'The workflow or graph scope changed. Review the current YAML and retry.')
  if (
    context.graph.scope.key !== context.scopeKey ||
    context.projection.graphs.find((graph) => graph.scope.key === context.scopeKey) !== context.graph
  )
    return reject(context, 'mutation_stale_scope', 'The selected graph scope is no longer current.')
  if (
    context.contract.contract_reader_version === 3 &&
    (!context.currentAnalysis ||
      !context.referenceIndex ||
      context.currentAnalysis.referenceIndex !== context.referenceIndex ||
      context.currentAnalysis.projection !== context.projection ||
      !isAnalysisCurrent(context.revision, context.currentAnalysis) ||
      context.currentAnalysis.contractDigest !== context.contract.contract_digest)
  )
    return reject(context, 'analysis_unavailable', 'Canvas authoring requires the exact current reference analysis.')
  return null
}

export function previewDeleteNodes(context: CanvasActionContext, nodeIds: readonly string[]): DeleteImpact {
  const selected = new Set(nodeIds)
  const base = {
    lease: actionLease(context),
    targets: [...selected].map((id) => nodeIdentity(context.scopeKey, id)),
    nodeIds: [...selected],
  }
  const unavailable = validateActionContext(context)
  if (unavailable) return { ...base, dependencies: [], references: [], companions: [], unavailable }
  if (context.contract.contract_reader_version !== 3) {
    const legacy = legacyDeleteImpacts(context.projection, nodeIds, context.contract)
    return {
      ...base,
      companions: [],
      dependencies: legacy.dependencies.map((impact) => ({
        ...impact,
        document: 'definition',
        consumer: nodeIdentity(context.scopeKey, impact.nodeId),
        producer: nodeIdentity(context.scopeKey, impact.dependencyId),
      })),
      references: legacy.references.map((impact) => ({
        ...impact,
        document: 'definition',
        scopeKey: context.scopeKey,
        consumer: nodeIdentity(context.scopeKey, impact.nodeId),
        producer: nodeIdentity(context.scopeKey, impact.referencedId),
        namespace: 'root',
        kind: 'ordinary',
      })),
    }
  }
  const dependencies: DependencyImpact[] = []
  const fields = graphContractFields(context.contract)!
  context.graph.nodes.forEach((node, index) => {
    if (selected.has(node.id)) return
    node.dependsOn.forEach((dependencyId, dependencyIndex) => {
      if (!selected.has(dependencyId)) return
      const yamlPath = [...context.graph.sourcePath, index, ...fields.dependenciesPath, dependencyIndex]
      dependencies.push({
        key: JSON.stringify(['definition', context.scopeKey, yamlPath, dependencyId]),
        document: 'definition',
        consumer: nodeIdentity(context.scopeKey, node.id),
        producer: nodeIdentity(context.scopeKey, dependencyId),
        nodeId: node.id,
        dependencyId,
        fieldPath: fields.dependenciesPath,
        yamlPath,
      })
    })
  })
  const references: ReferenceImpact[] = []
  for (const occurrence of context.referenceIndex!.occurrences) {
    const consumer = occurrenceConsumer(occurrence)
    if (identitySelected(context, selected, consumer)) continue
    occurrence.references.forEach((token, index) => {
      const resolved = token.resolvedProducer
      if (!resolved) return
      const producer = nodeIdentity(resolved.scopeKey, resolved.nodeId)
      if (!identitySelected(context, selected, producer)) return
      references.push({
        key: JSON.stringify([
          occurrence.document,
          occurrence.scopeKey,
          occurrence.valuePath,
          producer,
          token.start,
          token.end,
        ]),
        document: 'definition',
        scopeKey: occurrence.scopeKey,
        ...(occurrence.groupId ? { groupId: occurrence.groupId } : {}),
        consumer,
        producer,
        namespace: resolved.namespace,
        kind: token.kind,
        nodeId: occurrence.consumerId,
        fieldPath: occurrence.valuePath.slice(occurrence.consumerPath.split('/').filter(Boolean).length),
        yamlPath: occurrence.valuePath,
        value: occurrence.authoredText,
        referencedId: resolved.nodeId,
        occurrence: index,
        start: token.start,
        end: token.end,
      })
    })
  }
  const companions: CompanionImpact[] = []
  if (context.pair.companion) {
    const parsed = parseWorkflowYaml(context.pair.companion.text, {
      document: 'companion',
      maxBytes: context.contract.limits.max_document_bytes,
    })
    const value: unknown = parsed.parsed?.document.toJS({ maxAliasCount: 1000 })
    for (const field of readScopedDagCapabilities(context.contract).referenceSemantics.companionNodePaths.fieldPaths) {
      for (const occurrence of expandFieldPath(value, field.startsWith('sidecar.') ? field.slice(8) : field)) {
        if (typeof occurrence.value !== 'string') continue
        const [group, child] = occurrence.value.split('/')
        const target = child ? nodeIdentity(`loop-group:${group}`, child) : nodeIdentity('root', group!)
        if (identitySelected(context, selected, target))
          companions.push({
            document: 'companion',
            key: JSON.stringify(['companion', occurrence.path, target]),
            yamlPath: occurrence.path,
            value: occurrence.value,
            target,
          })
      }
    }
  }
  return { ...base, dependencies, references, companions }
}

export async function deleteNodes(context: CanvasActionContext, impact: DeleteImpact): Promise<CanvasActionResult> {
  if (!leaseIsCurrent(context, impact.lease))
    return reject(
      context,
      'stale_document',
      'The workflow changed after the delete preview. Review the current YAML and retry.',
    )
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  const selected = [...new Set(impact.nodeIds)]
  if (selected.length === 0) return reject(context, 'selection_empty', 'Select at least one node to delete.')
  if (selected.some((id) => !context.graph.nodes.some((node) => node.id === id))) {
    return reject(context, 'node_missing', 'A selected node no longer exists.')
  }
  const currentImpact = impact
  if (currentImpact.references.length > 0 || currentImpact.companions.length > 0) {
    const message = 'Resolve the listed output references before deleting the selected nodes.'
    context.announce(message)
    return { status: 'resolution_required', code: 'resolution_required', message, impact: currentImpact }
  }

  const mutation: WorkflowMutation =
    selected.length === 1
      ? { type: 'delete-node', scopeKey: context.scopeKey, nodeId: selected[0]! }
      : { type: 'replace-document', document: 'definition', text: context.pair.definition.text }
  const result =
    selected.length === 1
      ? await commitMutation(context, mutation)
      : await prepareAndCommitMultipleDeletes(context, selected)
  if (result.status === 'committed') {
    await context.commitPositions(Object.fromEntries(selected.map((id) => [id, null])))
    const committed = {
      ...result,
      identityChanges: {
        ...emptyIdentityChanges(),
        removedNodes: currentImpact.targets,
        removedScopes:
          context.scopeKey === 'root'
            ? context.projection.graphs
                .filter((graph) => graph.scope.groupId && selected.includes(graph.scope.groupId))
                .map((graph) => graph.scope.key)
            : [],
      },
    }
    await context.commitIdentityChanges?.(committed.identityChanges, committed.transaction)
    return committed
  }
  return result
}

export async function renameNode(context: CanvasActionContext, from: string, to: string): Promise<CanvasActionResult> {
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  if (!context.graph.nodes.some(({ id }) => id === from)) {
    return reject(context, 'node_missing', `Node ${from} no longer exists.`)
  }
  if (context.graph.nodes.some(({ id }) => id === to)) {
    return reject(context, 'node_id_duplicate', `Node ${to} already exists.`)
  }
  const result = await commitMutation(context, { type: 'rename-node', scopeKey: context.scopeKey, from, to })
  if (result.status === 'committed' && context.positions[from]) {
    await context.commitPositions({ [from]: null, [to]: context.positions[from] })
  }
  if (result.status !== 'committed') return result
  const committed: Extract<CanvasActionResult, { status: 'committed' }> = {
    ...result,
    nodeId: to,
    identityChanges: {
      ...emptyIdentityChanges(),
      nodeRenames: [{ scopeKey: context.scopeKey, from, to }],
      scopeRenames:
        context.scopeKey === 'root' &&
        context.projection.graphs.some((graph) => graph.scope.key === `loop-group:${from}`)
          ? [{ from: `loop-group:${from}`, to: `loop-group:${to}` }]
          : [],
    },
  }
  await context.commitIdentityChanges?.(committed.identityChanges, committed.transaction)
  return committed
}

export async function commitMutation(
  context: CanvasActionContext,
  mutation: WorkflowMutation,
): Promise<CanvasActionResult> {
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  let result: ApplyWorkflowMutationResult
  try {
    result = await (context.applyMutation ?? applyWorkflowMutation)(
      context.pair,
      mutation,
      context.contract,
      undefined,
      context.currentAnalysis,
    )
  } catch (error) {
    const failure = analysisFailure(error)
    context.announce(failure.message)
    return { status: 'rejected', ...failure }
  }
  if (!result.ok) {
    const message = result.message
    context.announce(message)
    return { status: 'rejected', code: result.code, message }
  }
  const current = context.getCurrentSnapshot()
  if (
    !current ||
    current.scopeKey !== context.scopeKey ||
    !isAnalysisCurrent(current.revision, context.revision) ||
    !transactionBaseIsCurrent(current.pair, context.pair, result.transaction) ||
    !persistenceBaseIsCurrent(current.pair, context.pair)
  ) {
    const message = 'The workflow changed before the canvas action could commit. Review the current YAML and retry.'
    context.announce(message)
    return { status: 'rejected', code: 'stale_document', message }
  }
  await context.commit(result.pair, result.transaction, result.analysis)
  return {
    status: 'committed',
    pair: result.pair,
    transaction: result.transaction,
    identityChanges: emptyIdentityChanges(),
  }
}

function persistenceBaseIsCurrent(pair: WorkflowPairText, originalPair: WorkflowPairText): boolean {
  if (
    pair.savedGeneration !== originalPair.savedGeneration ||
    pair.definition.savedRevision !== originalPair.definition.savedRevision ||
    pair.definition.diskHash !== originalPair.definition.diskHash
  )
    return false
  if (pair.companion === null || originalPair.companion === null) {
    return pair.companion === null && originalPair.companion === null
  }
  return (
    pair.companion.savedRevision === originalPair.companion.savedRevision &&
    pair.companion.diskHash === originalPair.companion.diskHash
  )
}

function transactionBaseIsCurrent(
  pair: WorkflowPairText | null,
  originalPair: WorkflowPairText,
  transaction: YamlTransaction,
): boolean {
  if (!pair || pair.workflowId !== transaction.workflowId || pair.generation !== transaction.pairGeneration)
    return false
  if (
    pair.definition.path !== originalPair.definition.path ||
    pair.definition.revision !== transaction.beforeRevisions.definition
  )
    return false
  if (pair.companion === null || originalPair.companion === null) {
    return pair.companion === null && originalPair.companion === null
  }
  return (
    pair.companion.path === originalPair.companion.path &&
    pair.companion.revision === transaction.beforeRevisions.companion
  )
}

function analysisFailure(error: unknown): { readonly code: CanvasRejectionCode; readonly message: string } {
  const knownCodes: readonly CanvasRejectionCode[] = [
    'analysis_unavailable',
    'worker_runtime_error',
    'worker_message_error',
    'worker_timeout',
  ]
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    knownCodes.includes(error.code as CanvasRejectionCode)
      ? (error.code as CanvasRejectionCode)
      : 'analysis_failed'
  const message =
    error instanceof Error ? error.message : 'Document analysis failed before the canvas action committed.'
  return { code, message }
}

export async function commitPreparedDefinition(
  context: CanvasActionContext,
  text: string,
  allowRepairDraft = false,
): Promise<CanvasActionResult> {
  const unavailable = validateActionContext(context)
  if (unavailable) return unavailable
  const pair = context.pair
  const proposedPair = editDocumentText(pair, 'definition', text)
  let analysis: DocumentAnalysis
  try {
    analysis = context.analyzePrepared
      ? await context.analyzePrepared(proposedPair, context.contract)
      : await analyzeWorkflowPair(
          {
            type: 'analyze',
            requestId: 'canvas-prepared-mutation',
            workflowId: pair.workflowId,
            pairGeneration: pair.generation,
            definition: {
              path: pair.definition.path,
              text,
              revision: proposedPair.definition.revision,
            },
            companion: pair.companion
              ? {
                  path: pair.companion.path,
                  text: pair.companion.text,
                  revision: pair.companion.revision,
                }
              : null,
            profile: context.contract.profile,
            contractDigest: context.contract.contract_digest,
            reason: 'explicit-validate',
          },
          context.contract,
        )
  } catch (error) {
    const failure = analysisFailure(error)
    return reject(context, failure.code, failure.message)
  }
  if (!analysis.structurallyValid && !(allowRepairDraft && analysis.visuallyAuthorable)) {
    const message = 'The proposed canvas mutation would make the workflow structurally invalid.'
    context.announce(message)
    return { status: 'rejected', code: 'mutation_invalid_workflow', message }
  }
  if (!isAnalysisCurrent(createDocumentRevision(proposedPair, context.contract.contract_digest), analysis))
    return reject(
      context,
      'analysis_unavailable',
      'The proposed canvas analysis does not match the prepared workflow revision.',
    )
  return commitMutation(
    {
      ...context,
      applyMutation: async (...args) => {
        const result = await (context.applyMutation ?? applyWorkflowMutation)(...args)
        return result.ok
          ? {
              ...result,
              analysis,
              transaction: { ...result.transaction, selection: { document: 'definition', scopeKey: context.scopeKey } },
            }
          : result
      },
    },
    { type: 'replace-document', document: 'definition', text },
  )
}

async function prepareAndCommitMultipleDeletes(
  context: CanvasActionContext,
  selected: readonly string[],
): Promise<CanvasActionResult> {
  let text = context.pair.definition.text
  const selectedSet = new Set(selected)
  const index: ReferenceIndex = context.referenceIndex
    ? {
        ...context.referenceIndex,
        occurrences: context.referenceIndex.occurrences.filter(
          (occurrence) => !identitySelected(context, selectedSet, occurrenceConsumer(occurrence)),
        ),
      }
    : {
        occurrences: [],
        metrics: {
          indexBuilds: 1,
          definitionTraversals: 1,
          graphVisits: 0,
          nodeVisits: 0,
          traversalGroupVisits: 0,
          occurrenceScans: 0,
        },
      }
  for (const nodeId of selected) {
    const patched = patchWorkflowPair(
      { definition: text, companion: context.pair.companion?.text ?? null },
      { type: 'delete-node', scopeKey: context.scopeKey, nodeId },
      context.contract,
      index,
    )
    if (!patched.ok) return reject(context, patched.code, patched.message)
    text = patched.texts.definition
  }
  return commitPreparedDefinition(context, text, true)
}

export function graphContractFields(contract: AuthoringContract): GraphContractFields | null {
  for (const rule of contract.semantic_rules) {
    if (
      rule.status === 'deferred' ||
      !rule.applicability.profiles.includes(contract.profile) ||
      !rule.applicability.documents.includes('definition')
    )
      continue
    const nodesPath = pathTokens(rule.parameters.nodes_path)
    const idPath = pathTokens(rule.parameters.id_field)
    const dependenciesPath = pathTokens(rule.parameters.dependencies_field)
    if (nodesPath && idPath && dependenciesPath) return { nodesPath, idPath, dependenciesPath }
  }
  return null
}

export function rawNodes(
  projection: WorkflowProjection,
  contract: AuthoringContract,
  scopeKey: GraphScopeKey = 'root',
): Record<string, unknown>[] {
  const fields = graphContractFields(contract)
  if (!fields) return []
  const graph = projection.graphs.find((graph) => graph.scope.key === scopeKey)
  const value = graph ? valueAtPath(projection.definition, graph.sourcePath) : undefined
  return Array.isArray(value) ? value.filter(isRecord).map((node) => structuredClone(node)) : []
}

function reject(
  context: CanvasActionContext,
  code: CanvasRejectionCode,
  message: string,
): Extract<CanvasActionResult, { status: 'rejected' }> {
  context.announce(message)
  return { status: 'rejected', code, message }
}

function hasDependencyPath(graph: ProjectedGraph, from: string, to: string): boolean {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  const pending = [from]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(nodes.get(id)?.dependsOn ?? []))
  }
  return false
}

function collisionFreeId(baseValue: string, occupied: ReadonlySet<string>): string {
  const base = baseValue.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'node'
  if (!occupied.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!occupied.has(candidate)) return candidate
  }
}

function descriptorInitialValue(contract: AuthoringContract, descriptor: NodeKindDescriptor): unknown {
  const schema = schemaAtDescriptorPath(contract.definition_schema, descriptor.field_path)
  if (schema && Object.hasOwn(schema, 'default')) return structuredClone(schema.default)
  switch (schema?.type) {
    case 'array':
      return []
    case 'object':
      return {}
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return 0
    default:
      return ''
  }
}

function schemaAtDescriptorPath(root: Record<string, unknown>, descriptorPath: string): Record<string, unknown> | null {
  let schema: unknown = root
  for (const token of descriptorPath.split('.').filter(Boolean)) {
    const sequence = token.endsWith('[]')
    const key = sequence ? token.slice(0, -2) : token
    schema = isRecord(schema) && isRecord(schema.properties) ? schema.properties[key] : undefined
    if (sequence) schema = isRecord(schema) ? schema.items : undefined
  }
  return isRecord(schema) ? schema : null
}

function relativeDescriptorPath(path: string, nodesPath: readonly string[]): string[] {
  const tokens = path.replaceAll('[]', '').split('.').filter(Boolean)
  return nodesPath.every((segment, index) => tokens[index] === segment) ? tokens.slice(nodesPath.length) : tokens
}

function dependencyFieldPath(contract: AuthoringContract): readonly string[] {
  return graphContractFields(contract)?.dependenciesPath ?? ['depends_on']
}

function referenceRules(contract: AuthoringContract, node: ProjectedNode): SemanticRuleDescriptor[] {
  return contract.semantic_rules.filter(
    (rule) =>
      rule.status !== 'deferred' &&
      rule.applicability.profiles.includes(contract.profile) &&
      rule.applicability.documents.includes('definition') &&
      (!rule.applicability.node_kinds || rule.applicability.node_kinds.includes(node.kind)) &&
      isReferenceRule(rule),
  )
}

function isReferenceRule(rule: SemanticRuleDescriptor): boolean {
  return typeof rule.parameters.pattern === 'string' || rule.parameters.syntax === '$ID.output(.path)*'
}

function findReferenceMatches(
  value: string,
  rule: SemanticRuleDescriptor,
): { readonly referencedId: string; readonly start: number; readonly end: number }[] {
  const pattern = rule.parameters.pattern
  const capture = typeof rule.parameters.node_id_capture_group === 'number' ? rule.parameters.node_id_capture_group : 1
  let expression: RegExp
  try {
    const flags = referenceFlags(rule.parameters.pattern_flags, 'g')
    if (flags === null) return []
    expression =
      typeof pattern === 'string'
        ? new RegExp(pattern, flags)
        : /\$([A-Za-z_][A-Za-z0-9_-]*)\.output(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/g
  } catch {
    return []
  }
  return [...value.matchAll(expression)].flatMap((match) => {
    const referencedId = match[capture]
    const start = match.index
    return referencedId && start !== undefined ? [{ referencedId, start, end: start + match[0].length }] : []
  })
}

function referenceFlags(value: unknown, required: string): string | null {
  if (value !== undefined && typeof value !== 'string') return null
  const declared = value ?? ''
  if ([...declared].some((flag) => !'imsu'.includes(flag))) return null
  const combined = new Set(`${required}${declared}`)
  return [...'dgimsu'].filter((flag) => combined.has(flag)).join('')
}

function stringLeaves(
  value: unknown,
  path: readonly (string | number)[],
): { readonly path: readonly (string | number)[]; readonly value: string }[] {
  if (typeof value === 'string') return [{ path, value }]
  if (Array.isArray(value)) return value.flatMap((child, index) => stringLeaves(child, [...path, index]))
  if (isRecord(value)) return Object.entries(value).flatMap(([key, child]) => stringLeaves(child, [...path, key]))
  return []
}

function yamlPointer(path: readonly (string | number)[]): string {
  return `/${path.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function nodeRelativePath(fieldPath: string): string[] | null {
  const normalized = fieldPath.replaceAll('[*]', '[]')
  const marker = normalized.indexOf('[]')
  if (marker < 0) return null
  return normalized
    .slice(marker + 2)
    .replace(/^\./, '')
    .split('.')
    .filter(Boolean)
}

function pathTokens(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.replaceAll('[]', '').replace(/^\//, '').split(/[./]/).filter(Boolean)
}

export function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
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

export function setPath(target: Record<string, unknown>, path: readonly (string | number)[], value: unknown): void {
  let current: Record<string | number, unknown> = target
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment]
    current =
      existing !== null && typeof existing === 'object'
        ? (existing as Record<string | number, unknown>)
        : ((current[segment] = {}) as Record<string, unknown>)
  }
  const key = path.at(-1)
  if (key !== undefined) current[key] = value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
