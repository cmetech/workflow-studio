import type { AuthoringContract, ContractItemStatus, FieldDescriptor } from '$src/lib/contract/types'
import ArrayField from '$src/features/inspector/widgets/ArrayField.svelte'
import BooleanField from '$src/features/inspector/widgets/BooleanField.svelte'
import CodeField from '$src/features/inspector/widgets/CodeField.svelte'
import EnumField from '$src/features/inspector/widgets/EnumField.svelte'
import JsonSchemaField from '$src/features/inspector/widgets/JsonSchemaField.svelte'
import MapField from '$src/features/inspector/widgets/MapField.svelte'
import NumberField from '$src/features/inspector/widgets/NumberField.svelte'
import ObjectField from '$src/features/inspector/widgets/ObjectField.svelte'
import TextAreaField from '$src/features/inspector/widgets/TextAreaField.svelte'
import TextField from '$src/features/inspector/widgets/TextField.svelte'
import type { FormConstraints, FormCoverageIssue, FormField, WidgetDefinition, WidgetResolution } from './types'

const definitions: readonly WidgetDefinition[] = [
  { id: 'text', component: TextField, accepts: stringSchema },
  { id: 'textarea', component: TextAreaField, accepts: stringSchema },
  { id: 'code', component: CodeField, accepts: stringSchema },
  { id: 'number', component: NumberField, accepts: numberSchema },
  {
    id: 'boolean',
    component: BooleanField,
    accepts: (field) => schemaType(field.schema) === undefined || schemaType(field.schema) === 'boolean',
  },
  {
    id: 'enum',
    component: EnumField,
    accepts: (field) => Array.isArray(field.constraints.enum) || Object.hasOwn(field.schema, 'const'),
  },
  {
    id: 'array',
    component: ArrayField,
    accepts: (field) => schemaType(field.schema) === undefined || schemaType(field.schema) === 'array',
  },
  { id: 'map', component: MapField, accepts: objectSchema },
  { id: 'object', component: ObjectField, accepts: objectSchema },
  { id: 'json-schema', component: JsonSchemaField, accepts: jsonValueSchema },
]

export const widgetRegistry: ReadonlyMap<string, WidgetDefinition> = new Map(
  definitions.map((definition) => [definition.id, definition]),
)

export function resolveWidget(field: FieldDescriptor | FormField): WidgetResolution {
  const definition = widgetRegistry.get(field.widget)
  if (!definition) {
    return {
      ok: false,
      code: 'contract_reader_unsupported_widget',
      message: `Workflow Studio does not support the contract widget "${field.widget}".`,
    }
  }
  return { ok: true, definition }
}

export function collectContractFields(contract: AuthoringContract): readonly FormField[] {
  const fields: FormField[] = []
  collectDocumentFields(contract, contract.definition_schema, 'definition', '', [], fields, true)
  collectDocumentFields(contract, contract.sidecar_schema, 'companion', 'sidecar', [], fields, false)

  for (const nodeKind of contract.node_kinds) {
    if (!nodeKind.applicability.profiles.includes(contract.profile)) continue
    for (const descriptor of nodeKind.fields) {
      const schema = schemaAtFieldPath(contract.definition_schema, descriptor.field_path)
      fields.push(formFieldFromDescriptor(contract, descriptor, schema ?? {}, nodeKind.id))
    }
  }

  return Object.freeze(
    fields.sort(
      (left, right) =>
        left.document.localeCompare(right.document) ||
        left.section.localeCompare(right.section) ||
        left.order - right.order ||
        left.id.localeCompare(right.id),
    ),
  )
}

export function fieldsForNode(contract: AuthoringContract, nodeKind: string): readonly FormField[] {
  return collectContractFields(contract).filter(
    (field) => field.document === 'definition' && field.nodeKinds?.includes(nodeKind),
  )
}

