import type { AuthoringContract, ContractDocumentKind, SemanticRuleDescriptor, WorkflowProfile } from './types'
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
  readonly topology: Readonly<Record<string, unknown>> & {
    readonly max_depth: number
    readonly max_nodes: number
    readonly max_edges: number
    readonly min_nodes: number
    readonly validation_codes: Readonly<Record<string, string>> & {
      readonly capacity: string
      readonly nesting: string
      readonly topology: string
      readonly visibility: string
      readonly work_product: string
    }
    readonly forbidden_group_fields: readonly string[]
    readonly group_fields: readonly string[]
    readonly required_group_fields: readonly string[]
  }
  readonly references: Readonly<Record<string, unknown>>
  readonly workProduct: Readonly<Record<string, unknown>> & {
    readonly limit: number
    readonly group_iterations_path: readonly string[]
    readonly ordinary_loop_multiplier_path: readonly string[]
    readonly retry_max_attempts_path: readonly string[]
    readonly approval_max_attempts_path: readonly string[]
    readonly command_prompt_default_retries: number
    readonly other_default_retries: number
    readonly approval_default_max_attempts: number
    readonly ordinary_loop_default_multiplier: number
  }
  readonly referenceSemantics: ScopedReferenceSemantics
  readonly workProductSemantics: ScopedWorkProductSemantics
}

export interface ScopedReferenceSemantics {
  readonly syntaxRule: string
  readonly interpolationFields: readonly Readonly<Record<string, unknown>>[]
  readonly valueDiscriminators: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly companionNodePaths: {
    readonly fieldPaths: readonly string[]
    readonly format: string
    readonly validationCode: string
  }
  readonly groupUntilBash: Readonly<Record<string, unknown>>
  readonly structuredPathConstraint: Readonly<Record<string, unknown>>
  readonly producerSchemaResolution: Readonly<Record<string, unknown>>
  readonly diagnosticTable: {
    readonly columns: readonly string[]
    readonly rows: readonly (readonly unknown[])[]
    readonly hermesCodes: Readonly<Record<string, string>>
  }
  readonly diagnosticCodes: {
    readonly missingDependency: string
    readonly unknownProducer: string
    readonly unknownCompanionNode: string
    readonly producerSchemaRequired: string
    readonly structuredPathImpossible: string
  }
}

export interface ScopedWorkProductSemantics {
  readonly expressionFormat: string
  readonly expressions: Readonly<Record<string, readonly unknown[]>>
  readonly retryPrecedence: readonly string[]
  readonly retrySelectorPredicate: Readonly<Record<string, unknown>>
}

export function requiresScopedDagCapabilities(
  contract: AuthoringContract,
  profile: WorkflowProfile,
  document: ContractDocumentKind,
): boolean {
  return contract.node_kinds.some(
    (nodeKind) =>
      nodeKind.id === 'loop_group' &&
      nodeKind.status === 'supported' &&
      nodeKind.applicability.profiles.includes(profile) &&
      nodeKind.applicability.documents.includes(document),
  )
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
  const definitions = scopedSemanticDefinitions(contract, parameters.group_kind)
  const referenceDefinition = record(definitions?.[String(references.parameters.kind)])
  const workDefinition = record(definitions?.[String(workProduct.parameters.kind)])
  if (
    !referenceDefinition ||
    !workDefinition ||
    !sameGeneratedDefinition(String(references.parameters.kind), referenceDefinition) ||
    !sameGeneratedDefinition(String(workProduct.parameters.kind), workDefinition)
  )
    throw new Error('The generated nested scoped semantics are unsupported by this Studio reader.')
  const referenceSemantics = readReferenceSemantics(referenceDefinition, references.parameters)
  const workProductSemantics = readWorkProductSemantics(workDefinition)
  if (!referenceSemantics || !workProductSemantics || !validTypedParameters(parameters, workProduct.parameters))
    throw new Error('The generated scoped semantic capability is unsupported by this Studio reader.')
  return Object.freeze({
    groupKind: 'loop_group',
    bodyPath: parameters.body_path,
    nodeIdField: parameters.node_id_field,
    dependsOnField: parameters.depends_on_field,
    allowedNodeKinds: parameters.allowed_node_kinds,
    forbiddenNodeKinds: parameters.forbidden_node_kinds,
    primarySink: 'first-terminal-in-definition-order',
    previousIteration: Object.freeze({ prefix: '$LOOP_PREV.' }),
    topology: parameters as ScopedDagCapabilities['topology'],
    references: references.parameters,
    workProduct: workProduct.parameters as ScopedDagCapabilities['workProduct'],
    referenceSemantics,
    workProductSemantics,
  })
}

function validTypedParameters(topology: Record<string, unknown>, work: Record<string, unknown>): boolean {
  const codes = record(topology.validation_codes)
  return (
    positiveInteger(topology.max_depth) &&
    positiveInteger(topology.max_nodes) &&
    positiveInteger(topology.max_edges) &&
    positiveInteger(topology.min_nodes) &&
    stringRecord(codes) &&
    typeof codes?.capacity === 'string' &&
    typeof codes.nesting === 'string' &&
    typeof codes.topology === 'string' &&
    typeof codes.visibility === 'string' &&
    typeof codes.work_product === 'string' &&
    stringArray(topology.forbidden_group_fields) &&
    stringArray(topology.group_fields) &&
    stringArray(topology.required_group_fields) &&
    positiveInteger(work.limit) &&
    stringArray(work.group_iterations_path) &&
    stringArray(work.ordinary_loop_multiplier_path) &&
    stringArray(work.retry_max_attempts_path) &&
    stringArray(work.approval_max_attempts_path) &&
    nonnegativeInteger(work.command_prompt_default_retries) &&
    nonnegativeInteger(work.other_default_retries) &&
    nonnegativeInteger(work.approval_default_max_attempts) &&
    positiveInteger(work.ordinary_loop_default_multiplier)
  )
}

