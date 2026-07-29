export type StructuredDraft = ScalarDraft | ArrayDraft | ObjectDraft | UnionDraft

export interface ScalarDraft {
  readonly kind: 'scalar'
  readonly schema: Readonly<Record<string, unknown>>
  readonly value: unknown
}

export interface ArrayDraft {
  readonly kind: 'array'
  readonly schema: Readonly<Record<string, unknown>>
  readonly items: readonly StructuredDraft[]
}

export interface ObjectEntryDraft {
  readonly id: string
  readonly key: string
  readonly dynamic: boolean
  readonly required: boolean
  readonly schema: Readonly<Record<string, unknown>>
  readonly value: StructuredDraft
}

export interface ObjectDraft {
  readonly kind: 'object'
  readonly schema: Readonly<Record<string, unknown>>
  readonly entries: readonly ObjectEntryDraft[]
}

export interface UnionDraft {
  readonly kind: 'union'
  readonly schema: Readonly<Record<string, unknown>>
  readonly branches: readonly Readonly<Record<string, unknown>>[]
  readonly activeIndex: number
  readonly value: StructuredDraft
}

export function createStructuredDraft(schema: Readonly<Record<string, unknown>>, value: unknown): StructuredDraft {
  const branches = editableBranches(schema)
  if (branches) {
    const activeIndex = matchingBranchIndex(branches, value)
    const activeSchema = branches[activeIndex] ?? branches[0] ?? {}
    return {
      kind: 'union',
      schema,
      branches,
      activeIndex,
      value: createStructuredDraft(
        activeSchema,
        valueMatchesSchema(value, activeSchema) ? value : defaultValue(activeSchema),
      ),
    }
  }
  const type = schemaType(schema, value)
  if (type === 'array') {
    const itemSchema = schemaRecord(schema.items) ?? {}
    const items = Array.isArray(value) ? value : []
    return { kind: 'array', schema, items: items.map((item) => createStructuredDraft(itemSchema, item)) }
  }
  if (type === 'object') {
    const source = isRecord(value) ? value : {}
    const properties = schemaRecord(schema.properties) ?? {}
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : [])
    const entries: ObjectEntryDraft[] = []
    let entryId = 0
    for (const [key, childSchemaValue] of Object.entries(properties)) {
      const childSchema = schemaRecord(childSchemaValue) ?? {}
      if (!Object.hasOwn(source, key) && !required.has(key)) continue
      entries.push({
        id: `entry-${entryId++}`,
        key,
        dynamic: false,
        required: required.has(key),
        schema: childSchema,
        value: createStructuredDraft(childSchema, source[key]),
      })
    }
    for (const [key, childValue] of Object.entries(source)) {
      if (Object.hasOwn(properties, key)) continue
      const childSchema = additionalPropertySchema(schema, key)
      entries.push({
        id: `entry-${entryId++}`,
        key,
        dynamic: true,
        required: false,
        schema: childSchema,
        value: createStructuredDraft(childSchema, childValue),
      })
    }
    return { kind: 'object', schema, entries }
  }
  return { kind: 'scalar', schema, value: value ?? defaultValue(schema) }
}

export function structuredDraftValue(draft: StructuredDraft): unknown {
  if (draft.kind === 'scalar') return draft.value
  if (draft.kind === 'union') return structuredDraftValue(draft.value)
  if (draft.kind === 'array') return draft.items.map(structuredDraftValue)
  return Object.fromEntries(draft.entries.map((entry) => [entry.key, structuredDraftValue(entry.value)]))
}

export function validateStructuredDraft(draft: StructuredDraft, label = 'Value'): readonly string[] {
  const schema = draft.kind === 'union' ? draft.value.schema : draft.schema
  return [...draftShapeErrors(draft, label), ...validateSchemaValue(structuredDraftValue(draft), schema, label)]
}

export function emptyStructuredDraft(schema: Readonly<Record<string, unknown>>): StructuredDraft {
  return createStructuredDraft(schema, defaultValue(schema))
}

export function selectStructuredUnionBranch(draft: UnionDraft, activeIndex: number): UnionDraft {
  const schema = draft.branches[activeIndex]
  if (!schema) return draft
  return {
    ...draft,
    activeIndex,
    value: createStructuredDraft(schema, defaultValue(schema)),
  }
}

export function structuredBranchLabel(schema: Readonly<Record<string, unknown>>, index: number): string {
  const type = schemaType(schema, undefined)
  if (type === 'null') return 'Null'
  if (type === 'object') return 'Object'
  if (type === 'array') return 'List'
  if (type === 'string') return 'Text'
  if (type === 'number' || type === 'integer') return 'Number'
  if (type === 'boolean') return 'True or false'
  return `Option ${index + 1}`
}

