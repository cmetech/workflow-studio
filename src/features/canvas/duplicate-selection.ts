import type { AuthoringContract, SemanticRuleDescriptor, WorkflowProfile } from '$src/lib/contract/types'
import { compileContractValidators } from '$src/lib/validation/schema-validator'
import { patchWorkflowDocument } from '$src/lib/yaml/patch-document'
import { readScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import type { GraphScopeKey } from '$src/lib/projection/types'
import type { IndexedReferenceOccurrence } from '$src/lib/references/reference-index'
import { codePointToEditorOffset } from '$src/lib/references/unicode'
import type { CanvasPosition } from './types'
import { CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH } from './layout-graph'
import {
  commitPreparedDefinition,
  emptyIdentityChanges,
  identitySelected,
  nodeIdentity,
  occurrenceConsumer,
  validateActionContext,
  type ScopedNodeIdentity,
  type ClipboardDependency,
  graphContractFields,
  isRecord,
  rawNodes,
  setPath,
  valueAtPath,
  type CanvasActionContext,
  type CanvasActionResult,
} from './canvas-actions'

export interface CanvasClipboard {
  readonly sourceRevision: import('$src/lib/documents/types').DocumentRevision
  readonly sourceText: string
  readonly sourceContract: AuthoringContract
  readonly sourceWorkflowId: string
  readonly sourceDefinitionPath: string
  readonly sourceScopeKey: GraphScopeKey
  readonly selectedIdentities: readonly ScopedNodeIdentity[]
  readonly nodePaths: Readonly<Record<string, readonly (string | number)[]>>
  readonly dependencies: readonly ClipboardDependency[]
  readonly references: readonly IndexedReferenceOccurrence[]
  readonly groupScopes: readonly GraphScopeKey[]
  readonly unavailable?: Extract<CanvasActionResult, { status: 'rejected' }>

  readonly sourceProfile: WorkflowProfile
  readonly selectedIds: readonly string[]
  readonly nodes: readonly Readonly<Record<string, unknown>>[]
  readonly positions: Readonly<Record<string, CanvasPosition>>
}

export type DuplicateSelectionResult =
  | (Extract<CanvasActionResult, { status: 'committed' }> & {
      readonly nodeIds: readonly string[]
      readonly positions: Readonly<Record<string, CanvasPosition>>
    })
  | Exclude<CanvasActionResult, { status: 'committed' }>

// Clipboard handles are process-local and deeply frozen. Keeping provenance outside
// the structural object prevents callers from replacing derived scanner evidence.
const issuedClipboards = new WeakSet<CanvasClipboard>()

export function copySelection(context: CanvasActionContext, selectedIds: readonly string[]): CanvasClipboard {
  const unavailable = validateActionContext(context)
  const fields = graphContractFields(context.contract)
  const selected = new Set(selectedIds)
  const nodes = fields
    ? rawNodes(context.projection, context.contract, context.scopeKey).filter((node) =>
        selected.has(String(valueAtPath(node, fields.idPath))),
      )
    : []
  const selectedIdentities = nodes.map((node) =>
    nodeIdentity(context.scopeKey, String(valueAtPath(node, fields?.idPath ?? ['id']))),
  )
  const dependencies: ClipboardDependency[] = []
  for (const graph of context.projection.graphs) {
    for (const node of graph.nodes) {
      const consumer = nodeIdentity(graph.scope.key, node.id)
      if (!identitySelected(context, selected, consumer)) continue
      for (const producerId of node.dependsOn)
        dependencies.push({ consumer, producer: nodeIdentity(graph.scope.key, producerId) })
    }
  }
  const clipboard: CanvasClipboard = deepFreeze({
    sourceRevision: { ...context.revision },
    sourceText: context.pair.definition.text,
    sourceContract: structuredClone(context.contract),
    sourceWorkflowId: context.pair.workflowId,
    sourceDefinitionPath: context.pair.definition.path,
    sourceScopeKey: context.scopeKey,
    selectedIdentities,
    dependencies,
    references: structuredClone(
      context.referenceIndex?.occurrences.filter((occurrence) =>
        identitySelected(context, selected, occurrenceConsumer(occurrence)),
      ) ?? [],
    ),
    groupScopes:
      context.scopeKey === 'root'
        ? context.projection.graphs
            .filter((graph) => graph.scope.groupId && selected.has(graph.scope.groupId))
            .map((graph) => graph.scope.key)
        : [],
    nodePaths: Object.fromEntries(
      context.graph.nodes.flatMap((node, index) =>
        selected.has(node.id) ? [[node.id, [...context.graph.sourcePath, index]]] : [],
      ),
    ),
    ...(unavailable ? { unavailable } : {}),
    sourceProfile: context.contract.profile,
    selectedIds: nodes.map((node) => String(valueAtPath(node, fields?.idPath ?? ['id']))),
    nodes,
    positions: Object.fromEntries(
      selectedIds.flatMap((id) => (context.positions[id] ? [[id, { ...context.positions[id] }]] : [])),
    ),
  })
  issuedClipboards.add(clipboard)
  return clipboard
}

export async function duplicateSelection(
  context: CanvasActionContext,
  selectedIds: readonly string[],
): Promise<DuplicateSelectionResult> {
  return pasteSelection(context, copySelection(context, selectedIds))
}

export async function pasteSelection(
  context: CanvasActionContext,
  clipboard: CanvasClipboard,
): Promise<DuplicateSelectionResult> {
  const unavailable = validateActionContext(context) ?? clipboard.unavailable
  if (unavailable) return unavailable
  if (
    clipboard.sourceRevision.workflowId !== clipboard.sourceWorkflowId ||
    clipboard.sourceRevision.definitionPath !== clipboard.sourceDefinitionPath ||
    clipboard.sourceRevision.contractDigest !== clipboard.sourceContract.contract_digest ||
    clipboard.selectedIdentities.some((identity) => identity.scopeKey !== clipboard.sourceScopeKey)
  ) {
    const message = 'The clipboard no longer matches its captured workflow revision and scope.'
    context.announce(message)
    return { status: 'rejected', code: 'stale_document', message }
  }
  if (!issuedClipboards.has(clipboard)) {
    const message = 'The clipboard is not an original immutable copy from this application session.'
    context.announce(message)
    return { status: 'rejected', code: 'mutation_stale_scope', message }
  }
  if (clipboard.nodes.length === 0) {
    const message = 'Copy at least one node before pasting.'
    context.announce(message)
    return { status: 'rejected', code: 'selection_empty', message }
  }
  const fields = graphContractFields(context.contract)
  if (!fields) {
    const message = 'The active contract does not publish graph fields.'
    context.announce(message)
    return { status: 'rejected', code: 'descriptor_unavailable', message }
  }
  const disallowed = firstDisallowedField(clipboard.nodes, context.contract, fields.nodesPath)
  if (disallowed) {
    const message = `Field ${disallowed} is not allowed by the active ${context.contract.profile} profile.`
    context.announce(message)
    return { status: 'rejected', code: 'profile_disallowed', message }
  }

  const destinationNodes = rawNodes(context.projection, context.contract, context.scopeKey)
  const occupied = new Set(context.graph.nodes.map(({ id }) => id))
  const copiedIds = clipboard.nodes.map((node) => String(valueAtPath(node, fields.idPath)))
  const idMap = new Map<string, string>()
  for (const sourceId of copiedIds) {
    const copiedId = collisionFreeCopyId(sourceId, occupied)
    occupied.add(copiedId)
    idMap.set(sourceId, copiedId)
  }

  const copiedNodes = clipboard.nodes.map((node) => {
    const next = structuredClone(node) as Record<string, unknown>
    const sourceId = String(valueAtPath(next, fields.idPath))
    setPath(next, fields.idPath, idMap.get(sourceId) ?? sourceId)
    const dependencies = valueAtPath(next, fields.dependenciesPath)
    if (Array.isArray(dependencies)) {
      setPath(
        next,
        fields.dependenciesPath,
        dependencies.map((dependency) => idMap.get(String(dependency)) ?? dependency),
      )
    }
    if (clipboard.sourceContract.contract_reader_version === 3)
      rewriteIndexedReferences(next, sourceId, clipboard, idMap)
    else rewriteNodeReferences(next, sourceId, idMap, context.contract, fields.nodesPath)
    return next
  })

  const descriptorDisallowed = firstDescriptorDisallowedField(copiedNodes, context.contract, fields.nodesPath)
  if (descriptorDisallowed) {
    const message = `Field ${descriptorDisallowed} is not allowed by the active ${context.contract.profile} profile.`
    context.announce(message)
    return { status: 'rejected', code: 'profile_disallowed', message }
  }
  const candidateDefinition = structuredClone(context.projection.definition) as Record<string, unknown>
  setPath(candidateDefinition, context.graph.sourcePath, [...destinationNodes, ...copiedNodes])
  let schemaValid = false
  try {
    schemaValid = compileContractValidators(context.contract).definition(candidateDefinition)
  } catch {
    schemaValid = false
  }
  if (!schemaValid) {
    const message = `The copied selection is not allowed by the active ${context.contract.profile} contract.`
    context.announce(message)
    return { status: 'rejected', code: 'profile_disallowed', message }
  }

  if (context.scopeKey !== 'root') {
    const allowed = readScopedDagCapabilities(context.contract).allowedNodeKinds
    for (const node of copiedNodes) {
      const kind = context.contract.node_kinds.find(
        (descriptor) => valueAtPath(node, relativePath(descriptor.field_path, fields.nodesPath)) !== undefined,
      )
      if (!kind || !allowed.includes(kind.id)) {
        const message = 'The copied node kind is not allowed in this loop group body.'
        context.announce(message)
        return { status: 'rejected', code: 'profile_disallowed', message }
      }
    }
  }
  const sameScope =
    clipboard.sourceWorkflowId === context.pair.workflowId &&
    clipboard.sourceDefinitionPath === context.pair.definition.path &&
    clipboard.sourceScopeKey === context.scopeKey
  if (!sameScope) {
    const dependencies = clipboard.dependencies.filter(({ producer }) => !clipboardContains(clipboard, producer))
    const references = clipboard.references.filter((occurrence) =>
      occurrence.references.some(
        (token) =>
          !token.resolvedProducer ||
          !clipboardContains(clipboard, nodeIdentity(token.resolvedProducer.scopeKey, token.resolvedProducer.nodeId)) ||
          (context.scopeKey === 'root' && clipboard.sourceScopeKey !== 'root' && token.kind === 'previous'),
      ),
    )
    if (dependencies.length || references.length) {
      const message = 'Resolve incoming dependencies and scoped references before pasting into another graph.'
      context.announce(message)
      return {
        status: 'resolution_required',
        code: 'resolution_required',
        message,
        clipboardImpact: {
          sourceScopeKey: clipboard.sourceScopeKey,
          destinationScopeKey: context.scopeKey,
          dependencies,
          references,
        },
      }
    }
  }

  let preparedText = context.pair.definition.text
  let afterNodeId = destinationNodes.at(-1) ? String(valueAtPath(destinationNodes.at(-1), fields.idPath)) : undefined
  for (const [index, node] of copiedNodes.entries()) {
    const patched = patchWorkflowDocument(
      preparedText,
      {
        type: 'add-node',
        scopeKey: context.scopeKey,
        node,
        copiedSource: {
          text: clipboard.sourceText,
          scopeKey: clipboard.sourceScopeKey,
          nodeId: copiedIds[index]!,
          contract: clipboard.sourceContract,
          originalValue: clipboard.nodes[index]!,
        },
        ...(afterNodeId ? { afterNodeId } : {}),
      },
      context.contract,
    )
    if (!patched.ok) {
      context.announce(patched.message)
      return { status: 'rejected', code: patched.code, message: patched.message }
    }
    preparedText = patched.text
    afterNodeId = String(valueAtPath(node, fields.idPath))
  }
  const result = await commitPreparedDefinition(context, preparedText)
  if (result.status !== 'committed') return result

  const positions = copiedPositions(clipboard, idMap, context.positions)
  await context.commitPositions(positions)
  return {
    ...result,
    nodeIds: copiedIds.map((id) => idMap.get(id)!),
    positions,
    identityChanges: {
      ...emptyIdentityChanges(),
      nodeCopies: copiedIds.map((id) => ({
        from: nodeIdentity(clipboard.sourceScopeKey, id),
        to: nodeIdentity(context.scopeKey, idMap.get(id)!),
      })),
      scopeCopies: clipboard.groupScopes.map((scope) => ({
        from: scope,
        to: `loop-group:${idMap.get(scope.slice('loop-group:'.length))!}` as GraphScopeKey,
      })),
    },
  }
}

function clipboardContains(clipboard: CanvasClipboard, identity: ScopedNodeIdentity): boolean {
  return (
    clipboard.selectedIdentities.some(
      (selected) => selected.scopeKey === identity.scopeKey && selected.nodeId === identity.nodeId,
    ) || clipboard.groupScopes.includes(identity.scopeKey)
  )
}

function rewriteIndexedReferences(
  node: Record<string, unknown>,
  sourceId: string,
  clipboard: CanvasClipboard,
  idMap: ReadonlyMap<string, string>,
): void {
  const basePath = clipboard.nodePaths[sourceId]
  if (!basePath) return
  for (const occurrence of clipboard.references) {
    if (!basePath.every((segment, index) => occurrence.valuePath[index] === segment)) continue
    let value = occurrence.authoredText
    for (const token of [...occurrence.references].sort((left, right) => right.start - left.start)) {
      const producer = token.resolvedProducer
      // Descendant body producer IDs stay unchanged when the root group is copied.
      if (!producer || producer.scopeKey !== clipboard.sourceScopeKey) continue
      const mapped = idMap.get(producer.nodeId)
      if (!mapped) continue
      const prefixLength = token.kind === 'previous' ? '$LOOP_PREV.'.length : 1
      const start = codePointToEditorOffset(occurrence.authoredText, token.start + prefixLength)
      const end = start + token.producerId.length
      value = value.slice(0, start) + mapped + value.slice(end)
    }
    if (value !== occurrence.authoredText) setPath(node, occurrence.valuePath.slice(basePath.length), value)
  }
}

function firstDisallowedField(
  nodes: readonly Readonly<Record<string, unknown>>[],
  contract: AuthoringContract,
  nodesPath: readonly string[],
): string | null {
  let schema: unknown = contract.definition_schema
  for (const segment of nodesPath) {
    schema = isRecord(schema) && isRecord(schema.properties) ? schema.properties[segment] : undefined
  }
  const itemSchema = isRecord(schema) ? schema.items : undefined
  if (!isRecord(itemSchema) || itemSchema.additionalProperties !== false) return null
  const allowed = new Set(isRecord(itemSchema.properties) ? Object.keys(itemSchema.properties) : [])
  for (const node of nodes) {
    for (const field of Object.keys(node)) if (!allowed.has(field)) return field
  }
  return null
}

function firstDescriptorDisallowedField(
  nodes: readonly Readonly<Record<string, unknown>>[],
  contract: AuthoringContract,
  nodesPath: readonly string[],
): string | null {
  for (const node of nodes) {
    const kind = contract.node_kinds.find((descriptor) => {
      const path = relativePath(descriptor.field_path, nodesPath)
      return path.length > 0 && valueAtPath(node, path) !== undefined
    })
    if (kind && !descriptorApplies(kind, contract.profile, kind.id)) return kind.field_path
    const fieldsByPath = new Map<string, (typeof contract.node_kinds)[number]['fields'][number][]>()
    for (const descriptor of contract.node_kinds.flatMap(({ fields }) => fields)) {
      fieldsByPath.set(descriptor.field_path, [...(fieldsByPath.get(descriptor.field_path) ?? []), descriptor])
    }
    for (const [fieldPath, descriptors] of fieldsByPath) {
      const path = descriptorRelativePath(fieldPath, nodesPath)
      if (!path || !hasDescriptorValue(node, path)) continue
      if (!descriptors.some((descriptor) => descriptorApplies(descriptor, contract.profile, kind?.id))) {
        return fieldPath
      }
    }
  }
  return null
}

function descriptorRelativePath(path: string, nodesPath: readonly string[]): readonly (string | '*')[] | null {
  const tokens = path
    .replaceAll('[*]', '[]')
    .split('.')
    .filter(Boolean)
    .flatMap((token) => (token.endsWith('[]') ? [token.slice(0, -2), '*'] : [token]))
  if (!nodesPath.every((segment, index) => tokens[index] === segment)) return null
  const relative = tokens.slice(nodesPath.length)
  return relative[0] === '*' ? relative.slice(1) : relative
}

function hasDescriptorValue(value: unknown, path: readonly (string | '*')[]): boolean {
  if (path.length === 0) return value !== undefined
  const [segment, ...rest] = path
  if (segment === '*') return Array.isArray(value) && value.some((child) => hasDescriptorValue(child, rest))
  return isRecord(value) && hasDescriptorValue(value[segment!], rest)
}

function descriptorApplies(
  descriptor: {
    readonly status: string
    readonly applicability: {
      readonly profiles: readonly WorkflowProfile[]
      readonly documents: readonly string[]
      readonly node_kinds?: readonly string[]
    }
  },
  profile: WorkflowProfile,
  kind: string | undefined,
): boolean {
  return (
    descriptor.status === 'supported' &&
    descriptor.applicability.profiles.includes(profile) &&
    descriptor.applicability.documents.includes('definition') &&
    (!descriptor.applicability.node_kinds || (kind !== undefined && descriptor.applicability.node_kinds.includes(kind)))
  )
}

function collisionFreeCopyId(sourceId: string, occupied: ReadonlySet<string>): string {
  if (!occupied.has(sourceId)) return sourceId
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${sourceId}-${suffix}`
    if (!occupied.has(candidate)) return candidate
  }
}

function rewriteNodeReferences(
  node: Record<string, unknown>,
  sourceId: string,
  idMap: ReadonlyMap<string, string>,
  contract: AuthoringContract,
  nodesPath: readonly string[],
): void {
  const kind = contract.node_kinds.find((descriptor) => {
    const relative = relativePath(descriptor.field_path, nodesPath)
    return relative.length > 0 && valueAtPath(node, relative) !== undefined
  })?.id
  for (const rule of contract.semantic_rules) {
    if (!referenceRuleApplies(rule, contract.profile, kind)) continue
    for (const fieldPath of rule.field_paths) {
      const relative = nodeRelativePath(fieldPath)
      if (!relative) continue
      const current = valueAtPath(node, relative)
      const rewritten = rewriteValue(current, (value) => rewriteReferenceString(value, idMap, rule))
      if (rewritten !== current) setPath(node, relative, rewritten)
    }
  }
  void sourceId
}

function referenceRuleApplies(
  rule: SemanticRuleDescriptor,
  profile: WorkflowProfile,
  kind: string | undefined,
): boolean {
  return (
    rule.status !== 'deferred' &&
    rule.applicability.profiles.includes(profile) &&
    rule.applicability.documents.includes('definition') &&
    (!rule.applicability.node_kinds || (kind !== undefined && rule.applicability.node_kinds.includes(kind))) &&
    (typeof rule.parameters.pattern === 'string' || rule.parameters.syntax === '$ID.output(.path)*')
  )
}

function rewriteReferenceString(
  value: string,
  idMap: ReadonlyMap<string, string>,
  rule: SemanticRuleDescriptor,
): string {
  if (rule.parameters.syntax === '$ID.output(.path)*' && typeof rule.parameters.pattern !== 'string') {
    return value.replace(
      /\$([A-Za-z_][A-Za-z0-9_-]*)(\.output(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)/g,
      (match, id: string, suffix: string) => (idMap.has(id) ? `$${idMap.get(id)}${suffix}` : match),
    )
  }
  const pattern = rule.parameters.pattern
  const capture = typeof rule.parameters.node_id_capture_group === 'number' ? rule.parameters.node_id_capture_group : 1
  if (typeof pattern !== 'string') return value
  let expression: RegExp
  try {
    expression = new RegExp(pattern, 'gd')
  } catch {
    return value
  }
  const edits: { start: number; end: number; replacement: string }[] = []
  for (const match of value.matchAll(expression)) {
    const captured = match[capture]
    const range = match.indices?.[capture]
    const mapped = captured ? idMap.get(captured) : undefined
    if (mapped && range) edits.push({ start: range[0], end: range[1], replacement: mapped })
  }
  return [...edits]
    .reverse()
    .reduce(
      (rewritten, edit) => `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`,
      value,
    )
}

function rewriteValue(value: unknown, rewrite: (value: string) => string): unknown {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) {
    const next = value.map((item) => rewriteValue(item, rewrite))
    return next.some((item, index) => item !== value[index]) ? next : value
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, rewriteValue(item, rewrite)] as const)
    return entries.some(([key, item]) => item !== value[key]) ? Object.fromEntries(entries) : value
  }
  return value
}

function copiedPositions(
  clipboard: CanvasClipboard,
  idMap: ReadonlyMap<string, string>,
  destination: Readonly<Record<string, CanvasPosition>>,
): Record<string, CanvasPosition> {
  const result: Record<string, CanvasPosition> = {}
  const occupied = Object.values(destination)
  const rawSources = clipboard.selectedIds.flatMap((sourceId, index) => {
    const copiedId = idMap.get(sourceId)
    return copiedId
      ? [{ copiedId, source: clipboard.positions[sourceId] ?? { x: 0, y: index * (CANVAS_NODE_HEIGHT + 48) } }]
      : []
  })
  const sources: { copiedId: string; source: CanvasPosition }[] = []
  for (const candidate of rawSources) {
    let source = { ...candidate.source }
    while (sources.some((placed) => rectanglesIntersect(source, placed.source))) {
      source = { ...source, y: source.y + CANVAS_NODE_HEIGHT + 48 }
    }
    sources.push({ copiedId: candidate.copiedId, source })
  }
  let offset = { x: CANVAS_NODE_WIDTH + 48, y: 0 }
  while (
    sources.some(({ source }) =>
      occupied.some((position) => rectanglesIntersect({ x: source.x + offset.x, y: source.y + offset.y }, position)),
    )
  ) {
    offset = { ...offset, y: offset.y + CANVAS_NODE_HEIGHT + 48 }
  }
  for (const { copiedId, source } of sources) {
    result[copiedId] = { x: source.x + offset.x, y: source.y + offset.y }
  }
  return result
}

function rectanglesIntersect(left: CanvasPosition, right: CanvasPosition): boolean {
  return Math.abs(left.x - right.x) < CANVAS_NODE_WIDTH && Math.abs(left.y - right.y) < CANVAS_NODE_HEIGHT
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

function relativePath(path: string, parent: readonly string[]): string[] {
  const tokens = path.replaceAll('[]', '').split('.').filter(Boolean)
  return parent.every((segment, index) => tokens[index] === segment) ? tokens.slice(parent.length) : tokens
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
