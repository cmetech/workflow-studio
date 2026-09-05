import { isSeq } from 'yaml'
import type { AuthoringContract, SemanticRuleDescriptor, WorkflowProfile } from '$src/lib/contract/types'
import { readScopedDagCapabilities, requiresScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'
import {
  VISUAL_EDGE_CAPACITY,
  VISUAL_NODE_CAPACITY,
  type GraphScope,
  type ProjectedEdge,
  type ProjectedGraph,
  type ProjectedNode,
  type WorkflowIdentity,
} from './types'

export interface GraphScopeDiscovery {
  readonly graphs: readonly ProjectedGraph[]
  readonly issues: readonly ValidationIssue[]
}

export function discoverGraphScopes(
  definitionDocument: ParsedYamlDocument,
  contract: AuthoringContract,
  profile: WorkflowProfile,
  resolvedDefinition?: unknown,
): readonly ProjectedGraph[] {
  return projectGraphScopes(definitionDocument, contract, profile, resolvedDefinition).graphs
}

function projectGraphScopes(
  definitionDocument: ParsedYamlDocument,
  contract: AuthoringContract,
  profile: WorkflowProfile,
  resolvedDefinition?: unknown,
): GraphScopeDiscovery {
  const definitionValue =
    resolvedDefinition === undefined
      ? (definitionDocument.document.toJS({ maxAliasCount: 1_000 }) as unknown)
      : resolvedDefinition
  const definition = isRecord(definitionValue) ? definitionValue : {}
  const identity: WorkflowIdentity = deepFreeze({
    name: typeof definition.name === 'string' ? definition.name : '',
    profile,
  })
  const graphRule = findGraphRule(contract.semantic_rules, profile)
  if (!graphRule)
    return ruleIssue(
      identity,
      'dag_rule_missing',
      'The active authoring contract does not publish its DAG field parameters.',
    )

  const nodesPath = parseFieldPath(graphRule.parameters.nodes_path)
  const idPath = parseFieldPath(graphRule.parameters.id_field)
  const dependenciesPath = parseFieldPath(graphRule.parameters.dependencies_field)
  if (!nodesPath || !idPath || !dependenciesPath)
    return ruleIssue(
      identity,
      'dag_rule_invalid',
      'The active authoring contract publishes invalid DAG field parameters.',
    )

  const descriptors = contract.node_kinds.filter(
    (descriptor) =>
      descriptor.applicability.profiles.includes(profile) && descriptor.applicability.documents.includes('definition'),
  )
  const rootKindPaths = descriptors.map((descriptor) => ({
    descriptor,
    relativePath: nodeKindRelativePath(descriptor.field_path, nodesPath),
  }))
  const root = projectGraph({
    definitionDocument,
    definitionValue,
    sourcePath: nodesPath,
    scope: deepFreeze({ key: 'root', kind: 'root', workflow: identity }),
    editorNodePrefix: '',
    outerInputs: [],
    idPath,
    dependenciesPath,
    kindPaths: rootKindPaths,
  })
  const graphs: ProjectedGraph[] = [root]

  let scoped
  try {
    scoped = readScopedDagCapabilities(contract)
  } catch {
    if (requiresScopedDagCapabilities(contract, profile, 'definition')) return scopedCapabilityIssue(root)
    return freezeDiscovery(graphs)
  }
  const rootIdCounts = new Map<string, number>()
  for (const node of root.nodes) {
    if (node.id.length === 0) continue
    rootIdCounts.set(node.id, (rootIdCounts.get(node.id) ?? 0) + 1)
  }
  for (const [rootIndex, node] of root.nodes.entries()) {
    if (node.kind !== scoped.groupKind || node.id.length === 0 || scoped.bodyPath[0] !== scoped.groupKind) continue
    const sourcePath = [...nodesPath, rootIndex, ...scoped.bodyPath] as const
    graphs.push(
      projectGraph({
        definitionDocument,
        definitionValue,
        sourcePath,
        scope: deepFreeze({ key: `loop-group:${node.id}`, kind: 'loop-group', groupId: node.id, workflow: identity }),
        editorNodePrefix: `${node.id}/`,
        outerInputs: validOuterInputs(node.dependsOn, node.id, rootIdCounts),
        idPath: [scoped.nodeIdField],
        dependenciesPath: [scoped.dependsOnField],
        kindPaths: rootKindPaths.filter(({ descriptor }) => scoped.allowedNodeKinds.includes(descriptor.id)),
        primarySink: scoped.primarySink,
      }),
    )
  }
  return freezeDiscovery(graphs)
}

function validOuterInputs(
  dependencies: readonly string[],
  groupId: string,
  rootIdCounts: ReadonlyMap<string, number>,
): readonly string[] {
  const inputs = new Set<string>()
  for (const dependency of dependencies) {
    if (dependency !== groupId && rootIdCounts.get(dependency) === 1) inputs.add(dependency)
  }
  return [...inputs]
}

interface ProjectGraphInput {
  readonly definitionDocument: ParsedYamlDocument
  readonly definitionValue: unknown
  readonly sourcePath: readonly (string | number)[]
  readonly scope: GraphScope
  readonly editorNodePrefix: string
  readonly outerInputs: readonly string[]
  readonly idPath: readonly string[]
  readonly dependenciesPath: readonly string[]
  readonly kindPaths: readonly {
    readonly descriptor: AuthoringContract['node_kinds'][number]
    readonly relativePath: readonly string[] | null
  }[]
  readonly primarySink?: 'first-terminal-in-definition-order'
}

function projectGraph(input: ProjectGraphInput): ProjectedGraph {
  const yamlNodes = input.definitionDocument.document.getIn(input.sourcePath, true) as
    { readonly range?: readonly number[] } | undefined
  const rawNodes = valueAtPath(input.definitionValue, input.sourcePath)
  const nodeValues = Array.isArray(rawNodes) ? rawNodes : []
  const issues: ValidationIssue[] = []
  const nodes: ProjectedNode[] = []
  nodeValues.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) return
    const idValue = valueAtPath(rawNode, input.idPath)
    const id = typeof idValue === 'string' ? idValue : ''
    const dependenciesValue = valueAtPath(rawNode, input.dependenciesPath)
    const dependsOn = Array.isArray(dependenciesValue)
      ? dependenciesValue.filter((value): value is string => typeof value === 'string')
      : []
    const matchingKinds = input.kindPaths.filter(
      (candidate) => candidate.relativePath !== null && hasPath(rawNode, candidate.relativePath),
    )
    const sourcePath = pointerPath([...input.sourcePath, index])
    const sourceNode = isSeq(yamlNodes) ? yamlNodes.get(index, true) : undefined
    const sourceRange = sourceNode?.range
    if (matchingKinds.length === 0) {
      issues.push(
        projectionIssue(
          'missing_node_kind',
          `Node "${id || index}" must declare exactly one contract node-kind field.`,
          sourcePath,
          id,
        ),
      )
    } else if (matchingKinds.length > 1) {
      issues.push(
        projectionIssue(
          'multiple_node_kinds',
          `Node "${id || index}" declares more than one contract node-kind field.`,
          sourcePath,
          id,
        ),
      )
    }
    const selected = matchingKinds[0]
    const kind = selected?.descriptor.id ?? ''
    const value = selected?.relativePath ? valueAtPath(rawNode, selected.relativePath) : undefined
    if (selected && selected.descriptor.status !== 'supported') {
      issues.push({
        code: `node_kind_${selected.descriptor.status}`,
        layer: 'compatibility',
        severity: 'warning',
        blocking: false,
        message: `Node kind "${selected.descriptor.id}" is ${selected.descriptor.status} in the active contract.`,
        document: 'definition',
        path: sourcePath,
        ...(id ? { nodeId: id } : {}),
        field: selected.relativePath?.join('.') ?? selected.descriptor.id,
      })
    }
    const excludedKeys = new Set<string>([
      input.idPath[0] ?? '',
      input.dependenciesPath[0] ?? '',
      ...input.kindPaths.flatMap(({ relativePath }) => (relativePath?.[0] ? [relativePath[0]] : [])),
    ])
    nodes.push({
      id,
      kind,
      value: deepFreeze(value),
      dependsOn: deepFreeze([...dependsOn]),
      options: deepFreeze(Object.fromEntries(Object.entries(rawNode).filter(([key]) => !excludedKeys.has(key)))),
      source: { path: sourcePath, start: sourceRange?.[0] ?? 0, end: sourceRange?.[1] ?? 0 },
    })
  })
  const edges: ProjectedEdge[] = nodes.flatMap((target) =>
    target.dependsOn.map((source) => ({ id: `dependency:${source}->${target.id}`, source, target: target.id })),
  )
  const sourceRange = yamlNodes?.range
  const primarySinkId = input.primarySink === 'first-terminal-in-definition-order' ? firstTerminal(nodes) : undefined
  return deepFreeze({
    scope: input.scope,
    editorNodePrefix: input.editorNodePrefix,
    sourcePath: [...input.sourcePath],
    sourceRange: { start: sourceRange?.[0] ?? 0, end: sourceRange?.[1] ?? 0 },
    nodes,
    edges,
    definitionOrder: nodes.map(({ id }) => id),
    ...(primarySinkId ? { primarySinkId } : {}),
    outerInputs: [...input.outerInputs],
    issues,
    capacity: {
      status: nodes.length <= VISUAL_NODE_CAPACITY && edges.length <= VISUAL_EDGE_CAPACITY ? 'visual' : 'yaml-only',
      nodeCount: nodes.length,
      edgeCount: edges.length,
    } as const,
  })
}