export function canEditStructuredSchema(schema: Readonly<Record<string, unknown>>): boolean {
  if (!Object.keys(schema).every(schemaKeywordSupported)) return false
  if (schema.type !== undefined && (typeof schema.type !== 'string' || !supportedSchemaTypes.has(schema.type)))
    return false
  const branches = structuredUnionBranches(schema)
  if (branches) return branches.length > 0 && branches.every(canEditStructuredSchema)
  if (hasMalformedUnion(schema)) return false

  for (const keyword of ['allOf'] as const) {
    const values = schema[keyword]
    if (values !== undefined) {
      if (
        !Array.isArray(values) ||
        values.some((value) => !schemaRecord(value) || !canEditStructuredSchema(schemaRecord(value)!))
      )
        return false
    }
  }
  for (const keyword of ['if', 'then', 'else', 'not'] as const) {
    const value = schema[keyword]
    if (value !== undefined && (!schemaRecord(value) || !canEditStructuredSchema(schemaRecord(value)!))) return false
  }

  const type = schemaType(schema, undefined)
  if (type === 'object') {
    if (schema.properties !== undefined && !schemaRecord(schema.properties)) return false
    const properties = schemaRecord(schema.properties) ?? {}
    if (
      !Object.values(properties).every(
        (child) => Boolean(schemaRecord(child)) && canEditStructuredSchema(schemaRecord(child)!),
      )
    )
      return false
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      const additional = schemaRecord(schema.additionalProperties)
      if (!additional || !canEditStructuredSchema(additional)) return false
    }
    const propertyNames = schemaRecord(schema.propertyNames)
    if (schema.propertyNames !== undefined && (!propertyNames || !canEditStructuredSchema(propertyNames))) return false
    return Object.values(schemaRecord(schema.patternProperties) ?? {}).every(
      (child) => Boolean(schemaRecord(child)) && canEditStructuredSchema(schemaRecord(child)!),
    )
  }
  if (type === 'array') {
    if (schema.items === undefined || schema.items === true) return true
    const items = schemaRecord(schema.items)
    return Boolean(items && canEditStructuredSchema(items))
  }
  if (type === 'null' || type === 'string' || type === 'number' || type === 'integer' || type === 'boolean') return true
  if (type !== undefined) return false
  return true
}

export function validateSchemaValue(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
  label = 'Value',
): readonly string[] {
  const union = structuredUnionBranches(schema)
  if (union) {
    const candidates = union.filter((branch) => valueMatchesSchema(value, branch))
    if (candidates.length === 0) return [`${label} must match an allowed value shape.`]
    const results = candidates.map((branch) => validateSchemaValue(value, branch, label))
    const valid = results.filter((errors) => errors.length === 0)
    if (Array.isArray(schema.oneOf) && valid.length > 1) return [`${label} must match exactly one allowed value shape.`]
    return valid.length > 0 ? [] : (results[0] ?? [`${label} must match an allowed value shape.`])
  }

  const errors = validateScalar(value, schema, label)
  const type = schemaType(schema, value)
  if (type === 'array' && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      errors.push(`${label} must have at least ${schema.minItems} items.`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      errors.push(`${label} must have at most ${schema.maxItems} items.`)
    const items = schemaRecord(schema.items)
    if (items)
      value.forEach((item, index) => errors.push(...validateSchemaValue(item, items, `${label} item ${index + 1}`)))
  }
  if (type === 'object' && isRecord(value)) {
    const keys = Object.keys(value)
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties)
      errors.push(`${label} must have at least ${schema.minProperties} properties.`)
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties)
      errors.push(`${label} must have at most ${schema.maxProperties} properties.`)
    const required = Array.isArray(schema.required) ? schema.required.filter(isString) : []
    for (const key of required) if (!Object.hasOwn(value, key)) errors.push(`${label} requires ${humanize(key)}.`)
    const properties = schemaRecord(schema.properties) ?? {}
    for (const [key, child] of Object.entries(value)) {
      const propertySchema = schemaRecord(properties[key]) ?? matchingPatternSchema(schema, key)
      if (propertySchema)
        errors.push(...validateSchemaValue(child, propertySchema, fieldSchemaLabel(key, propertySchema)))
      else if (schema.additionalProperties === false) errors.push(`${label} does not allow ${humanize(key)}.`)
      else {
        const additional = schemaRecord(schema.additionalProperties)
        if (additional) errors.push(...validateSchemaValue(child, additional, humanize(key)))
      }
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const child = schemaRecord(branch)
      if (child) errors.push(...validateSchemaValue(value, child, label))
    }
  }
  const condition = schemaRecord(schema.if)
  if (condition) {
    const selected = schemaMatches(value, condition) ? schemaRecord(schema.then) : schemaRecord(schema.else)
    if (selected) errors.push(...validateSchemaValue(value, selected, label))
  }
  const excluded = schemaRecord(schema.not)
  if (excluded && schemaMatches(value, excluded)) errors.push(`${label} uses a disallowed value.`)
  return errors
}

