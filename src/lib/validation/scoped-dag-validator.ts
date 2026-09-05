import { isMap, isSeq } from 'yaml'
import {
  readScopedDagCapabilities,
  requiresScopedDagCapabilities,
  type ScopedDagCapabilities,
} from '$src/lib/contract/scoped-dag-rule'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ProjectedGraph, ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'
import {
  buildReferenceIndex,
  prepareReferenceContract,
  type IndexedReferenceOccurrence,
  type IndexedReferenceToken,
  type PreparedReferenceContract,
  type ReferenceIndex,
} from '$src/lib/references/reference-index'
import { outputPathImpossible, schemaHasUnaddressableDottedKey } from '$src/lib/references/structured-path'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'
import { validateDag } from './dag-validator'
import { calculateLoopGroupWorkProduct } from './loop-group-work-product'

export interface ScopedDagValidationResult {
  readonly issues: readonly ValidationIssue[]
}

export function validateIndexedConditionNormalization(
  projection: WorkflowProjection,
  definitionDocument: ParsedYamlDocument,
  contract: AuthoringContract,
  prepared: PreparedReferenceContract,
  referenceIndex: ReferenceIndex,
): ScopedDagValidationResult {
  const root = projection.graphs.find(({ scope }) => scope.key === 'root')
  if (!root) return Object.freeze({ issues: [] })
  const documentationId = scopedDocumentationId(contract, prepared.capabilities)
  const context: ValidationContext = {
    projection,
    definitionDocument,
    companionDocument: null,
    contract,
    capabilities: prepared.capabilities,
    root,
    impreciseOutputSchemaOwners: new Set(),
    ...(documentationId ? { documentationId } : {}),
  }
  const issues: ValidationIssue[] = []
  validateConditionPhase(context, referenceIndex, issues)
  return Object.freeze({ issues: Object.freeze(issues) })
}

export function validateScopedDag(
  projection: WorkflowProjection,
  definitionDocument: ParsedYamlDocument,
  companionDocument: ParsedYamlDocument | null,
  contract: AuthoringContract,
  suppliedPrepared?: PreparedReferenceContract | null,
  suppliedReferenceIndex?: ReferenceIndex | null,
  impreciseOutputSchemaOwners: ReadonlySet<string> = new Set(),
  conditionNormalizationComplete = false,
): ScopedDagValidationResult {
  if (!requiresScopedDagCapabilities(contract, projection.profile, 'definition')) return Object.freeze({ issues: [] })
  let capabilities: ScopedDagCapabilities
  let prepared: PreparedReferenceContract | null
  try {
    prepared = suppliedPrepared === undefined ? prepareReferenceContract(contract) : suppliedPrepared
    capabilities = prepared?.capabilities ?? readScopedDagCapabilities(contract)
  } catch {
    return Object.freeze({ issues: [] })
  }

  const issues: ValidationIssue[] = []
  const root = projection.graphs.find(({ scope }) => scope.key === 'root')
  if (!root) return Object.freeze({ issues })
  const documentationId = scopedDocumentationId(contract, capabilities)
  const referenceIndex = prepared
    ? (suppliedReferenceIndex ?? buildReferenceIndex(projection.definition, projection, prepared))
    : null
  const context: ValidationContext = {
    projection,
    definitionDocument,
    companionDocument,
    contract,
    capabilities,
    root,
    impreciseOutputSchemaOwners,
    ...(documentationId ? { documentationId } : {}),
  }
  if (!conditionNormalizationComplete && referenceIndex && validateConditionPhase(context, referenceIndex, issues))
    return Object.freeze({ issues: Object.freeze(issues) })
  if (root.capacity.status === 'yaml-only') {
    issues.push(
      scopedIssue(context, root, {
        code: 'visual_capacity_exceeded',
        message: `This graph has ${root.capacity.nodeCount} nodes and ${root.capacity.edgeCount} edges, beyond Studio's visual capacity.`,
        path: pointerPath(root.sourcePath),
        nodeId: 'root',
        field: String(root.sourcePath.at(-1) ?? 'nodes'),
        blocking: false,
        severity: 'warning',
      }),
    )
  }
  for (const graph of projection.graphs) {
    if (graph.scope.kind !== 'loop-group' || !graph.scope.groupId) continue
    validateBodyGraph(graph, context, issues)
  }
  if (referenceIndex) validateIndexedReferences(context, referenceIndex, issues)
  validateCompanionReferences(context, issues)
  return Object.freeze({ issues: Object.freeze(issues) })
}