function firstTerminal(nodes: readonly ProjectedNode[]): string | undefined {
  const producers = new Set(nodes.flatMap((node) => node.dependsOn))
  return nodes.find((node) => node.id.length > 0 && !producers.has(node.id))?.id
}

function freezeDiscovery(graphs: readonly ProjectedGraph[]): GraphScopeDiscovery {
  return deepFreeze({ graphs: [...graphs], issues: graphs.flatMap((graph) => graph.issues) })
}

function ruleIssue(identity: WorkflowIdentity, code: string, message: string): GraphScopeDiscovery {
  const issue: ValidationIssue = {
    code,
    layer: 'semantic',
    severity: 'error',
    blocking: true,
    message,
    document: 'definition',
    path: '/nodes',
  }
  return freezeDiscovery([
    deepFreeze({
      scope: deepFreeze({ key: 'root', kind: 'root', workflow: identity }),
      editorNodePrefix: '',
      sourcePath: ['nodes'],
      sourceRange: { start: 0, end: 0 },
      nodes: [],
      edges: [],
      definitionOrder: [],
      outerInputs: [],
      issues: [issue],
      capacity: { status: 'visual', nodeCount: 0, edgeCount: 0 } as const,
    }),
  ])
}

function scopedCapabilityIssue(root: ProjectedGraph): GraphScopeDiscovery {
  const issue: ValidationIssue = {
    code: 'scoped_dag_capability_unsupported',
    layer: 'semantic',
    severity: 'error',
    blocking: true,
    message: 'The active authoring contract publishes scoped graph semantics unsupported by this Studio reader.',
    document: 'definition',
    path: '/nodes',
  }
  return freezeDiscovery([{ ...root, issues: [...root.issues, issue] }])
}

