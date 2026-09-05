import { isAlias, isMap, isScalar, isSeq, type Document, type YAMLSeq } from 'yaml'
import type { AuthoringContract } from '$src/lib/contract/types'
import { readScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import type { GraphScopeKey } from '$src/lib/projection/types'

export interface GraphFields {
  readonly nodesPath: readonly (string | number)[]
  readonly idPath: readonly string[]
  readonly dependenciesPath: readonly string[]
}
export type GraphScopeResult =
  | { readonly ok: true; readonly fields: GraphFields; readonly nodes: YAMLSeq }
  | {
      readonly ok: false
      readonly code: 'mutation_stale_scope' | 'mutation_ambiguous_alias' | 'mutation_contract_invalid'
      readonly message: string
    }

export function graphFields(contract: AuthoringContract): GraphFields | null {
  const rule = contract.semantic_rules.find(
    (candidate) =>
      candidate.status !== 'deferred' &&
      candidate.applicability.profiles.includes(contract.profile) &&
      candidate.applicability.documents.includes('definition') &&
      typeof candidate.parameters.nodes_path === 'string' &&
      typeof candidate.parameters.id_field === 'string' &&
      typeof candidate.parameters.dependencies_field === 'string',
  )
  if (!rule) return null
  const nodesPath = parseFieldPath(rule.parameters.nodes_path)
  const idPath = parseFieldPath(rule.parameters.id_field)
  const dependenciesPath = parseFieldPath(rule.parameters.dependencies_field)
  return nodesPath && idPath && dependenciesPath ? { nodesPath, idPath, dependenciesPath } : null
}

function parseFieldPath(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.startsWith('/'))
    return value
      .slice(1)
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  return value.replaceAll('[]', '').replaceAll('[*]', '').split('.').filter(Boolean)
}

/** Resolve only against this document; a group's current sequence index is never an identity. */
export function resolveGraphScope(
  document: Document,
  scopeKey: GraphScopeKey,
  contract: AuthoringContract,
): GraphScopeResult {
  const fields = graphFields(contract)
  if (!fields)
    return {
      ok: false,
      code: 'mutation_contract_invalid',
      message: 'The active contract does not publish usable graph field paths.',
    }
  const stale = (): GraphScopeResult => ({
    ok: false,
    code: 'mutation_stale_scope',
    message: `Graph scope "${scopeKey}" is missing, malformed, or ambiguous. Refresh the selected scope.`,
  })
  const alias = (): GraphScopeResult => ({
    ok: false,
    code: 'mutation_ambiguous_alias',
    message: 'This graph scope contains alias-derived or shared graph structure.',
  })
  const root = document.getIn(fields.nodesPath, true)
  if (isAlias(root)) return alias()
  if (!isSeq(root)) return stale()
  if (root.items.some(isAlias)) return alias()
  let resolved = fields
  if (scopeKey !== 'root') {
    let capabilities
    try {
      capabilities = readScopedDagCapabilities(contract)
    } catch {
      return stale()
    }
    if (!scopeKey.startsWith('loop-group:')) return stale()
    const id = scopeKey.slice('loop-group:'.length)
    const matches = root.items
      .map((node, index) => (isMap(node) && node.getIn(fields.idPath) === id ? index : -1))
      .filter((index) => index >= 0)
    if (matches.length !== 1) return stale()
    const owner = root.items[matches[0]!]
    if (!isMap(owner)) return stale()
    const kinds = contract.node_kinds.filter((descriptor) => {
      if (
        !descriptor.applicability.profiles.includes(contract.profile) ||
        !descriptor.applicability.documents.includes('definition')
      )
        return false
      const path = parseFieldPath(descriptor.field_path)
      return (
        path &&
        fields.nodesPath.every((segment, index) => path[index] === segment) &&
        owner.hasIn(path.slice(fields.nodesPath.length))
      )
    })
    if (kinds.length !== 1 || kinds[0]?.id !== capabilities.groupKind) return stale()
    const nodesPath = [...fields.nodesPath, matches[0]!, ...capabilities.bodyPath]
    for (let length = fields.nodesPath.length + 1; length <= nodesPath.length; length++) {
      const node = document.getIn(nodesPath.slice(0, length), true)
      if (isAlias(node) || ((isMap(node) || isSeq(node)) && node.anchor)) return alias()
    }
    resolved = { nodesPath, idPath: [capabilities.nodeIdField], dependenciesPath: [capabilities.dependsOnField] }
  }
  const nodes = document.getIn(resolved.nodesPath, true)
  if (isAlias(nodes) || (isSeq(nodes) && nodes.anchor)) return alias()
  if (!isSeq(nodes)) return stale()
  const ids = new Set<string>()
  for (const node of nodes.items) {
    if (isAlias(node) || (isMap(node) && node.anchor)) return alias()
    if (!isMap(node)) return stale()
    const id = node.getIn(resolved.idPath, true)
    if (isAlias(id) || (isScalar(id) && id.anchor)) return alias()
    if (!isScalar(id) || typeof id.value !== 'string' || id.value.length === 0 || ids.has(id.value)) return stale()
    ids.add(id.value)
    const dependencies = node.getIn(resolved.dependenciesPath, true)
    if (
      isAlias(dependencies) ||
      (isSeq(dependencies) &&
        (dependencies.anchor || dependencies.items.some((item) => isAlias(item) || (isScalar(item) && item.anchor))))
    )
      return alias()
    if (
      dependencies !== undefined &&
      (!isSeq(dependencies) || dependencies.items.some((item) => !isScalar(item) || typeof item.value !== 'string'))
    )
      return stale()
  }
  return { ok: true, fields: resolved, nodes }
}
