import type { AuthoringContract, SemanticRuleDescriptor, WorkflowProfile } from '$src/lib/contract/types'
import { patchWorkflowDocument } from '$src/lib/yaml/patch-document'
import type { CanvasPosition } from './types'
import {
  commitPreparedDefinition,
  graphContractFields,
  isRecord,
  rawNodes,
  setPath,
  valueAtPath,
  type CanvasActionContext,
  type CanvasActionResult,
} from './canvas-actions'

export interface CanvasClipboard {
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

export function copySelection(context: CanvasActionContext, selectedIds: readonly string[]): CanvasClipboard {
  const fields = graphContractFields(context.contract)
  const selected = new Set(selectedIds)
  const nodes = fields
    ? rawNodes(context.projection, context.contract).filter((node) =>
        selected.has(String(valueAtPath(node, fields.idPath))),
      )
    : []
  return deepFreeze({
    sourceProfile: context.contract.profile,
    selectedIds: nodes.map((node) => String(valueAtPath(node, fields?.idPath ?? ['id']))),
    nodes,
    positions: Object.fromEntries(
      selectedIds.flatMap((id) => (context.positions[id] ? [[id, { ...context.positions[id] }]] : [])),
    ),
  })
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

  const destinationNodes = rawNodes(context.projection, context.contract)
  const occupied = new Set(context.projection.nodes.map(({ id }) => id))
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
    rewriteNodeReferences(next, sourceId, idMap, context.contract, fields.nodesPath)
    return next
  })

  let preparedText = context.pair.definition.text
  let afterNodeId = destinationNodes.at(-1) ? String(valueAtPath(destinationNodes.at(-1), fields.idPath)) : undefined
  for (const node of copiedNodes) {
    const patched = patchWorkflowDocument(
      preparedText,
      { type: 'add-node', node, ...(afterNodeId ? { afterNodeId } : {}) },
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
  return { ...result, nodeIds: copiedIds.map((id) => idMap.get(id)!), positions }
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
  const occupied = new Set(Object.values(destination).map(positionKey))
  for (const sourceId of clipboard.selectedIds) {
    const copiedId = idMap.get(sourceId)
    if (!copiedId) continue
    const source = clipboard.positions[sourceId] ?? { x: 0, y: 0 }
    let position = { x: source.x + 48, y: source.y + 48 }
    while (occupied.has(positionKey(position))) position = { x: position.x + 48, y: position.y + 48 }
    occupied.add(positionKey(position))
    result[copiedId] = position
  }
  return result
}

function positionKey(position: CanvasPosition): string {
  return `${position.x}\0${position.y}`
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