export function validateContractFormCoverage(contract: AuthoringContract): readonly FormCoverageIssue[] {
  const issues: FormCoverageIssue[] = []
  const fields = collectContractFields(contract)

  for (const field of fields) {
    const resolution = resolveWidget(field)
    if (!resolution.ok) {
      issues.push({ code: 'field_widget_unsupported', fieldPath: field.fieldPath, message: resolution.message })
    } else if (!resolution.definition.accepts(field)) {
      issues.push({
        code: 'field_widget_incompatible',
        fieldPath: field.fieldPath,
        message: `${field.widget} is incompatible with ${field.fieldPath}.`,
      })
    }
    if (!field.description.trim() || field.examples.length === 0) {
      issues.push({
        code: 'field_documentation_missing',
        fieldPath: field.fieldPath,
        message: `${field.fieldPath} must include a description and example.`,
      })
    }
    if (!['General', 'Execution', 'Advanced'].includes(normalizeSection(field.section))) {
      issues.push({ code: 'field_section_invalid', fieldPath: field.fieldPath, message: 'Unknown inspector section.' })
    }
    if (!Number.isFinite(field.order) || field.order < 0) {
      issues.push({
        code: 'field_order_invalid',
        fieldPath: field.fieldPath,
        message: 'Field order must be nonnegative.',
      })
    }
    if (Object.keys(field.schema).length === 0) {
      issues.push({ code: 'field_schema_missing', fieldPath: field.fieldPath, message: 'Field schema is missing.' })
    }
  }

  const scopes = new Map<string, FormField[]>()
  for (const field of fields) {
    const scope = `${field.document}\0${(field.nodeKinds ?? []).join(',')}`
    const values = scopes.get(scope) ?? []
    values.push(field)
    scopes.set(scope, values)
  }
  for (const scoped of scopes.values()) {
    const paths = new Map<string, FormField>()
    const orders = new Map<string, FormField>()
    for (const field of scoped) {
      const normalizedPath = field.fieldPath.replaceAll('[*]', '[]')
      if (paths.has(normalizedPath)) {
        issues.push({
          code: 'field_path_duplicate',
          fieldPath: field.fieldPath,
          message: `${field.fieldPath} is duplicated in one applicability scope.`,
        })
      } else paths.set(normalizedPath, field)
      const orderKey = `${normalizeSection(field.section)}\0${field.order}`
      if (orders.has(orderKey)) {
        issues.push({
          code: 'field_order_duplicate',
          fieldPath: field.fieldPath,
          message: `${field.section} order ${field.order} is duplicated in one applicability scope.`,
        })
      } else orders.set(orderKey, field)
    }
  }
  return issues
}

function collectDocumentFields(
  contract: AuthoringContract,
  root: Record<string, unknown>,
  document: FormField['document'],
  pathPrefix: string,
  pathTemplate: readonly (string | number)[],
  fields: FormField[],
  skipNodes: boolean,
): void {
  const properties = record(root.properties)
  const required = new Set(
    Array.isArray(root.required) ? root.required.filter((item): item is string => typeof item === 'string') : [],
  )
  for (const [name, unresolved] of Object.entries(properties ?? {})) {
    if (skipNodes && name === 'nodes') continue
    const schema = resolveSchema(unresolved, root)
    if (!schema) continue
    const fieldPath = pathPrefix ? `${pathPrefix}.${name}` : name
    const template = [...pathTemplate, name]
    if (typeof schema['x-hermes-widget'] === 'string') {
      fields.push(formFieldFromSchema(contract, schema, document, fieldPath, template, required.has(name)))
    }
    collectDocumentChildren(contract, schema, root, document, fieldPath, template, fields)
  }
}

function collectDocumentChildren(
  contract: AuthoringContract,
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  document: FormField['document'],
  fieldPath: string,
  pathTemplate: readonly (string | number)[],
  fields: FormField[],
): void {
  const objectSchemaValue = schemaType(schema) === 'array' ? resolveSchema(schema.items, root) : schema
  if (!objectSchemaValue) return
  const nextPath = schemaType(schema) === 'array' ? `${fieldPath}[]` : fieldPath
  const nextTemplate = schemaType(schema) === 'array' ? [...pathTemplate, 0] : pathTemplate
  const properties = record(objectSchemaValue.properties)
  const required = new Set(
    Array.isArray(objectSchemaValue.required)
      ? objectSchemaValue.required.filter((item): item is string => typeof item === 'string')
      : [],
  )
  for (const [name, unresolved] of Object.entries(properties ?? {})) {
    const child = resolveSchema(unresolved, root)
    if (!child) continue
    const childPath = `${nextPath}.${name}`
    const childTemplate = [...nextTemplate, name]
    if (typeof child['x-hermes-widget'] === 'string') {
      fields.push(formFieldFromSchema(contract, child, document, childPath, childTemplate, required.has(name)))
    }
    collectDocumentChildren(contract, child, root, document, childPath, childTemplate, fields)
  }
}