interface ValidationContext {
  readonly projection: WorkflowProjection
  readonly definitionDocument: ParsedYamlDocument
  readonly companionDocument: ParsedYamlDocument | null
  readonly contract: AuthoringContract
  readonly capabilities: ScopedDagCapabilities
  readonly root: ProjectedGraph
  readonly impreciseOutputSchemaOwners: ReadonlySet<string>
  readonly documentationId?: string
}

function validateBodyGraph(graph: ProjectedGraph, context: ValidationContext, issues: ValidationIssue[]): void {
  const groupId = graph.scope.groupId
  if (!groupId) return
  const groupNodePath = graph.sourcePath.slice(0, -context.capabilities.bodyPath.length)
  const groupNode = valueAtPath(context.projection.definition, groupNodePath)
  const bodyNodes = valueAtPath(groupNode, context.capabilities.bodyPath)
  const shapePath = invalidShapePath(groupNode, bodyNodes, graph, context.capabilities)
  if (shapePath) {
    issues.push(
      scopedIssue(context, graph, {
        code: context.capabilities.topology.validation_codes.nesting,
        message: `Loop group "${groupId}" must use the contract-declared one-level body shape.`,
        path: shapePath,
        nodeId: nodeIdAtPath(graph, shapePath) ?? groupId,
        field: lastField(shapePath),
      }),
    )
  }

  if (Array.isArray(bodyNodes)) {
    const edgeCount = bodyNodes.reduce((total, node) => {
      const dependencies = valueAtPath(node, [context.capabilities.dependsOnField])
      return total + (Array.isArray(dependencies) ? dependencies.length : 0)
    }, 0)
    if (
      bodyNodes.length > context.capabilities.topology.max_nodes ||
      edgeCount > context.capabilities.topology.max_edges
    ) {
      issues.push(
        scopedIssue(context, graph, {
          code: context.capabilities.topology.validation_codes.capacity,
          message: `Loop group "${groupId}" exceeds the contract-declared body graph bound.`,
          path: pointerPath(graph.sourcePath),
          nodeId: groupId,
          field: String(context.capabilities.bodyPath.at(-1) ?? context.capabilities.groupKind),
        }),
      )
    }
  }

  const dag = validateDag(graph, context.contract.semantic_rules, {
    references: false,
    conditions: context.contract.contract_reader_version !== 3,
  })
  for (const issue of dag.issues) {
    const missingDependency = issue.code === 'missing_dependency'
    const collectionPath = pointerPath(graph.sourcePath)
    const path =
      issue.code === 'dependency_cycle' || issue.code === 'self_dependency'
        ? collectionPath
        : issue.code === 'duplicate_node_id' && issue.path
          ? `${issue.path}/${context.capabilities.nodeIdField}`
          : issue.path
    issues.push(
      scopedIssue(context, graph, {
        code: missingDependency
          ? context.capabilities.topology.validation_codes.visibility
          : context.capabilities.topology.validation_codes.topology,
        message: issue.message,
        path: path ?? pointerPath(graph.sourcePath),
        nodeId: issue.nodeId ?? groupId,
        field:
          issue.code === 'duplicate_node_id'
            ? context.capabilities.nodeIdField
            : (issue.field ?? context.capabilities.dependsOnField),
      }),
    )
  }

  if (groupNode !== undefined) {
    const work = calculateLoopGroupWorkProduct(groupNode, context.capabilities)
    if (work.exceeded) {
      issues.push(
        scopedIssue(context, graph, {
          code: context.capabilities.topology.validation_codes.work_product,
          message: `Loop group "${groupId}" exceeds the contract-declared worst-case work product of ${work.limit}.`,
          path: pointerPath([...groupNodePath, context.capabilities.groupKind]),
          nodeId: groupId,
          field: context.capabilities.groupKind,
        }),
      )
    }
  }

  if (graph.capacity.status === 'yaml-only') {
    issues.push(
      scopedIssue(context, graph, {
        code: 'visual_capacity_exceeded',
        message: `This graph has ${graph.capacity.nodeCount} nodes and ${graph.capacity.edgeCount} edges, beyond Studio's visual capacity.`,
        path: pointerPath(graph.sourcePath),
        nodeId: groupId,
        field: String(context.capabilities.bodyPath.at(-1) ?? context.capabilities.groupKind),
        blocking: false,
        severity: 'warning',
      }),
    )
  }
}

