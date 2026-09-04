import { isMap, isSeq } from 'yaml'
import {
  readScopedDagCapabilities,
  requiresScopedDagCapabilities,
  type ScopedDagCapabilities,
} from '$src/lib/contract/scoped-dag-rule'
import type { AuthoringContract, SemanticRuleDescriptor } from '$src/lib/contract/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ProjectedGraph, ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'
import { validateDag } from './dag-validator'
import { calculateLoopGroupWorkProduct } from './loop-group-work-product'

export interface ScopedDagValidationResult {
  readonly issues: readonly ValidationIssue[]
}

export function validateScopedDag(
  projection: WorkflowProjection,
  definitionDocument: ParsedYamlDocument,
  companionDocument: ParsedYamlDocument | null,
  contract: AuthoringContract,
): ScopedDagValidationResult {
  if (!requiresScopedDagCapabilities(contract, projection.profile, 'definition')) return Object.freeze({ issues: [] })
  let capabilities: ScopedDagCapabilities
  try {
    capabilities = readScopedDagCapabilities(contract)
  } catch {
    return Object.freeze({ issues: [] })
  }

  const issues: ValidationIssue[] = []
  const root = projection.graphs.find(({ scope }) => scope.key === 'root')
  if (!root) return Object.freeze({ issues })
  const documentationId = scopedDocumentationId(contract, capabilities)
  const context: ValidationContext = {
    projection,
    definitionDocument,
    companionDocument,
    contract,
    capabilities,
    root,
    ...(documentationId ? { documentationId } : {}),
  }
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
  validatePromotedRootReferences(context, issues)
  validateCompanionReferences(context, issues)
  return Object.freeze({ issues: Object.freeze(deduplicate(issues)) })
}

interface ValidationContext {
  readonly projection: WorkflowProjection
  readonly definitionDocument: ParsedYamlDocument
  readonly companionDocument: ParsedYamlDocument | null
  readonly contract: AuthoringContract
  readonly capabilities: ScopedDagCapabilities
  readonly root: ProjectedGraph
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

