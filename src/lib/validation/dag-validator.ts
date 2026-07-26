import type { SemanticRuleDescriptor } from '$src/lib/contract/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'

export interface DagValidationResult {
  issues: readonly ValidationIssue[]
  topologicalOrder: readonly string[]
}

export function validateDag(
  projection: WorkflowProjection,
  rules: readonly SemanticRuleDescriptor[],
): DagValidationResult {
  const issues: ValidationIssue[] = []
  const dependencyField = contractDependencyField(rules, projection.profile)
  const nodesPath = contractNodesPath(rules, projection.profile)
  const nodesById = new Map<string, ProjectedNode>()
  const nodeOrder = new Map<string, number>()

  projection.nodes.forEach((node, index) => {
    if (node.id.length === 0) {
      issues.push(semanticIssue('missing_node_id', 'Each workflow node must have an identifier.', node))
      return
    }
    if (nodesById.has(node.id)) {
      issues.push(semanticIssue('duplicate_node_id', `Node identifier "${node.id}" is duplicated.`, node))
      return
    }
    nodesById.set(node.id, node)
    nodeOrder.set(node.id, index)
  })

  const dependencies = new Map<string, string[]>()
  for (const [id, node] of nodesById) {
    const valid: string[] = []
    const seen = new Set<string>()
    node.dependsOn.forEach((dependency) => {
      if (!nodesById.has(dependency)) {
        issues.push(
          semanticIssue(
            'missing_dependency',
            `Node "${id}" depends on missing node "${dependency}".`,
            node,
            dependencyField,
          ),
        )
      } else if (dependency === id) {
        issues.push(semanticIssue('self_dependency', `Node "${id}" cannot depend on itself.`, node, dependencyField))
      } else if (seen.has(dependency)) {
        issues.push(
          semanticIssue(
            'duplicate_dependency',
            `Node "${id}" repeats dependency "${dependency}".`,
            node,
            dependencyField,
          ),
        )
      } else {
        valid.push(dependency)
      }
      seen.add(dependency)
    })
    dependencies.set(id, valid)
  }

  const topologicalOrder = kahnOrder(nodesById, dependencies, nodeOrder)
  if (topologicalOrder.length !== nodesById.size) {
    issues.push({
      code: 'dependency_cycle',
      layer: 'semantic',
      severity: 'error',
      blocking: true,
      message: 'Workflow dependencies must form a directed acyclic graph.',
      document: 'definition',
      path: nodesPath,
    })
    return { issues, topologicalOrder: [] }
  }

  issues.push(...validateReferences(projection, rules, nodesById, dependencies, topologicalOrder))
  return { issues, topologicalOrder }
}

function kahnOrder(
  nodesById: ReadonlyMap<string, ProjectedNode>,
  dependencies: ReadonlyMap<string, readonly string[]>,
  nodeOrder: ReadonlyMap<string, number>,
): string[] {
  const inDegree = new Map<string, number>()
  const dependants = new Map<string, string[]>()
  for (const id of nodesById.keys()) {
    inDegree.set(id, 0)
    dependants.set(id, [])
  }

  for (const [target, sources] of dependencies) {
    inDegree.set(target, sources.length)
    for (const source of sources) dependants.get(source)?.push(target)
  }

  const compareSourceOrder = (left: string, right: string): number =>
    (nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  const ready = [...nodesById.keys()].filter((id) => inDegree.get(id) === 0).sort(compareSourceOrder)
  const order: string[] = []

  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) break
    order.push(id)

    for (const target of dependants.get(id) ?? []) {
      const nextDegree = (inDegree.get(target) ?? 0) - 1
      inDegree.set(target, nextDegree)
      if (nextDegree === 0) {
        ready.push(target)
        ready.sort(compareSourceOrder)
      }
    }
  }

  return order
}