function formFieldFromDescriptor(
  contract: AuthoringContract,
  descriptor: FieldDescriptor,
  schema: Record<string, unknown>,
  nodeKind: string,
): FormField {
  const required = schemaRequiredAtFieldPath(contract.definition_schema, descriptor.field_path)
  return {
    id: descriptor.id,
    label: descriptor.label,
    description: descriptor.description,
    fieldPath: descriptor.field_path,
    pathTemplate: descriptorPathTemplate(descriptor.field_path),
    document: 'definition',
    nodeKinds: [nodeKind],
    widget: descriptor.widget,
    section: normalizeSection(descriptor.section),
    order: descriptor.order,
    status: descriptor.status,
    examples: descriptor.examples,
    schema,
    required,
    hasDefault: Object.hasOwn(schema, 'default'),
    ...(Object.hasOwn(schema, 'default') ? { defaultValue: structuredClone(schema.default) } : {}),
    ...(typeof schema['x-hermes-unit'] === 'string' ? { unit: schema['x-hermes-unit'] } : {}),
    ...(typeof schema['x-hermes-compatibility-code'] === 'string'
      ? { compatibilityCode: schema['x-hermes-compatibility-code'] }
      : {}),
    constraints: schemaConstraints(schema),
  }
}

function formFieldFromSchema(
  contract: AuthoringContract,
  schema: Record<string, unknown>,
  document: FormField['document'],
  fieldPath: string,
  pathTemplate: readonly (string | number)[],
  required: boolean,
): FormField {
  const compatibilityCode =
    typeof schema['x-hermes-compatibility-code'] === 'string' ? schema['x-hermes-compatibility-code'] : undefined
  const catalogStatus = compatibilityCode ? contract.compatibility_codes[compatibilityCode]?.status : undefined
  const annotationStatus = schema['x-hermes-status']
  const status: ContractItemStatus =
    catalogStatus ??
    (annotationStatus === 'deferred' || annotationStatus === 'deprecated' ? annotationStatus : 'supported')
  return {
    id: `${document}.${fieldPath}`,
    label: typeof schema.title === 'string' ? schema.title : humanize(fieldPath.split('.').at(-1) ?? fieldPath),
    description: typeof schema.description === 'string' ? schema.description : '',
    fieldPath,
    pathTemplate,
    document,
    widget: String(schema['x-hermes-widget']),
    section: normalizeSection(String(schema['x-hermes-section'] ?? 'Advanced')),
    order: Number(schema['x-hermes-order']),
    status,
    examples: Array.isArray(schema.examples) ? schema.examples : [],
    schema,
    required,
    hasDefault: Object.hasOwn(schema, 'default'),
    ...(Object.hasOwn(schema, 'default') ? { defaultValue: structuredClone(schema.default) } : {}),
    ...(typeof schema['x-hermes-unit'] === 'string' ? { unit: schema['x-hermes-unit'] } : {}),
    ...(compatibilityCode ? { compatibilityCode } : {}),
    constraints: schemaConstraints(schema),
  }
}

function schemaAtFieldPath(root: Record<string, unknown>, path: string): Record<string, unknown> | null {
  let schema: Record<string, unknown> | null = root
  for (const token of path.replaceAll('[*]', '[]').split('.').filter(Boolean)) {
    const sequence = token.endsWith('[]')
    const name = sequence ? token.slice(0, -2) : token
    schema = schema ? childSchema(schema, name, root) : null
    if (sequence && schema) schema = resolveSchema(schema.items, root)
    if (!schema) return null
  }
  return schema
}