  const dag = validateDag(graph, context.contract.semantic_rules, { references: false })
  for (const issue of dag.issues) {
    const missingDependency = issue.code === 'missing_dependency'
    issues.push(
      scopedIssue(context, graph, {
        code: missingDependency
          ? context.capabilities.topology.validation_codes.visibility
          : context.capabilities.topology.validation_codes.topology,
        message: issue.message,
        path: issue.path ?? pointerPath(graph.sourcePath),
        nodeId: issue.nodeId ?? groupId,
        field: issue.field ?? context.capabilities.dependsOnField,
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

  validateBodyReferences(graph, groupNodePath, context, issues)
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
    if (forbidden) return pointerPath([...graph.sourcePath, index, forbidden])
  }
  return null
}

function validateBodyReferences(
  graph: ProjectedGraph,
  groupNodePath: readonly (string | number)[],
  context: ValidationContext,
  issues: ValidationIssue[],
): void {
  const grammar = referenceGrammar(context.contract, context.capabilities)
  if (!grammar) return
  const definition = context.projection.definition
  const bodyById = new Map(graph.nodes.filter(({ id }) => id).map((node) => [node.id, node]))
  const rootById = uniqueNodes(context.root.nodes)
  const fields = context.capabilities.referenceSemantics.interpolationFields
  for (const surface of fields) {
    const fieldPath = surface.field_path
    if (typeof fieldPath !== 'string' || !surfaceAllowsReferences(surface, context.capabilities)) continue
    const currentApplies =
      appliesTo(fieldPath, context.capabilities.references, 'current_scope') ||
      groupUntilAllowsCurrentBody(fieldPath, context.capabilities)
    const outerApplies = appliesTo(fieldPath, context.capabilities.references, 'outer_scope')
    const previousApplies = appliesTo(fieldPath, context.capabilities.references, 'previous_iteration')
    for (const occurrence of expandFieldPath(definition, fieldPath)) {
      if (!startsWithPath(occurrence.path, groupNodePath)) continue
      const consumer = bodyConsumer(graph, occurrence.path)
      const nodeId = consumer?.id ?? graph.scope.groupId ?? ''
      const field = fieldIdentity(occurrence.path, consumer?.source.path)
      if (previousApplies) {
        for (const reference of collectReferences(occurrence.value, grammar.previous)) {
          const producer = bodyById.get(reference.producer)
          if (!producer) {
            issues.push(
              referenceIssue(context, graph, occurrence.path, nodeId, field, 'unknownProducer', reference.producer),
            )
          } else {
            validateStructuredReference(context, graph, occurrence.path, nodeId, field, producer, reference, issues)
          }
        }
      }
      for (const reference of collectReferences(
        withoutPreviousReferences(occurrence.value, grammar.previous),
        grammar.current,
      )) {
        let producer: ProjectedNode | undefined
        let producerKind: 'body' | 'outer' | undefined
        for (const scope of resolutionOrder(context.capabilities)) {
          if (scope === 'body-sibling' && currentApplies && bodyById.has(reference.producer)) {
            producer = bodyById.get(reference.producer)
            producerKind = 'body'
            break
          }
          if (scope === 'outer-node' && outerApplies && rootById.has(reference.producer)) {
            producer = rootById.get(reference.producer)
            producerKind = 'outer'
            break
          }
        }
        if (!producer || !producerKind) {
          issues.push(
            referenceIssue(context, graph, occurrence.path, nodeId, field, 'unknownProducer', reference.producer),
          )
          continue
        }
        const bodyDependencyRequired =
          producerKind === 'body' && consumer !== undefined && currentScopeRequiresDependency(context.capabilities)
        const groupDependencyRequired = producerKind === 'outer' && outerScopeRequiresDependency(context.capabilities)
        if (
          (bodyDependencyRequired && !consumer.dependsOn.includes(producer.id)) ||
          (groupDependencyRequired && !graph.outerInputs.includes(producer.id))
        ) {
          issues.push(
            referenceIssue(context, graph, occurrence.path, nodeId, field, 'missingDependency', reference.producer),
          )
          continue
        }
        validateStructuredReference(context, graph, occurrence.path, nodeId, field, producer, reference, issues)
      }
    }
  }
}

function withoutPreviousReferences(value: unknown, parser: { readonly expression: RegExp }): unknown {
  if (typeof value !== 'string') return value
  parser.expression.lastIndex = 0
  return value.replace(parser.expression, '')
}

function validatePromotedRootReferences(context: ValidationContext, issues: ValidationIssue[]): void {
  const grammar = referenceGrammar(context.contract, context.capabilities)
  if (!grammar) return
  const groups = new Map(
    context.root.nodes
      .filter(({ kind, id }) => kind === context.capabilities.groupKind && id)
      .map((node) => [node.id, node]),
  )
  if (groups.size === 0) return
  const rule = context.contract.semantic_rules.find(
    ({ id }) => id === context.capabilities.referenceSemantics.syntaxRule,
  )
  if (!rule) return
  for (const fieldPath of rule.field_paths) {
    for (const occurrence of expandFieldPath(context.projection.definition, fieldPath)) {
      const consumer = rootConsumer(context.root, occurrence.path)
      if (!consumer) continue
      const field = fieldIdentity(occurrence.path, consumer.source.path)
      for (const reference of collectReferences(occurrence.value, grammar.current)) {
        const producer = groups.get(reference.producer)
        if (!producer || !consumer.dependsOn.includes(producer.id)) continue
        validateStructuredReference(
          context,
          context.root,
          occurrence.path,
          consumer.id,
          field,
          producer,
          reference,
          issues,
          producer.id,
        )
      }
    }
  }
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
      if (!match) continue
      const groupId = match.groups?.group
      const childId = match.groups?.child
      if (!groupId || !childId) continue
      const graph = context.projection.graphs.find(
        (candidate) => candidate.scope.kind === 'loop-group' && candidate.scope.groupId === groupId,
      )
      if (graph?.nodes.some(({ id }) => id === childId)) continue
      const targetGraph = graph ?? syntheticGraph(context.root, groupId)
      issues.push(
        scopedIssue(
          context,
          targetGraph,
          {
            code: context.capabilities.referenceSemantics.diagnosticCodes.unknownCompanionNode,
            message: `Companion reference "${occurrence.value}" does not name a known group child.`,
            path: pointerPath(occurrence.path),
            nodeId: childId,
            field: fieldIdentity(occurrence.path),
          },
          'companion',
          groupId,
        ),
      )
    }
  }
}

interface ParsedReference {
  readonly producer: string
  readonly path: readonly string[]
}

interface ReferenceGrammar {
  readonly current: { readonly expression: RegExp; readonly capture: number }
  readonly previous: { readonly expression: RegExp; readonly capture: number }
}

function referenceGrammar(contract: AuthoringContract, capabilities: ScopedDagCapabilities): ReferenceGrammar | null {
  const rule = contract.semantic_rules.find(({ id }) => id === capabilities.referenceSemantics.syntaxRule)
  if (!rule) return null
  const parser = parserForRule(rule)
  if (!parser) return null
  const previousSource = parser.expression.source.replace(
    /^\\\$\(/,
    `${escapeRegex(capabilities.previousIteration.prefix)}(`,
  )
  if (previousSource === parser.expression.source) return null
  return {
    current: parser,
    previous: { expression: new RegExp(previousSource, parser.expression.flags), capture: parser.capture },
  }
}

function parserForRule(rule: SemanticRuleDescriptor): { readonly expression: RegExp; readonly capture: number } | null {
  const pattern = rule.parameters.pattern
  const flags = rule.parameters.pattern_flags
  const capture = rule.parameters.node_id_capture_group
  if (typeof pattern !== 'string' || (flags !== undefined && typeof flags !== 'string')) return null
  if (typeof capture !== 'number' || !Number.isInteger(capture) || capture < 1) return null
  try {
    return { expression: new RegExp(pattern, `${flags ?? ''}g`), capture }
  } catch {
    return null
  }
}

function collectReferences(
  value: unknown,
  parser: { readonly expression: RegExp; readonly capture: number },
): readonly ParsedReference[] {
  if (typeof value !== 'string') return []
  const references: ParsedReference[] = []
  parser.expression.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = parser.expression.exec(value)) !== null) {
    const producer = match[parser.capture]
    if (producer) {
      const marker = `${producer}.output`
      const markerIndex = match[0].indexOf(marker)
      const suffix = markerIndex < 0 ? '' : match[0].slice(markerIndex + marker.length)
      references.push({ producer, path: suffix.split('.').filter(Boolean) })
    }
    if (match[0].length === 0) parser.expression.lastIndex += 1
  }
  return references
}