function invalidShapePath(
  groupNode: unknown,
  bodyNodes: unknown,
  graph: ProjectedGraph,
  capabilities: ScopedDagCapabilities,
): string | null {
  if (!isRecord(groupNode)) return pointerPath(graph.sourcePath.slice(0, -capabilities.bodyPath.length))
  for (const field of capabilities.topology.forbidden_group_fields) {
    if (Object.hasOwn(groupNode, field))
      return pointerPath([...graph.sourcePath.slice(0, -capabilities.bodyPath.length), field])
  }
  const payload = valueAtPath(groupNode, [capabilities.groupKind])
  if (!isRecord(payload))
    return pointerPath([...graph.sourcePath.slice(0, -capabilities.bodyPath.length), capabilities.groupKind])
  const unknownField = Object.keys(payload).find((field) => !capabilities.topology.group_fields.includes(field))
  if (unknownField) {
    return pointerPath([
      ...graph.sourcePath.slice(0, -capabilities.bodyPath.length),
      capabilities.groupKind,
      unknownField,
    ])
  }
  const missingField = capabilities.topology.required_group_fields.find((field) => !Object.hasOwn(payload, field))
  if (missingField) {
    return pointerPath([
      ...graph.sourcePath.slice(0, -capabilities.bodyPath.length),
      capabilities.groupKind,
      missingField,
    ])
  }
  if (!Array.isArray(bodyNodes) || bodyNodes.length < capabilities.topology.min_nodes)
    return pointerPath(graph.sourcePath)
  for (const [index, node] of bodyNodes.entries()) {
    const forbidden = capabilities.forbiddenNodeKinds.find((kind) => hasPath(node, [kind]))
    if (forbidden)
      return pointerPath(
        forbidden === capabilities.groupKind ? [...graph.sourcePath, index] : [...graph.sourcePath, index, forbidden],
      )
  }
  return null
}

function validateIndexedReferences(context: ValidationContext, index: ReferenceIndex, issues: ValidationIssue[]): void {
  const rootPhase = index.occurrences.filter(
    (occurrence) =>
      occurrence.scope === 'root' ||
      (occurrence.scope === 'group-control' && occurrence.callerPolicy === 'group-gate-text-references'),
  )
  const rootIssueStart = issues.length
  for (const occurrence of rootPhase) validateRootOccurrence(context, occurrence, issues)
  if (issues.length !== rootIssueStart) return

  for (const graph of context.projection.graphs) {
    if (graph.scope.kind !== 'loop-group' || !graph.scope.groupId) continue
    for (const occurrence of index.occurrences) {
      if (occurrence.scopeKey !== graph.scope.key) continue
      if (occurrence.scope === 'body') validateScopedOccurrence(context, graph, occurrence, issues)
    }
    for (const occurrence of index.occurrences) {
      if (
        occurrence.scopeKey === graph.scope.key &&
        occurrence.scope === 'group-control' &&
        occurrence.callerPolicy === 'group-until-bash-references'
      )
        validateScopedOccurrence(context, graph, occurrence, issues)
    }
  }
}

