export type StructuredDraft = ScalarDraft | ArrayDraft | ObjectDraft

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

export function createStructuredDraft(schema: Readonly<Record<string, unknown>>, value: unknown): StructuredDraft {
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
  if (draft.kind === 'array') return draft.items.map(structuredDraftValue)
  return Object.fromEntries(draft.entries.map((entry) => [entry.key, structuredDraftValue(entry.value)]))
}

export function validateStructuredDraft(draft: StructuredDraft, label = 'Value'): readonly string[] {
  if (draft.kind === 'scalar') return validateScalar(draft.value, draft.schema, label)
  if (draft.kind === 'array') {
    const errors: string[] = []
    if (typeof draft.schema.minItems === 'number' && draft.items.length < draft.schema.minItems)
      errors.push(`${label} must have at least ${draft.schema.minItems} items.`)
    if (typeof draft.schema.maxItems === 'number' && draft.items.length > draft.schema.maxItems)
      errors.push(`${label} must have at most ${draft.schema.maxItems} items.`)
    draft.items.forEach((item, index) => errors.push(...validateStructuredDraft(item, `${label} item ${index + 1}`)))
    return errors
  }

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
  const required = Array.isArray(draft.schema.required) ? draft.schema.required.filter(isString) : []
  for (const key of required) if (!keys.includes(key)) errors.push(`${label} requires ${humanize(key)}.`)
  for (const entry of draft.entries)
    errors.push(
      ...validateStructuredDraft(entry.value, entry.dynamic ? `${label} ${entry.key || 'entry'}` : fieldLabel(entry)),
    )
  return errors
}

export function emptyStructuredDraft(schema: Readonly<Record<string, unknown>>): StructuredDraft {
  return createStructuredDraft(schema, defaultValue(schema))
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
  return draft.schema.additionalProperties !== false && draft.schema.additionalProperties !== undefined
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

function validateScalar(value: unknown, schema: Readonly<Record<string, unknown>>, label: string): string[] {
  const errors: string[] = []
  const type = schemaType(schema, value)
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
  return errors
}

function schemaType(schema: Readonly<Record<string, unknown>>, value: unknown): string | undefined {
  const declared = Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== 'null') : schema.type
  if (typeof declared === 'string') return declared
  if (schema.properties || schema.additionalProperties || schema.patternProperties) return 'object'
  if (schema.items) return 'array'
  if (Array.isArray(value)) return 'array'
  if (isRecord(value)) return 'object'
  return undefined
}

function defaultValue(schema: Readonly<Record<string, unknown>>): unknown {
  if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default)
  const type = schemaType(schema, undefined)
  if (type === 'array') return []
  if (type === 'object') return {}
  if (type === 'boolean') return false
  if (type === 'number' || type === 'integer') return Number.NaN
  if (Array.isArray(schema.enum)) return schema.enum[0]
  return ''
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
