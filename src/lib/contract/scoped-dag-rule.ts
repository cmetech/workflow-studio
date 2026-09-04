import type { AuthoringContract, SemanticRuleDescriptor } from './types'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'

export interface ScopedDagCapabilities {
  readonly groupKind: 'loop_group'
  readonly bodyPath: readonly string[]
  readonly nodeIdField: string
  readonly dependsOnField: string
  readonly allowedNodeKinds: readonly string[]
  readonly forbiddenNodeKinds: readonly string[]
  readonly primarySink: 'first-terminal-in-definition-order'
  readonly previousIteration: { readonly prefix: '$LOOP_PREV.' }
  readonly topology: Readonly<Record<string, unknown>>
  readonly references: Readonly<Record<string, unknown>>
  readonly workProduct: Readonly<Record<string, unknown>>
}

export function requiresScopedDagCapabilities(contract: AuthoringContract): boolean {
  return contract.node_kinds.some((nodeKind) => nodeKind.id === 'loop_group')
}

export function readScopedDagCapabilities(contract: AuthoringContract): ScopedDagCapabilities {
  const rules = new Map(contract.semantic_rules.map((rule) => [rule.id, rule]))
  const topology = requireRule(rules.get('scoped-dag-topology-v1'), 'scoped DAG topology capability')
  const references = requireRule(rules.get('scoped-output-reference-v1'), 'scoped output reference capability')
  const workProduct = requireRule(rules.get('loop-group-work-product-v1'), 'loop-group work-product capability')
  if (
    !sameGeneratedRule(topology, 'scoped-dag-topology-v1') ||
    !sameGeneratedRule(references, 'scoped-output-reference-v1') ||
    !sameGeneratedRule(workProduct, 'loop-group-work-product-v1')
  )
    throw new Error('The scoped DAG semantic capability is unsupported by this Studio reader.')
  const parameters = topology.parameters
  if (
    parameters.kind !== 'scoped-dag-topology-v1' ||
    parameters.group_kind !== 'loop_group' ||
    !stringArray(parameters.body_path) ||
    typeof parameters.node_id_field !== 'string' ||
    typeof parameters.depends_on_field !== 'string' ||
    !stringArray(parameters.allowed_node_kinds) ||
    !stringArray(parameters.forbidden_node_kinds) ||
    parameters.primary_sink !== 'first-terminal-in-definition-order'
  )
    throw new Error('The scoped DAG topology capability is unsupported by this Studio reader.')
  const previous = record(references.parameters.previous_iteration)
  if (references.parameters.kind !== 'scoped-output-reference-v1' || !previous || previous.prefix !== '$LOOP_PREV.')
    throw new Error('The scoped output reference capability is unsupported by this Studio reader.')
  if (workProduct.parameters.kind !== 'loop-group-work-product-v1')
    throw new Error('The loop-group work-product capability is unsupported by this Studio reader.')
  return Object.freeze({
    groupKind: 'loop_group',
    bodyPath: parameters.body_path,
    nodeIdField: parameters.node_id_field,
    dependsOnField: parameters.depends_on_field,
    allowedNodeKinds: parameters.allowed_node_kinds,
    forbiddenNodeKinds: parameters.forbidden_node_kinds,
    primarySink: 'first-terminal-in-definition-order',
    previousIteration: Object.freeze({ prefix: '$LOOP_PREV.' }),
    topology: parameters,
    references: references.parameters,
    workProduct: workProduct.parameters,
  })
}

const generatedScopedRules = new Map(
  (JSON.parse(archonContractText) as { semantic_rules: readonly Record<string, unknown>[] }).semantic_rules
    .filter((rule) => typeof rule.id === 'string')
    .map((rule) => [
      rule.id as string,
      stableJson(Object.fromEntries(Object.entries(rule).filter(([key]) => key !== 'id'))),
    ]),
)

function sameGeneratedRule(rule: SemanticRuleDescriptor, id: string): boolean {
  return generatedScopedRules.get(id) === stableJson(rule.parameters)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(',')}}`
}

function requireRule(rule: SemanticRuleDescriptor | undefined, name: string): SemanticRuleDescriptor {
  if (!rule) throw new Error(`Missing ${name}.`)
  return rule
}
function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