export function schemaRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(value) ? value : null
}

export function fieldLabel(entry: Pick<ObjectEntryDraft, 'key' | 'schema'>): string {
  return typeof entry.schema.title === 'string' ? entry.schema.title : humanize(entry.key)
}

export function objectOptionalProperties(draft: ObjectDraft): readonly [string, Readonly<Record<string, unknown>>][] {
  const properties = schemaRecord(draft.schema.properties) ?? {}
  const present = new Set(draft.entries.map(({ key }) => key))
  return Object.entries(properties)
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => [key, schemaRecord(value) ?? {}])
}

export function objectAllowsDynamicEntries(draft: ObjectDraft): boolean {
  return draft.schema.additionalProperties !== false
}

export function additionalPropertySchema(
  schema: Readonly<Record<string, unknown>>,
  key = '',
): Readonly<Record<string, unknown>> {
  const patterns = schemaRecord(schema.patternProperties) ?? {}
  for (const [pattern, value] of Object.entries(patterns)) {
    try {
      if (new RegExp(pattern, 'u').test(key)) return schemaRecord(value) ?? {}
    } catch {
      continue
    }
  }
  return schemaRecord(schema.additionalProperties) ?? {}
}

function draftShapeErrors(draft: StructuredDraft, label: string): string[] {
  if (draft.kind === 'scalar') return []
  if (draft.kind === 'union') return draftShapeErrors(draft.value, label)
  if (draft.kind === 'array')
    return draft.items.flatMap((item, index) => draftShapeErrors(item, `${label} item ${index + 1}`))

  const errors: string[] = []
  const keys = draft.entries.map(({ key }) => key)
  if (keys.some((key) => key.length === 0)) errors.push(`${label} map keys cannot be blank.`)
  if (new Set(keys).size !== keys.length) errors.push(`${label} map keys must be unique.`)
  const propertyNamePattern = schemaRecord(draft.schema.propertyNames)?.pattern
  if (typeof propertyNamePattern === 'string') {
    let expression: RegExp | null = null
    try {
      expression = new RegExp(propertyNamePattern, 'u')
    } catch {
      errors.push(`${label} declares an invalid property-name pattern.`)
    }
    if (expression) {
      for (const key of keys) if (!expression.test(key)) errors.push(`${label} key "${key}" is not allowed.`)
    }
  }
  for (const entry of draft.entries)
    errors.push(
      ...draftShapeErrors(entry.value, entry.dynamic ? `${label} ${entry.key || 'entry'}` : fieldLabel(entry)),
    )
  return errors
}

