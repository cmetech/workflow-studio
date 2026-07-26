import { isSeq } from 'yaml'
import type { AuthoringContract, SemanticRuleDescriptor, WorkflowProfile } from '$src/lib/contract/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'
import type { ProjectedEdge, ProjectedNode, WorkflowProjection } from './types'

export interface WorkflowProjectionResult {
  projection: WorkflowProjection
  issues: readonly ValidationIssue[]
}

export function projectWorkflow(
  definitionDocument: ParsedYamlDocument,
  companionDocument: ParsedYamlDocument | null,
  profile: WorkflowProfile,
  contract: AuthoringContract,
): WorkflowProjectionResult {
  const definitionValue = definitionDocument.document.toJS({ maxAliasCount: 1_000 }) as unknown
  const companionValue = companionDocument?.document.toJS({ maxAliasCount: 1_000 }) as unknown
  const definition = isRecord(definitionValue) ? definitionValue : {}
  const companion = isRecord(companionValue) ? companionValue : null
  const issues: ValidationIssue[] = []
  const graphRule = findGraphRule(contract.semantic_rules, profile)

  if (!graphRule) {
    issues.push({
      code: 'dag_rule_missing',
      layer: 'semantic',
      severity: 'error',
      blocking: true,
      message: 'The active authoring contract does not publish its DAG field parameters.',
      document: 'definition',
      path: '/nodes',
    })
    return {
      projection: emptyProjection(definition, companion, profile),
      issues,
    }
  }

  const nodesPath = parseFieldPath(graphRule.parameters.nodes_path)
  const idPath = parseFieldPath(graphRule.parameters.id_field)
  const dependenciesPath = parseFieldPath(graphRule.parameters.dependencies_field)
  if (!nodesPath || !idPath || !dependenciesPath) {
    issues.push({
      code: 'dag_rule_invalid',
      layer: 'semantic',
      severity: 'error',
      blocking: true,
      message: 'The active authoring contract publishes invalid DAG field parameters.',
      document: 'definition',
      path: '/nodes',
    })
    return {
      projection: emptyProjection(definition, companion, profile),
      issues,
    }
  }

  const rawNodes = valueAtPath(definition, nodesPath)
  const nodeValues = Array.isArray(rawNodes) ? rawNodes : []
  const descriptors = contract.node_kinds.filter(
    (descriptor) =>
      descriptor.applicability.profiles.includes(profile) && descriptor.applicability.documents.includes('definition'),
  )
  const kindPaths = descriptors.map((descriptor) => ({
    descriptor,
    relativePath: nodeKindRelativePath(descriptor.field_path, nodesPath),
  }))
  const yamlNodes = definitionDocument.document.getIn(nodesPath, true)
  const projectedNodes: ProjectedNode[] = []

  nodeValues.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) return
    const idValue = valueAtPath(rawNode, idPath)
    const id = typeof idValue === 'string' ? idValue : ''
    const dependenciesValue = valueAtPath(rawNode, dependenciesPath)
    const dependsOn = Array.isArray(dependenciesValue)
      ? dependenciesValue.filter((dependency): dependency is string => typeof dependency === 'string')
      : []
    const matchingKinds = kindPaths.filter(
      (candidate) => candidate.relativePath !== null && hasPath(rawNode, candidate.relativePath),
    )
    const sourcePath = `/${[...nodesPath, String(index)].map(escapePointerSegment).join('/')}`
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
      idPath[0] ?? '',
      dependenciesPath[0] ?? '',
      ...kindPaths.flatMap(({ relativePath }) => (relativePath?.[0] ? [relativePath[0]] : [])),
    ])
    const options = Object.fromEntries(Object.entries(rawNode).filter(([key]) => !excludedKeys.has(key)))

    projectedNodes.push({
      id,
      kind,
      value: deepFreeze(value),
      dependsOn: Object.freeze([...dependsOn]),
      options: deepFreeze(options),
      source: { path: sourcePath, start: sourceRange?.[0] ?? 0, end: sourceRange?.[1] ?? 0 },
    })
  })

  const edges: ProjectedEdge[] = projectedNodes.flatMap((target) =>
    target.dependsOn.map((source) => ({
      id: `dependency:${source}->${target.id}`,
      source,
      target: target.id,
    })),
  )

  return {
    projection: {
      name: typeof definition.name === 'string' ? definition.name : '',
      description: typeof definition.description === 'string' ? definition.description : '',
      profile,
      nodes: deepFreeze(projectedNodes),
      edges: deepFreeze(edges),
      definition: deepFreeze(definition),
      companion: deepFreeze(companion),
    },
    issues,
  }
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

function emptyProjection(
  definition: Record<string, unknown>,
  companion: Record<string, unknown> | null,
  profile: WorkflowProfile,
): WorkflowProjection {
  return {
    name: typeof definition.name === 'string' ? definition.name : '',
    description: typeof definition.description === 'string' ? definition.description : '',
    profile,
    nodes: [],
    edges: [],
    definition: deepFreeze(definition),
    companion: deepFreeze(companion),
  }
}

function nodeKindRelativePath(fieldPath: string, nodesPath: readonly string[]): string[] | null {
  const tokens = fieldPath.replaceAll('[]', '').split('.').filter(Boolean)
  if (tokens.length <= nodesPath.length) return null
  if (!nodesPath.every((segment, index) => tokens[index] === segment)) return null
  return tokens.slice(nodesPath.length)
}

function parseFieldPath(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.startsWith('/')) {
    return value
      .slice(1)
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  }
  return value.replaceAll('[]', '').split('.').filter(Boolean)
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined
    current = Array.isArray(current) ? current[Number(segment)] : current[segment]
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

function escapePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
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