function validateStructuredReference(
  context: ValidationContext,
  graph: ProjectedGraph,
  occurrencePath: readonly (string | number)[],
  nodeId: string,
  field: string,
  producer: ProjectedNode,
  reference: ParsedReference,
  issues: ValidationIssue[],
  groupId?: string,
): void {
  if (reference.path.length === 0) return
  const schema = producerOutputSchema(context, producer)
  if (schema === undefined) {
    issues.push(
      referenceIssue(context, graph, occurrencePath, nodeId, field, 'producerSchemaRequired', producer.id, groupId),
    )
    return
  }
  if (structuredPathStatus(schema, reference.path) === 'impossible') {
    issues.push(
      referenceIssue(context, graph, occurrencePath, nodeId, field, 'structuredPathImpossible', producer.id, groupId),
    )
  }
}

type StructuredPathStatus = 'possible' | 'impossible' | 'unknown'

function structuredPathStatus(
  schema: unknown,
  path: readonly string[],
  root: unknown = schema,
  seen = new Set<string>(),
): StructuredPathStatus {
  if (path.length === 0) return schema === false ? 'impossible' : 'possible'
  if (schema === false) return 'impossible'
  if (!isRecord(schema)) return 'unknown'
  if (typeof schema.$ref === 'string') {
    if (!schema.$ref.startsWith('#/') || seen.has(schema.$ref)) return 'unknown'
    const resolved = resolveLocalReference(root, schema.$ref)
    if (resolved === undefined) return 'unknown'
    return structuredPathStatus(resolved, path, root, new Set([...seen, schema.$ref]))
  }
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword]
    if (Array.isArray(branches) && branches.length > 0) {
      const statuses = branches.map((branch) => structuredPathStatus(branch, path, root, seen))
      return statuses.every((status) => status === 'impossible')
        ? 'impossible'
        : statuses.some((status) => status === 'possible')
          ? 'possible'
          : 'unknown'
    }
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const statuses = schema.allOf.map((branch) => structuredPathStatus(branch, path, root, seen))
    if (statuses.some((status) => status === 'impossible')) return 'impossible'
    return statuses.some((status) => status === 'possible') ? 'possible' : 'unknown'
  }

  const [segment, ...rest] = path
  if (!segment) return 'possible'
  const numeric = /^(?:0|[1-9][0-9]*)$/.test(segment)
  if (numeric) {
    if (!typeAllows(schema.type, ['object', 'array'])) return 'impossible'
    const index = Number(segment)
    if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) {
      return structuredPathStatus(schema.prefixItems[index], rest, root, seen)
    }
    if (typeof schema.maxItems === 'number' && index >= schema.maxItems) return 'impossible'
    if (schema.items !== undefined) return structuredPathStatus(schema.items, rest, root, seen)
    if (schema.additionalItems === false) return 'impossible'
  } else if (!typeAllows(schema.type, ['object'])) {
    return 'impossible'
  }

  const properties = record(schema.properties)
  if (properties && Object.hasOwn(properties, segment)) {
    return structuredPathStatus(properties[segment], rest, root, seen)
  }
  if (isRecord(schema.patternProperties) && Object.keys(schema.patternProperties).length > 0) return 'unknown'
  if (schema.additionalProperties === false) return 'impossible'
  if (schema.additionalProperties !== undefined) {
    return structuredPathStatus(schema.additionalProperties, rest, root, seen)
  }
  return 'unknown'
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