function validateConditionPhase(context: ValidationContext, index: ReferenceIndex, issues: ValidationIssue[]): boolean {
  const malformed = index.occurrences
    .filter(({ mode, errors }) => (mode === 'condition-v3' || mode === 'body-when') && errors.length > 0)
    .sort((left, right) => comparePaths(left.valuePath, right.valuePath))[0]
  const error = malformed?.errors[0]
  if (!malformed || !error) return false
  const graph =
    malformed.scopeKey === 'root'
      ? context.root
      : (context.projection.graphs.find(({ scope }) => scope.key === malformed.scopeKey) ?? context.root)
  if (malformed.scope === 'body') {
    issues.push(
      indexedIssue(
        context,
        graph,
        malformed,
        'loop_group_shape_invalid',
        'A loop-group body condition is statically malformed.',
      ),
    )
    return true
  }
  const referenceCause = error.cause?.name === 'WorkflowReferenceSyntaxError' ? error.cause.code : undefined
  issues.push(
    indexedIssue(
      context,
      graph,
      malformed,
      referenceCause ?? 'malformed_condition',
      referenceCause ? `Reference syntax is invalid: ${error.cause?.name}.` : 'Condition is statically malformed.',
    ),
  )
  return true
}

function comparePaths(left: readonly (string | number)[], right: readonly (string | number)[]): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index]!
    const rightSegment = right[index]!
    if (leftSegment === rightSegment) continue
    if (typeof leftSegment === 'number' && typeof rightSegment === 'number') return leftSegment - rightSegment
    return String(leftSegment).localeCompare(String(rightSegment))
  }
  return left.length - right.length
}

function validateRootOccurrence(
  context: ValidationContext,
  occurrence: IndexedReferenceOccurrence,
  issues: ValidationIssue[],
): void {
  const groupGate = occurrence.scope === 'group-control'
  const graph = groupGate
    ? (context.projection.graphs.find(
        ({ scope }) => scope.kind === 'loop-group' && scope.groupId === occurrence.groupId,
      ) ?? context.root)
    : context.root
  for (const error of occurrence.errors) {
    issues.push(
      indexedIssue(context, graph, occurrence, error.code, `Reference syntax is invalid: ${error.name}.`, undefined),
    )
  }
  if (occurrence.errors.length) return
  const consumer = context.root.nodes.find(({ source }) => source.path === occurrence.consumerPath)
  for (const reference of occurrence.references) {
    if (reference.kind === 'previous') continue
    const producer =
      reference.resolvedProducer?.namespace === 'root'
        ? context.root.nodes.find(({ source }) => source.path === reference.resolvedProducer?.sourcePath)
        : undefined
    if (!consumer || !producer || !consumer.dependsOn.includes(reference.producerId)) {
      issues.push(
        indexedIssue(
          context,
          graph,
          occurrence,
          groupGate
            ? context.capabilities.referenceSemantics.diagnosticCodes.missingDependency
            : 'output_reference_not_declared_dependency',
          `Output reference "${reference.producerId}" must be listed directly in depends_on.`,
          reference,
        ),
      )
      continue
    }
    validateIndexedStructuredReference(context, graph, occurrence, producer, reference, issues, groupGate)
  }
}

function validateScopedOccurrence(
  context: ValidationContext,
  graph: ProjectedGraph,
  occurrence: IndexedReferenceOccurrence,
  issues: ValidationIssue[],
): void {
  for (const error of occurrence.errors) {
    issues.push(
      indexedIssue(
        context,
        graph,
        occurrence,
        'loop_group_scope_invalid',
        `Reference syntax is invalid: ${error.name}.`,
      ),
    )
  }
  if (occurrence.errors.length) return
  const consumer = graph.nodes.find(({ source }) => source.path === occurrence.consumerPath)
  const previous = occurrence.references.filter(({ kind }) => kind === 'previous')
  const ordinary = occurrence.references.filter(({ kind }) => kind === 'ordinary')
  for (const reference of previous) {
    const producer =
      reference.resolvedProducer?.namespace === 'previous'
        ? graph.nodes.find(({ source }) => source.path === reference.resolvedProducer?.sourcePath)
        : undefined
    if (!producer) {
      issues.push(
        indexedIssue(
          context,
          graph,
          occurrence,
          context.capabilities.referenceSemantics.diagnosticCodes.unknownProducer,
          `Unknown previous-iteration body node "${reference.producerId}".`,
          reference,
        ),
      )
      continue
    }
    validateIndexedStructuredReference(context, graph, occurrence, producer, reference, issues, false)
  }
  for (const reference of ordinary) {
    const identity = reference.resolvedProducer
    const producer =
      identity?.namespace === 'body'
        ? graph.nodes.find(({ source }) => source.path === identity.sourcePath)
        : identity?.namespace === 'root'
          ? context.root.nodes.find(({ source }) => source.path === identity.sourcePath)
          : undefined
    const bodyAllowed =
      identity?.namespace === 'body' &&
      (occurrence.scope === 'group-control' || Boolean(consumer?.dependsOn.includes(reference.producerId)))
    const outerAllowed = identity?.namespace === 'root' && graph.outerInputs.includes(reference.producerId)
    if (!producer || (!bodyAllowed && !outerAllowed)) {
      issues.push(
        indexedIssue(
          context,
          graph,
          occurrence,
          context.capabilities.referenceSemantics.diagnosticCodes.missingDependency,
          `Reference producer "${reference.producerId}" is outside the loop-group dependency scope.`,
          reference,
        ),
      )
      continue
    }
    validateIndexedStructuredReference(context, graph, occurrence, producer, reference, issues, false)
  }
}