function validateReferences(
  projection: WorkflowProjection,
  rules: readonly SemanticRuleDescriptor[],
  nodesById: ReadonlyMap<string, ProjectedNode>,
  dependencies: ReadonlyMap<string, readonly string[]>,
  topologicalOrder: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ancestors = memoizedAncestors(dependencies, topologicalOrder)
  const seen = new Set<string>()

  for (const rule of rules) {
    if (rule.status === 'deferred' || !ruleAppliesToDefinition(rule, projection.profile)) continue
    const parserResult = referenceParser(rule)
    if (parserResult.kind === 'not-reference') continue
    if (parserResult.kind === 'invalid') {
      issues.push(referenceRuleIssue(rule, parserResult.message))
      continue
    }
    const parser = parserResult.parser

    for (const node of projection.nodes) {
      if (rule.applicability.node_kinds && !rule.applicability.node_kinds.includes(node.kind)) continue

      for (const fieldPath of rule.field_paths) {
        const relativePath = nodeRelativePath(fieldPath)
        if (!relativePath) continue
        const fieldValue = projectedFieldValue(node, relativePath)
        if (fieldValue === undefined) continue

        for (const reference of collectReferences(fieldValue, parser)) {
          const code = !nodesById.has(reference)
            ? 'missing_reference'
            : rule.parameters.require_upstream === false || ancestors.get(node.id)?.has(reference)
              ? null
              : 'non_upstream_reference'
          if (!code) continue

          const field = relativePath.join('.')
          const dedupeKey = `${code}\u0000${node.id}\u0000${field}\u0000${reference}`
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)
          issues.push(
            semanticIssue(
              code,
              code === 'missing_reference'
                ? `Node "${node.id}" references missing node "${reference}".`
                : `Node "${node.id}" may reference only upstream node outputs; "${reference}" is not upstream.`,
              node,
              field,
            ),
          )
        }
      }
    }
  }

  return issues
}

interface ReferenceParser {
  expression: RegExp
  captureGroup: number
}

type ReferenceParserResult =
  { kind: 'not-reference' } | { kind: 'invalid'; message: string } | { kind: 'valid'; parser: ReferenceParser }

function referenceParser(rule: SemanticRuleDescriptor): ReferenceParserResult {
  const hasPattern = Object.hasOwn(rule.parameters, 'pattern')
  const hasSyntax = Object.hasOwn(rule.parameters, 'syntax')
  if (!hasPattern && !hasSyntax) return { kind: 'not-reference' }

  const syntax = rule.parameters.syntax
  if (hasSyntax && syntax !== '$ID.output(.path)*') {
    return { kind: 'invalid', message: `Reference rule "${rule.id}" declares an unsupported syntax.` }
  }

  const pattern = rule.parameters.pattern
  if (hasPattern) {
    if (typeof pattern !== 'string') {
      return { kind: 'invalid', message: `Reference rule "${rule.id}" must declare a string pattern.` }
    }
    const captureGroup = rule.parameters.node_id_capture_group
    if (
      captureGroup !== undefined &&
      (typeof captureGroup !== 'number' || !Number.isInteger(captureGroup) || captureGroup < 1)
    ) {
      return { kind: 'invalid', message: `Reference rule "${rule.id}" declares an invalid capture group.` }
    }
    try {
      return {
        kind: 'valid',
        parser: {
          expression: new RegExp(pattern, 'g'),
          captureGroup: typeof captureGroup === 'number' ? captureGroup : 1,
        },
      }
    } catch {
      return { kind: 'invalid', message: `Reference rule "${rule.id}" declares an invalid pattern.` }
    }
  }

  if (syntax === '$ID.output(.path)*') {
    return {
      kind: 'valid',
      parser: {
        expression: /\$([A-Za-z_][A-Za-z0-9_-]*)\.output(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/g,
        captureGroup: 1,
      },
    }
  }

  return { kind: 'not-reference' }
}

function referenceRuleIssue(rule: SemanticRuleDescriptor, message: string): ValidationIssue {
  return {
    code: 'reference_rule_invalid',
    layer: 'semantic',
    severity: 'error',
    blocking: true,
    message,
    document: 'definition',
    path: contractFieldPath(rule.field_paths[0]),
    documentationId: rule.id,
  }
}

function contractFieldPath(fieldPath: string | undefined): string {
  if (!fieldPath) return '/'
  if (fieldPath.startsWith('/')) return fieldPath
  return `/${fieldPath
    .replaceAll('[]', '')
    .replaceAll('[*]', '')
    .split('.')
    .filter(Boolean)
    .map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`
}

function collectReferences(value: unknown, parser: ReferenceParser): string[] {
  const references: string[] = []
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      parser.expression.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = parser.expression.exec(candidate)) !== null) {
        const id = match[parser.captureGroup]
        if (id) references.push(id)
        if (match[0].length === 0) parser.expression.lastIndex += 1
      }
    } else if (Array.isArray(candidate)) {
      candidate.forEach(visit)
    } else if (isRecord(candidate)) {
      Object.values(candidate).forEach(visit)
    }
  }
  visit(value)
  return references
}