function validateScalar(value: unknown, schema: Readonly<Record<string, unknown>>, label: string): string[] {
  const errors: string[] = []
  const type = schemaType(schema, value)
  if (type === 'null' && value !== null) errors.push(`${label} must be null.`)
  if (type === 'string' && typeof value !== 'string') errors.push(`${label} must be text.`)
  if ((type === 'number' || type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value)))
    errors.push(`${label} must be a number.`)
  if (type === 'integer' && typeof value === 'number' && !Number.isInteger(value))
    errors.push(`${label} must be an integer.`)
  if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${label} must be true or false.`)
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum)
    errors.push(`${label} must be at least ${schema.minimum}.`)
  if (typeof value === 'number' && typeof schema.maximum === 'number' && value > schema.maximum)
    errors.push(`${label} must be at most ${schema.maximum}.`)
  if (typeof value === 'number' && typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
    errors.push(`${label} must be greater than ${schema.exclusiveMinimum}.`)
  if (typeof value === 'number' && typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
    errors.push(`${label} must be less than ${schema.exclusiveMaximum}.`)
  if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength)
    errors.push(`${label} must contain at least ${schema.minLength} characters.`)
  if (typeof value === 'string' && typeof schema.maxLength === 'number' && value.length > schema.maxLength)
    errors.push(`${label} must contain at most ${schema.maxLength} characters.`)
  if (typeof value === 'string' && typeof schema.pattern === 'string') {
    try {
      if (!new RegExp(schema.pattern, 'u').test(value)) errors.push(`${label} has an invalid format.`)
    } catch {
      errors.push(`${label} declares an invalid pattern.`)
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value)))
    errors.push(`${label} must use an allowed value.`)
  if (Object.hasOwn(schema, 'const') && !deepEqual(schema.const, value))
    errors.push(`${label} must be ${String(schema.const)}.`)
  return errors
}

function schemaType(schema: Readonly<Record<string, unknown>>, value: unknown): string | undefined {
  const declared = Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== 'null') : schema.type
  if (typeof declared === 'string') return declared
  if (Object.hasOwn(schema, 'const')) return valueType(schema.const)
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return valueType(schema.enum[0])
  if (schema.properties || schema.additionalProperties || schema.patternProperties) return 'object'
  if (schema.items) return 'array'
  if (schema.minProperties !== undefined || schema.maxProperties !== undefined) return 'object'
  if (schema.minItems !== undefined || schema.maxItems !== undefined) return 'array'
  if (schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern !== undefined) return 'string'
  if (
    schema.minimum !== undefined ||
    schema.maximum !== undefined ||
    schema.exclusiveMinimum !== undefined ||
    schema.exclusiveMaximum !== undefined
  )
    return 'number'
  if (Array.isArray(value)) return 'array'
  if (isRecord(value)) return 'object'
  return undefined
}

function defaultValue(schema: Readonly<Record<string, unknown>>): unknown {
  if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default)
  if (Object.hasOwn(schema, 'const')) return structuredClone(schema.const)
  if (Array.isArray(schema.enum)) return structuredClone(schema.enum[0])
  const branches = structuredUnionBranches(schema)
  if (branches) return defaultValue(branches[0] ?? {})
  const type = schemaType(schema, undefined)
  if (type === 'array') return []
  if (type === 'object') return {}
  if (type === 'boolean') return false
  if (type === 'number' || type === 'integer') return Number.NaN
  if (type === 'null') return null
  return ''
}

function editableBranches(
  schema: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] | null {
  const declared = structuredUnionBranches(schema)
  if (declared) return declared
  if (schemaType(schema, undefined) !== undefined) return null
  const base = Object.fromEntries(Object.entries(schema).filter(([key]) => !['oneOf', 'anyOf'].includes(key)))
  return ['null', 'boolean', 'number', 'string', 'array', 'object'].map((type) =>
    type === 'array'
      ? { ...base, type, items: true }
      : type === 'object'
        ? { ...base, type, additionalProperties: true }
        : { ...base, type },
  )
}

function structuredUnionBranches(
  schema: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] | null {
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : null
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : null
  if ((oneOf && anyOf) || (!oneOf && !anyOf)) return null
  const unresolved = oneOf ?? anyOf ?? []
  if (unresolved.length === 0) return null
  const base = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'oneOf' && key !== 'anyOf'))
  const branches: Readonly<Record<string, unknown>>[] = []
  for (const candidate of unresolved) {
    const branch = schemaRecord(candidate)
    if (!branch) return null
    branches.push({ ...base, ...branch })
  }
  return branches
}

function hasMalformedUnion(schema: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(schema, 'oneOf') || Object.hasOwn(schema, 'anyOf')
}

function matchingBranchIndex(branches: readonly Readonly<Record<string, unknown>>[], value: unknown): number {
  const index = branches.findIndex((branch) => valueMatchesSchema(value, branch))
  return index < 0 ? 0 : index
}

function valueMatchesSchema(value: unknown, schema: Readonly<Record<string, unknown>>): boolean {
  if (Object.hasOwn(schema, 'const') && !deepEqual(schema.const, value)) return false
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) return false
  const type = schemaType(schema, value)
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isRecord(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  return value !== undefined
}

function valueType(value: unknown): string | undefined {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isRecord(value)) return 'object'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value === 'string' || typeof value === 'boolean' ? typeof value : undefined
}

function schemaMatches(value: unknown, schema: Readonly<Record<string, unknown>>): boolean {
  return validateSchemaValue(value, schema).length === 0
}

function matchingPatternSchema(
  schema: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | null {
  for (const [pattern, candidate] of Object.entries(schemaRecord(schema.patternProperties) ?? {})) {
    try {
      if (new RegExp(pattern, 'u').test(key)) return schemaRecord(candidate)
    } catch {
      return null
    }
  }
  return null
}

function fieldSchemaLabel(key: string, schema: Readonly<Record<string, unknown>>): string {
  return typeof schema.title === 'string' ? schema.title : humanize(key)
}

const supportedSchemaKeywords = new Set([
  '$comment',
  '$id',
  '$schema',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'default',
  'deprecated',
  'description',
  'else',
  'enum',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'if',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'not',
  'oneOf',
  'pattern',
  'patternProperties',
  'properties',
  'propertyNames',
  'readOnly',
  'required',
  'then',
  'title',
  'type',
  'writeOnly',
])

const supportedSchemaTypes = new Set(['null', 'string', 'number', 'integer', 'boolean', 'array', 'object'])

function schemaKeywordSupported(keyword: string): boolean {
  return supportedSchemaKeywords.has(keyword) || keyword.startsWith('x-')
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
    )
  }
  return false
}

function humanize(value: string): string {
  const text = value.replaceAll('_', ' ').replaceAll(/([a-z])([A-Z])/g, '$1 $2')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