function validateIndexedStructuredReference(
  context: ValidationContext,
  graph: ProjectedGraph,
  occurrence: IndexedReferenceOccurrence,
  producer: ProjectedNode,
  reference: IndexedReferenceToken,
  issues: ValidationIssue[],
  groupGate: boolean,
): void {
  if (!reference.path.length) return
  if (context.impreciseOutputSchemaOwners.has(producer.source.path)) return
  const schema = producerOutputSchema(context, producer)
  if (schema === undefined) {
    issues.push(
      indexedIssue(
        context,
        graph,
        occurrence,
        groupGate
          ? context.capabilities.referenceSemantics.diagnosticCodes.producerSchemaRequired
          : occurrence.scope === 'root'
            ? 'output_reference_path_unsupported'
            : context.capabilities.referenceSemantics.diagnosticCodes.producerSchemaRequired,
        `Output field reference requires a structured output contract on "${producer.id}".`,
        reference,
      ),
    )
    return
  }
  if (!outputPathImpossible(schema, reference.path)) return
  const nativeCode = schemaHasUnaddressableDottedKey(schema, reference.path)
    ? 'output_reference_path_unsupported'
    : 'structured_output_field_impossible'
  issues.push(
    indexedIssue(
      context,
      graph,
      occurrence,
      groupGate || occurrence.scope !== 'root'
        ? context.capabilities.referenceSemantics.diagnosticCodes.structuredPathImpossible
        : nativeCode,
      `Structured output path "${reference.path.join('.')}" is impossible for "${producer.id}".`,
      reference,
    ),
  )
}

function indexedIssue(
  context: ValidationContext,
  graph: ProjectedGraph,
  occurrence: IndexedReferenceOccurrence,
  code: string,
  message: string,
  reference?: IndexedReferenceToken,
): ValidationIssue {
  return scopedIssue(
    context,
    graph,
    {
      code,
      message,
      path: pointerPath(occurrence.valuePath),
      nodeId: occurrence.consumerId,
      field: occurrence.field,
      ...(reference ? { referenceStart: reference.start, referenceEnd: reference.end } : {}),
    },
    'definition',
    occurrence.groupId,
  )
}

function validateCompanionReferences(context: ValidationContext, issues: ValidationIssue[]): void {
  if (!context.companionDocument || context.projection.companion === undefined) return
  const descriptor = context.capabilities.referenceSemantics.companionNodePaths
  const matcher = formattedPathMatcher(descriptor.format)
  if (!matcher) return
  for (const declaredPath of descriptor.fieldPaths) {
    const fieldPath = declaredPath.startsWith('sidecar.') ? declaredPath.slice('sidecar.'.length) : declaredPath
    for (const occurrence of expandFieldPath(context.projection.companion, fieldPath)) {
      if (typeof occurrence.value !== 'string') continue
      const match = matcher.exec(occurrence.value)
      if (!match) {
        if (uniqueNodes(context.root.nodes).has(occurrence.value)) continue
        issues.push(companionReferenceIssue(context, occurrence, occurrence.value))
        continue
      }
      const groupId = match.groups?.group
      const childId = match.groups?.child
      if (!groupId || !childId) continue
      const graph = context.projection.graphs.find(
        (candidate) => candidate.scope.kind === 'loop-group' && candidate.scope.groupId === groupId,
      )
      if (graph?.nodes.some(({ id }) => id === childId)) continue
      issues.push(companionReferenceIssue(context, occurrence, occurrence.value, groupId, childId))
    }
  }
}