function referenceIssue(
  context: ValidationContext,
  graph: ProjectedGraph,
  path: readonly (string | number)[],
  nodeId: string,
  field: string,
  kind: keyof ScopedDagCapabilities['referenceSemantics']['diagnosticCodes'],
  producer: string,
  groupId?: string,
): ValidationIssue {
  const code = context.capabilities.referenceSemantics.diagnosticCodes[kind]
  return scopedIssue(
    context,
    graph,
    {
      code,
      message: `Reference producer "${producer}" violates the contract-declared ${kind} rule.`,
      path: pointerPath(path),
      nodeId,
      field,
    },
    'definition',
    groupId,
  )
}

interface ScopedIssueInput {
  readonly code: string
  readonly message: string
  readonly path: string
  readonly nodeId: string
  readonly field: string
  readonly blocking?: boolean
  readonly severity?: ValidationIssue['severity']
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

function surfaceAllowsReferences(
  surface: Readonly<Record<string, unknown>>,
  capabilities: ScopedDagCapabilities,
): boolean {
  if (surface.authored_value === 'reference-template') return true
  if (surface.authored_value === 'literal-resource-name') return false
  if (surface.authored_value !== 'reference-template-if-inline-otherwise-literal-resource-name') return false
  const discriminatorId = surface.value_discriminator
  if (typeof discriminatorId !== 'string') return false
  const discriminator = capabilities.referenceSemantics.valueDiscriminators[discriminatorId]
  return discriminator?.operation === 'contains-listed-codepoint'
}

function appliesTo(fieldPath: string, references: Readonly<Record<string, unknown>>, kind: string): boolean {
  const descriptor = record(references[kind])
  return Boolean(
    descriptor &&
    Array.isArray(descriptor.applies_to) &&
    descriptor.applies_to.some(
      (path) => typeof path === 'string' && (fieldPath === path || fieldPath.startsWith(`${path}.`)),
    ),
  )
}

function currentScopeRequiresDependency(capabilities: ScopedDagCapabilities): boolean {
  return record(capabilities.references.current_scope)?.requires_direct_dependency === true
}

function groupUntilAllowsCurrentBody(fieldPath: string, capabilities: ScopedDagCapabilities): boolean {
  const descriptor = capabilities.referenceSemantics.groupUntilBash
  return (
    descriptor.current_scope === 'all-body-nodes' &&
    Array.isArray(descriptor.field_path) &&
    descriptor.field_path.every((value) => typeof value === 'string') &&
    fieldPath.endsWith(`.${descriptor.field_path.join('.')}`)
  )
}

function outerScopeRequiresDependency(capabilities: ScopedDagCapabilities): boolean {
  return record(capabilities.references.outer_scope)?.requires_group_dependency === true
}

function resolutionOrder(capabilities: ScopedDagCapabilities): readonly string[] {
  const resolution = record(capabilities.references.unqualified_producer_resolution)
  return Array.isArray(resolution?.order) && resolution.order.every((value) => typeof value === 'string')
    ? (resolution.order as string[])
    : []
}

function bodyConsumer(graph: ProjectedGraph, path: readonly (string | number)[]): ProjectedNode | undefined {
  if (!startsWithPath(path, graph.sourcePath)) return undefined
  const index = path[graph.sourcePath.length]
  return typeof index === 'number' ? graph.nodes[index] : undefined
}

function rootConsumer(graph: ProjectedGraph, path: readonly (string | number)[]): ProjectedNode | undefined {
  if (!startsWithPath(path, graph.sourcePath)) return undefined
  const index = path[graph.sourcePath.length]
  return typeof index === 'number' ? graph.nodes[index] : undefined
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

function syntheticGraph(root: ProjectedGraph, groupId: string): ProjectedGraph {
  return {
    ...root,
    scope: { ...root.scope, key: `loop-group:${groupId}`, kind: 'loop-group', groupId },
  }
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

function resolveLocalReference(root: unknown, reference: string): unknown {
  let current = root
  for (const token of reference
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined
    current = Array.isArray(current) ? current[Number(token)] : current[token]
  }
  return current
}

function typeAllows(value: unknown, allowed: readonly string[]): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return allowed.includes(value)
  return Array.isArray(value) && value.some((candidate) => typeof candidate === 'string' && allowed.includes(candidate))
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

function deduplicate(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = JSON.stringify([
      issue.code,
      issue.document,
      issue.path,
      issue.scopeKey,
      issue.groupId,
      issue.nodeId,
      issue.field,
    ])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
