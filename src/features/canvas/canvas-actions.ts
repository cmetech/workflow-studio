import type { AuthoringContract, NodeKindDescriptor, SemanticRuleDescriptor } from '$src/lib/contract/types'
import {
  applyWorkflowMutation,
  type ApplyWorkflowMutationResult,
  type YamlTransaction,
} from '$src/lib/documents/transactions'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import { patchWorkflowDocument } from '$src/lib/yaml/patch-document'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import type { CanvasPosition } from './types'

export interface CanvasActionContext {
  readonly pair: WorkflowPairText
  readonly projection: WorkflowProjection
  readonly contract: AuthoringContract
  readonly positions: Readonly<Record<string, CanvasPosition>>
  readonly applyMutation?: typeof applyWorkflowMutation
  readonly commit: (pair: WorkflowPairText, transaction: YamlTransaction) => void | Promise<void>
  readonly commitPositions: (updates: Readonly<Record<string, CanvasPosition | null>>) => void | Promise<void>
  readonly announce: (message: string) => void
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
  | MutationRejectionCode

export type CanvasActionResult =
  | {
      readonly status: 'committed'
      readonly pair: WorkflowPairText
      readonly transaction: YamlTransaction
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

export interface DependencyImpact {
  readonly key: string
  readonly nodeId: string
  readonly fieldPath: readonly (string | number)[]
  readonly yamlPath: readonly (string | number)[]
  readonly dependencyId: string
}

export interface ReferenceImpact {
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

export interface DeleteImpact {
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
  const source = context.projection.nodes.find(({ id }) => id === sourceId)
  const target = context.projection.nodes.find(({ id }) => id === targetId)
  if (!source || !target) return reject(context, 'missing_endpoint', 'Both connection endpoints must exist.')
  if (sourceId === targetId) return reject(context, 'self_edge', 'A node cannot depend on itself.')
  if (target.dependsOn.includes(sourceId)) {
    return reject(context, 'duplicate_edge', `${targetId} already depends on ${sourceId}.`)
  }
  if (hasDependencyPath(context.projection, sourceId, targetId)) {
    return reject(context, 'cycle', `Connecting ${sourceId} to ${targetId} would create a cycle.`)
  }
  return commitMutation(context, {
    type: 'set-dependencies',
    nodeId: targetId,
    dependsOn: [...target.dependsOn, sourceId],
  })
}

export async function disconnectNodes(
  context: CanvasActionContext,
  sourceId: string,
  targetId: string,
): Promise<CanvasActionResult> {
  const target = context.projection.nodes.find(({ id }) => id === targetId)
  if (!target || !context.projection.nodes.some(({ id }) => id === sourceId)) {
    return reject(context, 'missing_endpoint', 'Both connection endpoints must exist.')
  }
  if (!target.dependsOn.includes(sourceId)) {
    return reject(context, 'dependency_missing', `${targetId} does not depend on ${sourceId}.`)
  }
  return commitMutation(context, {
    type: 'set-dependencies',
    nodeId: targetId,
    dependsOn: target.dependsOn.filter((dependency) => dependency !== sourceId),
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
  const fields = graphContractFields(context.contract)
  if (!fields) return reject(context, 'descriptor_unavailable', 'The contract does not publish graph fields.')
  const after = options.afterNodeId ? context.projection.nodes.find(({ id }) => id === options.afterNodeId) : undefined
  if (options.afterNodeId && !after) return reject(context, 'node_missing', 'The selected node no longer exists.')

  const nodeId = collisionFreeId(descriptor.id, new Set(context.projection.nodes.map(({ id }) => id)))
  const node: Record<string, unknown> = {}
  setPath(node, fields.idPath, nodeId)
  const kindPath = relativeDescriptorPath(descriptor.field_path, fields.nodesPath)
  if (kindPath.length === 0) {
    return reject(context, 'descriptor_unavailable', 'The node descriptor has no usable kind field path.')
  }
  setPath(node, kindPath, descriptorInitialValue(context.contract, descriptor))
  if (after) setPath(node, fields.dependenciesPath, [after.id])

  const result = await commitMutation(context, {
    type: 'add-node',
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

export function previewDeleteNodes(
  projection: WorkflowProjection,
  nodeIds: readonly string[],
  contract: AuthoringContract,
): DeleteImpact {
  const selected = new Set(nodeIds)
  const fields = graphContractFields(contract)
  const nodes = rawNodes(projection, contract)
  const dependencies: DependencyImpact[] = []
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

  const references: ReferenceImpact[] = []
  for (const [nodeIndex, rawNode] of nodes.entries()) {
    const nodeId = String(valueAtPath(rawNode, fields?.idPath ?? ['id']))
    if (selected.has(nodeId)) continue
    const projectedNode = projection.nodes.find((candidate) => candidate.id === nodeId)
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

export async function deleteNodes(
  context: CanvasActionContext,
  nodeIds: readonly string[],
): Promise<CanvasActionResult> {
  const selected = [...new Set(nodeIds)]
  if (selected.length === 0) return reject(context, 'selection_empty', 'Select at least one node to delete.')
  if (selected.some((id) => !context.projection.nodes.some((node) => node.id === id))) {
    return reject(context, 'node_missing', 'A selected node no longer exists.')
  }
  const impact = previewDeleteNodes(context.projection, selected, context.contract)
  if (impact.references.length > 0) {
    const message = 'Resolve the listed output references before deleting the selected nodes.'
    context.announce(message)
    return { status: 'resolution_required', code: 'resolution_required', message, impact }
  }

  const mutation: WorkflowMutation =
    selected.length === 1
      ? { type: 'delete-node', nodeId: selected[0]! }
      : { type: 'replace-document', document: 'definition', text: context.pair.definition.text }
  const result =
    selected.length === 1
      ? await commitMutation(context, mutation)
      : await prepareAndCommitMultipleDeletes(context, selected)
  if (result.status === 'committed') {
    await context.commitPositions(Object.fromEntries(selected.map((id) => [id, null])))
  }
  return result
}

export async function renameNode(context: CanvasActionContext, from: string, to: string): Promise<CanvasActionResult> {
  if (!context.projection.nodes.some(({ id }) => id === from)) {
    return reject(context, 'node_missing', `Node ${from} no longer exists.`)
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(to)) {
    return reject(context, 'node_id_invalid', 'Node IDs must start with a letter or underscore.')
  }
  if (context.projection.nodes.some(({ id }) => id === to)) {
    return reject(context, 'node_id_duplicate', `Node ${to} already exists.`)
  }
  const result = await commitMutation(context, { type: 'rename-node', from, to })
  if (result.status === 'committed' && context.positions[from]) {
    await context.commitPositions({ [from]: null, [to]: context.positions[from] })
  }
  return result.status === 'committed' ? { ...result, nodeId: to } : result
}

export async function commitMutation(
  context: CanvasActionContext,
  mutation: WorkflowMutation,
): Promise<CanvasActionResult> {
  const result = await (context.applyMutation ?? applyWorkflowMutation)(context.pair, mutation, context.contract)
  if (!result.ok) {
    const message = result.message
    context.announce(message)
    return { status: 'rejected', code: result.code, message }
  }
  await context.commit(result.pair, result.transaction)
  return { status: 'committed', pair: result.pair, transaction: result.transaction }
}

export async function commitPreparedDefinition(
  context: CanvasActionContext,
  text: string,
): Promise<CanvasActionResult> {
  const pair = context.pair
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'canvas-prepared-mutation',
      workflowId: pair.workflowId,
      pairGeneration: pair.generation,
      definition: {
        path: pair.definition.path,
        text,
        revision: pair.definition.revision + 1,
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
  if (!analysis.structurallyValid) {
    const message = 'The proposed canvas mutation would make the workflow structurally invalid.'
    context.announce(message)
    return { status: 'rejected', code: 'mutation_invalid_workflow', message }
  }
  return commitMutation(context, { type: 'replace-document', document: 'definition', text })
}

async function prepareAndCommitMultipleDeletes(
  context: CanvasActionContext,
  selected: readonly string[],
): Promise<CanvasActionResult> {
  let text = context.pair.definition.text
  const pending = new Set(selected)
  const deletionContract: AuthoringContract = {
    ...context.contract,
    semantic_rules: context.contract.semantic_rules.filter((rule) => !isReferenceRule(rule)),
  }
  while (pending.size > 0) {
    let removed = false
    for (const nodeId of pending) {
      const patched = patchWorkflowDocument(text, { type: 'delete-node', nodeId }, deletionContract)
      if (patched.ok) {
        text = patched.text
        pending.delete(nodeId)
        removed = true
        break
      }
      context.announce(patched.message)
      return { status: 'rejected', code: patched.code, message: patched.message }
    }
    if (removed) continue
    const message = 'The selected nodes could not be deleted as one transaction.'
    context.announce(message)
    return { status: 'rejected', code: 'mutation_node_missing', message }
  }
  return commitPreparedDefinition(context, text)
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

export function rawNodes(projection: WorkflowProjection, contract: AuthoringContract): Record<string, unknown>[] {
  const fields = graphContractFields(contract)
  if (!fields) return []
  const value = valueAtPath(projection.definition, fields.nodesPath)
  return Array.isArray(value) ? value.filter(isRecord).map((node) => structuredClone(node)) : []
}

function reject(context: CanvasActionContext, code: CanvasRejectionCode, message: string): CanvasActionResult {
  context.announce(message)
  return { status: 'rejected', code, message }
}

function hasDependencyPath(projection: WorkflowProjection, from: string, to: string): boolean {
  const nodes = new Map(projection.nodes.map((node) => [node.id, node]))
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
    expression =
      typeof pattern === 'string'
        ? new RegExp(pattern, 'g')
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

export function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

export function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment]
    current = isRecord(existing) ? existing : ((current[segment] = {}) as Record<string, unknown>)
  }
  const key = path.at(-1)
  if (key) current[key] = value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