function childSchema(
  parent: Record<string, unknown>,
  name: string,
  root: Record<string, unknown>,
): Record<string, unknown> | null {
  const resolved = resolveSchema(parent, root)
  if (!resolved) return null
  if (name === '*') {
    const additional = resolveSchema(resolved.additionalProperties, root)
    if (additional) return additional
    for (const candidate of Object.values(record(resolved.patternProperties) ?? {})) {
      const patternValue = resolveSchema(candidate, root)
      if (patternValue) return patternValue
    }
    for (const candidate of Object.values(record(resolved.properties) ?? {})) {
      const namedValue = resolveSchema(candidate, root)
      if (namedValue) return namedValue
    }
  } else {
    const direct = resolveSchema(record(resolved.properties)?.[name], root)
    if (direct) return direct
  }
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = resolved[keyword]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      const candidate = resolveSchema(branch, root)
      if (!candidate) continue
      const child = childSchema(candidate, name, root)
      if (child) return child
    }
  }
  return null
}

function schemaRequiredAtFieldPath(root: Record<string, unknown>, path: string): boolean {
  const tokens = path.replaceAll('[*]', '[]').split('.').filter(Boolean)
  const leaf = tokens.at(-1)?.replace('[]', '')
  if (!leaf) return false
  const parentPath = tokens.slice(0, -1).join('.')
  const parent = parentPath ? schemaAtFieldPath(root, parentPath) : root
  return Array.isArray(parent?.required) && parent.required.includes(leaf)
}

function descriptorPathTemplate(path: string): readonly (string | number)[] {
  return path
    .replaceAll('[*]', '[]')
    .split('.')
    .flatMap((token) => (token.endsWith('[]') ? [token.slice(0, -2), '$node'] : [token]))
}

function schemaConstraints(schema: Record<string, unknown>): FormConstraints {
  return {
    ...(typeof schema.minimum === 'number' ? { minimum: schema.minimum } : {}),
    ...(typeof schema.maximum === 'number' ? { maximum: schema.maximum } : {}),
    ...(typeof schema.minLength === 'number' ? { minLength: schema.minLength } : {}),
    ...(typeof schema.maxLength === 'number' ? { maxLength: schema.maxLength } : {}),
    ...(typeof schema.pattern === 'string' ? { pattern: schema.pattern } : {}),
    ...(Array.isArray(schema.enum)
      ? { enum: schema.enum }
      : Object.hasOwn(schema, 'const')
        ? { enum: [schema.const] }
        : {}),
  }
}

function resolveSchema(value: unknown, root: Record<string, unknown>): Record<string, unknown> | null {
  const schema = record(value)
  if (!schema) return null
  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return schema
  let current: unknown = root
  for (const token of schema.$ref
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    current = record(current)?.[token]
  }
  return record(current)
}

function schemaType(schema: Readonly<Record<string, unknown>>): unknown {
  return Array.isArray(schema.type) ? schema.type.find((value) => value !== 'null') : schema.type
}

function stringSchema(field: FormField): boolean {
  return schemaType(field.schema) === undefined || schemaType(field.schema) === 'string'
}

function numberSchema(field: FormField): boolean {
  const type = schemaType(field.schema)
  return type === undefined || type === 'number' || type === 'integer'
}

function objectSchema(field: FormField): boolean {
  return (
    schemaType(field.schema) === 'object' ||
    schemaType(field.schema) === undefined ||
    field.schema.additionalProperties !== undefined ||
    Array.isArray(field.schema.oneOf) ||
    Array.isArray(field.schema.anyOf)
  )
}

function jsonValueSchema(field: FormField): boolean {
  return Object.keys(field.schema).length > 0
}

function normalizeSection(section: string): string {
  const normalized = section.trim().toLowerCase()
  return normalized === 'general'
    ? 'General'
    : normalized === 'execution'
      ? 'Execution'
      : normalized === 'advanced'
        ? 'Advanced'
        : section
}

function humanize(value: string): string {
  const text = value.replaceAll('_', ' ').replaceAll(/([a-z])([A-Z])/g, '$1 $2')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