function companionReferenceIssue(
  context: ValidationContext,
  occurrence: FieldOccurrence,
  reference: string,
  parsedGroupId = reference.split('/')[0],
  parsedChildId = reference.split('/')[1],
): ValidationIssue {
  const graph = context.projection.graphs.find(
    (candidate) => candidate.scope.kind === 'loop-group' && candidate.scope.groupId === parsedGroupId,
  )
  const groupId = graph?.scope.groupId
  return scopedIssue(
    context,
    graph ?? context.root,
    {
      code: context.capabilities.referenceSemantics.diagnosticCodes.unknownCompanionNode,
      message: `Companion reference "${reference}" does not name a known group child.`,
      path: pointerPath(typeof occurrence.path.at(-1) === 'number' ? occurrence.path.slice(0, -1) : occurrence.path),
      nodeId: parsedChildId ?? parsedGroupId ?? reference,
      field: fieldIdentity(occurrence.path),
    },
    'companion',
    groupId,
  )
}

function producerOutputSchema(context: ValidationContext, producer: ProjectedNode): unknown {
  const resolution = context.capabilities.referenceSemantics.producerSchemaResolution
  if (producer.kind === context.capabilities.groupKind) {
    const graph = context.projection.graphs.find(
      (candidate) => candidate.scope.kind === 'loop-group' && candidate.scope.groupId === producer.id,
    )
    const sink = graph?.nodes.find(({ id }) => id === graph.primarySinkId)
    const path = resolution[context.capabilities.groupKind]
    const outputPath = Array.isArray(path) && typeof path.at(-1) === 'string' ? [path.at(-1) as string] : []
    return sink ? valueAtPath(projectedNodeValue(sink), outputPath) : undefined
  }
  const path = resolution.ordinary
  return Array.isArray(path) && path.every((segment) => typeof segment === 'string')
    ? valueAtPath(projectedNodeValue(producer), path as string[])
    : undefined
}

function projectedNodeValue(node: ProjectedNode): Record<string, unknown> {
  return { ...node.options, ...(node.kind ? { [node.kind]: node.value } : {}) }
}

interface ScopedIssueInput {
  readonly code: string
  readonly message: string
  readonly path: string
  readonly nodeId: string
  readonly field: string
  readonly blocking?: boolean
  readonly severity?: ValidationIssue['severity']
  readonly referenceStart?: number
  readonly referenceEnd?: number
}

function scopedIssue(
  context: ValidationContext,
  graph: ProjectedGraph,
  input: ScopedIssueInput,
  document: ValidationIssue['document'] = 'definition',
  groupId = graph.scope.groupId,
): ValidationIssue {
  const parsed = document === 'definition' ? context.definitionDocument : context.companionDocument
  const location = parsed ? sourceLocation(parsed, input.path) : null
  return {
    code: input.code,
    layer: 'semantic',
    severity: input.severity ?? 'error',
    blocking: input.blocking ?? true,
    message: input.message,
    document,
    path: input.path,
    ...(location ?? {}),
    scopeKey: graph.scope.key,
    ...(groupId ? { groupId } : {}),
    nodeId: input.nodeId,
    field: input.field,
    ...(input.referenceStart === undefined ? {} : { referenceStart: input.referenceStart }),
    ...(input.referenceEnd === undefined ? {} : { referenceEnd: input.referenceEnd }),
    ...(context.documentationId ? { documentationId: context.documentationId } : {}),
  }
}

function sourceLocation(parsed: ParsedYamlDocument, path: string): { line: number; column: number } | null {
  let current: unknown = parsed.document.contents
  let located: unknown = current
  for (const segment of pointerTokens(path)) {
    if (isMap(current)) current = current.get(segment, true) ?? null
    else if (isSeq(current) && typeof segment === 'number') current = current.get(segment, true) ?? null
    else break
    if (current !== null) located = current
  }
  const offset = isRecord(located) && Array.isArray(located.range) ? located.range[0] : null
  if (typeof offset !== 'number') return null
  let lineIndex = 0
  for (let index = 0; index < parsed.lineStarts.length; index += 1) {
    if ((parsed.lineStarts[index] ?? Number.MAX_SAFE_INTEGER) > offset) break
    lineIndex = index
  }
  return { line: lineIndex + 1, column: offset - (parsed.lineStarts[lineIndex] ?? 0) + 1 }
}