function readReferenceSemantics(
  definition: Readonly<Record<string, unknown>>,
  rule: Readonly<Record<string, unknown>>,
): ScopedReferenceSemantics | null {
  const companion = record(definition.companion_node_paths)
  const interpolation = record(rule.interpolation_surface_v1)
  const discriminators = record(interpolation?.value_discriminators_v1)
  const structured = record(definition.structured_path_constraint_v1)
  const producerSchemaResolution = record(structured?.producer_schema_resolution_v1)
  const table = record(structured?.diagnostic_table)
  const hermesCodes = record(table?.codes)
  const columns = table?.cols
  const rows = table?.rows
  const syntaxRule = structured?.syntax_rule
  if (
    !companion ||
    !stringArray(companion.field_paths) ||
    typeof companion.format !== 'string' ||
    typeof companion.validation_code !== 'string' ||
    !interpolation ||
    !Array.isArray(interpolation.fields) ||
    !interpolation.fields.every((field) => record(field) !== null) ||
    !discriminators ||
    !Object.values(discriminators).every((value) => record(value) !== null) ||
    !structured ||
    !producerSchemaResolution ||
    !table ||
    !stringArray(columns) ||
    !Array.isArray(rows) ||
    !rows.every(Array.isArray) ||
    !stringRecord(hermesCodes) ||
    typeof syntaxRule !== 'string'
  )
    return null
  const code = (when: string): string | null => {
    const whenColumn = columns.indexOf('when')
    const semanticColumn = columns.indexOf('semantic')
    const row = rows.find((candidate) => candidate[whenColumn] === when)
    const value = row?.[semanticColumn]
    return typeof value === 'string' ? value : null
  }
  const missingDependency = code('dep')
  const unknownProducer = code('prev')
  const unknownCompanionNode = code('companion')
  const producerSchemaRequired = code('no_schema')
  const structuredPathImpossible = code('impossible')
  if (
    !missingDependency ||
    !unknownProducer ||
    !unknownCompanionNode ||
    !producerSchemaRequired ||
    !structuredPathImpossible
  )
    return null
  return Object.freeze({
    syntaxRule,
    interpolationFields: interpolation.fields as readonly Readonly<Record<string, unknown>>[],
    valueDiscriminators: discriminators as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
    companionNodePaths: Object.freeze({
      fieldPaths: companion.field_paths,
      format: companion.format,
      validationCode: companion.validation_code,
    }),
    groupUntilBash: Object.freeze({ ...(record(definition.group_until_bash) ?? {}) }),
    structuredPathConstraint: structured,
    producerSchemaResolution,
    diagnosticTable: Object.freeze({
      columns,
      rows: rows as readonly (readonly unknown[])[],
      hermesCodes: hermesCodes as Readonly<Record<string, string>>,
    }),
    diagnosticCodes: Object.freeze({
      missingDependency,
      unknownProducer,
      unknownCompanionNode,
      producerSchemaRequired,
      structuredPathImpossible,
    }),
  })
}

function readWorkProductSemantics(definition: Readonly<Record<string, unknown>>): ScopedWorkProductSemantics | null {
  const expressions = record(definition.expressions)
  const predicate = record(definition.retry_selector_predicate)
  if (
    typeof definition.expression_format !== 'string' ||
    !expressions ||
    !Object.values(expressions).every(Array.isArray) ||
    typeof definition.retry_precedence !== 'string' ||
    !predicate
  )
    return null
  return Object.freeze({
    expressionFormat: definition.expression_format,
    expressions: expressions as Readonly<Record<string, readonly unknown[]>>,
    retryPrecedence: Object.freeze(definition.retry_precedence.split('>')),
    retrySelectorPredicate: predicate,
  })
}

function scopedSemanticDefinitions(
  contract: AuthoringContract,
  groupKind: unknown,
): Readonly<Record<string, unknown>> | null {
  if (typeof groupKind !== 'string') return null
  const descriptor = contract.node_kinds.find((candidate) => candidate.id === groupKind)
  return record(descriptor?.extensions?.semantic_definitions)
}

const generatedScopedRules = new Map(
  (JSON.parse(archonContractText) as { semantic_rules: readonly Record<string, unknown>[] }).semantic_rules
    .filter((rule) => typeof rule.id === 'string')
    .map((rule) => [
      rule.id as string,
      stableJson(Object.fromEntries(Object.entries(rule).filter(([key]) => key !== 'id'))),
    ]),
)

const generatedScopedDefinitions = (() => {
  const raw = JSON.parse(archonContractText) as { node_kinds: readonly Record<string, unknown>[] }
  const descriptor = raw.node_kinds.find((candidate) => candidate.id === 'loop_group')
  const definitions = record(descriptor?.semantic_definitions)
  return new Map(Object.entries(definitions ?? {}).map(([id, value]) => [id, stableJson(value)]))
})()

function sameGeneratedRule(rule: SemanticRuleDescriptor, id: string): boolean {
  return generatedScopedRules.get(id) === stableJson(rule.parameters)
}

function sameGeneratedDefinition(id: string, definition: Readonly<Record<string, unknown>>): boolean {
  return generatedScopedDefinitions.get(id) === stableJson(definition)
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
function stringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    record(value) && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string'),
  )
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