function memoizedAncestors(
  dependencies: ReadonlyMap<string, readonly string[]>,
  topologicalOrder: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const ancestors = new Map<string, Set<string>>()
  for (const id of topologicalOrder) {
    const values = new Set<string>()
    for (const dependency of dependencies.get(id) ?? []) {
      values.add(dependency)
      for (const ancestor of ancestors.get(dependency) ?? []) values.add(ancestor)
    }
    ancestors.set(id, values)
  }
  return ancestors
}

function nodeRelativePath(fieldPath: string): string[] | null {
  const normalized = fieldPath.replaceAll('[*]', '[]')
  const marker = '[]'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex < 0) return null
  const suffix = normalized.slice(markerIndex + marker.length).replace(/^\./, '')
  return suffix.length > 0 ? suffix.split('.') : []
}

function contractDependencyField(
  rules: readonly SemanticRuleDescriptor[],
  profile: WorkflowProjection['profile'],
): string | undefined {
  for (const rule of rules) {
    if (!ruleAppliesToDefinition(rule, profile)) continue
    const value = rule.parameters.dependencies_field
    if (typeof value !== 'string' || value.length === 0) continue
    return value.startsWith('/') ? value.split('/').filter(Boolean).at(-1) : value.split('.').at(-1)
  }
  return undefined
}

function contractNodesPath(rules: readonly SemanticRuleDescriptor[], profile: WorkflowProjection['profile']): string {
  for (const rule of rules) {
    if (!ruleAppliesToDefinition(rule, profile)) continue
    const value = rule.parameters.nodes_path
    if (typeof value !== 'string' || value.length === 0) continue
    if (value.startsWith('/')) return value
    return `/${value
      .replaceAll('[]', '')
      .split('.')
      .filter(Boolean)
      .map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1'))
      .join('/')}`
  }
  return '/'
}

function ruleAppliesToDefinition(rule: SemanticRuleDescriptor, profile: WorkflowProjection['profile']): boolean {
  return rule.applicability.profiles.includes(profile) && rule.applicability.documents.includes('definition')
}

function projectedFieldValue(node: ProjectedNode, relativePath: readonly string[]): unknown {
  if (relativePath.length === 0) return undefined
  const [first, ...rest] = relativePath
  let value = first === node.kind ? node.value : first === undefined ? undefined : node.options[first]
  for (const segment of rest) {
    if (!isRecord(value)) return undefined
    value = value[segment]
  }
  return value
}

function semanticIssue(code: string, message: string, node: ProjectedNode, field?: string): ValidationIssue {
  const path = field ? `${node.source.path}/${field.replaceAll('.', '/')}` : node.source.path
  return {
    code,
    layer: 'semantic',
    severity: 'error',
    blocking: true,
    message,
    document: 'definition',
    path,
    ...(node.id ? { nodeId: node.id } : {}),
    ...(field ? { field } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