interface FieldOccurrence {
  readonly value: unknown
  readonly path: readonly (string | number)[]
}

function expandFieldPath(value: unknown, fieldPath: string): readonly FieldOccurrence[] {
  const segments = fieldPath.split('.').filter(Boolean)
  const results: FieldOccurrence[] = []
  const visit = (current: unknown, index: number, path: readonly (string | number)[]): void => {
    if (index === segments.length) {
      results.push({ value: current, path })
      return
    }
    const token = segments[index]
    if (!token) return
    const sequence = token.endsWith('[]')
    const key = sequence ? token.slice(0, -2) : token
    if (key === '*') {
      if (!isRecord(current)) return
      for (const [entryKey, child] of Object.entries(current)) {
        if (sequence) {
          if (!Array.isArray(child)) continue
          child.forEach((item, itemIndex) => visit(item, index + 1, [...path, entryKey, itemIndex]))
        } else {
          visit(child, index + 1, [...path, entryKey])
        }
      }
      return
    }
    if (!isRecord(current) || !Object.hasOwn(current, key)) return
    const child = current[key]
    if (sequence) {
      if (!Array.isArray(child)) return
      child.forEach((item, itemIndex) => visit(item, index + 1, [...path, key, itemIndex]))
    } else {
      visit(child, index + 1, [...path, key])
    }
  }
  visit(value, 0, [])
  return results
}

function uniqueNodes(nodes: readonly ProjectedNode[]): ReadonlyMap<string, ProjectedNode> {
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
  return new Map(nodes.filter(({ id }) => id && counts.get(id) === 1).map((node) => [node.id, node]))
}

function nodeIdAtPath(graph: ProjectedGraph, path: string): string | undefined {
  const tokens = pointerTokens(path)
  if (!startsWithPath(tokens, graph.sourcePath)) return undefined
  const index = tokens[graph.sourcePath.length]
  return typeof index === 'number' ? graph.nodes[index]?.id : undefined
}

function formattedPathMatcher(format: string): RegExp | null {
  if (!format.includes('group') || !format.includes('child')) return null
  const source = escapeRegex(format).replace('group', '(?<group>[^/]+)').replace('child', '(?<child>[^/]+)')
  try {
    return new RegExp(`^${source}$`)
  } catch {
    return null
  }
}

function scopedDocumentationId(contract: AuthoringContract, capabilities: ScopedDagCapabilities): string | undefined {
  const descriptor = contract.node_kinds.find(({ id }) => id === capabilities.groupKind)
  const groupPath = descriptor?.field_path
  if (!groupPath) return undefined
  return contract.documentation.topics.find((topic) =>
    topic.field_paths.some((path) => path === groupPath || path.startsWith(`${groupPath}.`)),
  )?.id
}

function fieldIdentity(path: readonly (string | number)[], nodePath?: string): string {
  const nodeTokens = nodePath ? pointerTokens(nodePath) : []
  const relative = path.slice(nodeTokens.length).filter((segment): segment is string => typeof segment === 'string')
  return relative.join('.') || lastString(path)
}

function lastField(path: string): string {
  return lastString(pointerTokens(path))
}

function lastString(path: readonly (string | number)[]): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const segment = path[index]
    if (typeof segment === 'string') return segment
  }
  return ''
}

function pointerTokens(pointer: string): (string | number)[] {
  if (!pointer || pointer === '/') return []
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((segment) => (/^(?:0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : segment))
}

function pointerPath(path: readonly (string | number)[]): string {
  return `/${path.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function startsWithPath(value: readonly (string | number)[], prefix: readonly (string | number)[]): boolean {
  return prefix.every((segment, index) => value[index] === segment)
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

function hasPath(value: unknown, path: readonly string[]): boolean {
  let current = value
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return false
    current = current[segment]
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