function findGraphRule(
  rules: readonly SemanticRuleDescriptor[],
  profile: WorkflowProfile,
): SemanticRuleDescriptor | undefined {
  return rules.find(
    (rule) =>
      rule.status !== 'deferred' &&
      rule.applicability.profiles.includes(profile) &&
      rule.applicability.documents.includes('definition') &&
      typeof rule.parameters.nodes_path === 'string' &&
      typeof rule.parameters.id_field === 'string' &&
      typeof rule.parameters.dependencies_field === 'string',
  )
}

function nodeKindRelativePath(fieldPath: string, nodesPath: readonly string[]): string[] | null {
  const tokens = fieldPath.replaceAll('[]', '').split('.').filter(Boolean)
  if (tokens.length <= nodesPath.length || !nodesPath.every((segment, index) => tokens[index] === segment)) return null
  return tokens.slice(nodesPath.length)
}

function parseFieldPath(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.startsWith('/')
    ? value
        .slice(1)
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    : value.replaceAll('[]', '').split('.').filter(Boolean)
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

function projectionIssue(code: string, message: string, path: string, nodeId: string): ValidationIssue {
  return {
    code,
    layer: 'semantic',
    severity: 'error',
    blocking: true,
    message,
    document: 'definition',
    path,
    ...(nodeId ? { nodeId } : {}),
  }
}

function pointerPath(path: readonly (string | number)[]): string {
  return `/${path.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
