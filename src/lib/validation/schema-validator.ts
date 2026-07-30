import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import { isMap, isSeq } from 'yaml'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { DocumentKind, ValidationIssue } from '$src/lib/documents/types'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'

export interface CompiledContractValidators {
  definition: ValidateFunction<unknown>
  companion: ValidateFunction<unknown>
}

const validatorCache = new Map<AuthoringContract['contract_digest'], CompiledContractValidators>()

export function compiledContractValidatorCountForTest(): number {
  return validatorCache.size
}
const CONTRACT_ANNOTATION_KEYWORDS = [
  'x-hermes-unit',
  'x-hermes-section',
  'x-hermes-order',
  'x-hermes-widget',
  'x-hermes-status',
  'x-hermes-compatibility-code',
  'x-hermes-migration',
  'x-hermes-value-role',
  'x-hermes-enforcement-phase',
] as const
const SUPPORTED_STRING_FORMATS: Readonly<Record<string, RegExp>> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}

export function compileContractValidators(contract: AuthoringContract): CompiledContractValidators {
  const cached = validatorCache.get(contract.contract_digest)
  if (cached) return cached

  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
  for (const keyword of CONTRACT_ANNOTATION_KEYWORDS) ajv.addKeyword({ keyword, valid: true })
  for (const format of collectDeclaredFormats(contract.definition_schema, contract.sidecar_schema)) {
    const validator = SUPPORTED_STRING_FORMATS[format]
    if (!validator) throw new Error(`Unsupported JSON Schema format "${format}".`)
    ajv.addFormat(format, validator)
  }

  const compiled = {
    definition: ajv.compile(contract.definition_schema),
    companion: ajv.compile(contract.sidecar_schema),
  }
  validatorCache.set(contract.contract_digest, compiled)
  return compiled
}

export function validateContractDocument(
  parsed: ParsedYamlDocument,
  kind: DocumentKind,
  contract: AuthoringContract,
): readonly ValidationIssue[] {
  const value = parsed.document.toJS({ maxAliasCount: 1_000 }) as unknown
  const validators = compileContractValidators(contract)
  const validator = kind === 'definition' ? validators.definition : validators.companion
  const schema = kind === 'definition' ? contract.definition_schema : contract.sidecar_schema
  validator(value)

  const schemaIssues = (validator.errors ?? []).map((error) => schemaIssue(error, parsed, kind))
  const compatibilityIssues = [
    ...collectStatusIssues(value, schema, schema, '', parsed, kind, contract),
    ...(contract.profile === 'hermes-legacy'
      ? collectLegacyUnknownFields(value, schema, schema, '', parsed, kind)
      : []),
  ]

  return [...schemaIssues, ...deduplicateIssues(compatibilityIssues)]
}

function schemaIssue(error: ErrorObject, parsed: ParsedYamlDocument, document: DocumentKind): ValidationIssue {
  const path = errorPath(error)
  const field = lastPathSegment(path)
  const issue: ValidationIssue = {
    code: `schema_${snakeCase(error.keyword)}`,
    layer: 'contract',
    severity: 'error',
    blocking: true,
    message: schemaMessage(error.keyword, path),
    document,
    path,
    ...(field ? { field } : {}),
  }

  return withSourceLocation(issue, parsed, path)
}

function schemaMessage(keyword: string, path: string): string {
  if (keyword === 'required') return `The contract requires ${path}.`
  if (keyword === 'additionalProperties') return `The contract does not allow ${path}.`
  return `The value at ${path} violates the contract's ${keyword} rule.`
}

function snakeCase(value: string): string {
  return value.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function errorPath(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: unknown }).missingProperty
    return appendPointer(error.instancePath, typeof missing === 'string' ? missing : 'missing')
  }

  if (error.keyword === 'additionalProperties') {
    const additional = (error.params as { additionalProperty?: unknown }).additionalProperty
    return appendPointer(error.instancePath, typeof additional === 'string' ? additional : 'unknown')
  }

  return error.instancePath || '/'
}

function collectStatusIssues(
  value: unknown,
  schemaValue: unknown,
  rootSchema: Record<string, unknown>,
  path: string,
  parsed: ParsedYamlDocument,
  document: DocumentKind,
  contract: AuthoringContract,
): ValidationIssue[] {
  const schema = resolveSchema(schemaValue, rootSchema)
  if (!schema) return []

  const issues: ValidationIssue[] = []
  const status = schema['x-hermes-status']
  if (
    value !== undefined &&
    (status === 'deferred' || status === 'deprecated' || status === 'warning' || status === 'blocking')
  ) {
    const annotatedCode = schema['x-hermes-compatibility-code']
    const code = typeof annotatedCode === 'string' ? annotatedCode : `contract_${status}`
    const descriptor = contract.compatibility_codes[code]
    if ((status === 'warning' || status === 'blocking') && !descriptor) {
      // Runtime status metadata is descriptive. Without a catalog entry there is
      // no editor compatibility decision to project.
    } else {
      const field = lastPathSegment(path)
      const issue: ValidationIssue = {
        code,
        layer: 'compatibility',
        severity: 'warning',
        blocking: false,
        message: descriptor?.description ?? `This value is ${status} in the active contract.`,
        document,
        path: path || '/',
        ...(field ? { field } : {}),
      }
      issues.push(withSourceLocation(issue, parsed, path))
    }
  }

  if (isRecord(value)) {
    const properties = recordValue(schema.properties)
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties?.[key]
      if (childSchema !== undefined) {
        issues.push(
          ...collectStatusIssues(child, childSchema, rootSchema, appendPointer(path, key), parsed, document, contract),
        )
      }
    }
  } else if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((child, index) => {
      issues.push(
        ...collectStatusIssues(
          child,
          schema.items,
          rootSchema,
          appendPointer(path, String(index)),
          parsed,
          document,
          contract,
        ),
      )
    })
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = schema[keyword]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      issues.push(...collectStatusIssues(value, branch, rootSchema, path, parsed, document, contract))
    }
  }

  return issues
}

function collectLegacyUnknownFields(
  value: unknown,
  schemaValue: unknown,
  rootSchema: Record<string, unknown>,
  path: string,
  parsed: ParsedYamlDocument,
  document: DocumentKind,
): ValidationIssue[] {
  const schema = resolveSchema(schemaValue, rootSchema)
  if (!schema) return []

  const issues: ValidationIssue[] = []
  if (isRecord(value)) {
    const properties = recordValue(schema.properties)
    if (
      properties &&
      Object.keys(properties).length > 0 &&
      (schema.additionalProperties === undefined || schema.additionalProperties === true)
    ) {
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(properties, key)) continue
        const childPath = appendPointer(path, key)
        issues.push(
          withSourceLocation(
            {
              code: 'legacy_unknown_field',
              layer: 'compatibility',
              severity: 'warning',
              blocking: false,
              message: `The legacy profile preserves the unknown field ${childPath}.`,
              document,
              path: childPath,
              field: key,
            },
            parsed,
            childPath,
          ),
        )
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties?.[key]
      if (childSchema !== undefined) {
        issues.push(
          ...collectLegacyUnknownFields(child, childSchema, rootSchema, appendPointer(path, key), parsed, document),
        )
      }
    }
  } else if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((child, index) => {
      issues.push(
        ...collectLegacyUnknownFields(
          child,
          schema.items,
          rootSchema,
          appendPointer(path, String(index)),
          parsed,
          document,
        ),
      )
    })
  }

  return issues
}

function withSourceLocation(issue: ValidationIssue, parsed: ParsedYamlDocument, path: string): ValidationIssue {
  const node = nodeAtPointer(parsed, path)
  const offset = node?.range?.[0]
  if (offset === undefined) return issue

  let low = 0
  let high = parsed.lineStarts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const start = parsed.lineStarts[middle]
    if (start === undefined || start > offset) high = middle - 1
    else low = middle + 1
  }
  const lineIndex = Math.max(0, high)
  return {
    ...issue,
    line: lineIndex + 1,
    column: offset - (parsed.lineStarts[lineIndex] ?? 0) + 1,
  }
}

function nodeAtPointer(parsed: ParsedYamlDocument, pointer: string): { range?: readonly number[] | null } | null {
  const path = pointerTokens(pointer)
  if (path.length === 0) return parsed.document.contents

  let current: unknown = parsed.document.contents
  for (const segment of path) {
    if (isMap(current)) {
      current = current.get(segment, true) ?? null
    } else if (isSeq(current)) {
      const index = Number(segment)
      current = Number.isInteger(index) ? (current.get(index, true) ?? null) : null
    } else {
      return null
    }
  }
  return current !== null && typeof current === 'object' ? current : null
}

function pointerTokens(pointer: string): string[] {
  if (!pointer || pointer === '/') return []
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function appendPointer(base: string, segment: string): string {
  return `${base}/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function lastPathSegment(path: string): string | undefined {
  const segments = pointerTokens(path)
  return segments.at(-1)
}

function collectDeclaredFormats(...schemas: readonly unknown[]): Set<string> {
  const formats = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.format === 'string') formats.add(value.format)
    Object.values(value).forEach(visit)
  }
  schemas.forEach(visit)
  return formats
}

function resolveSchema(value: unknown, root: Record<string, unknown>): Record<string, unknown> | null {
  return resolveContractSchema(value, root)
}

/**
 * Resolves the schema shapes used by editor inspection without weakening Ajv's
 * authoritative validation. Only local JSON Pointers are accepted. Invalid,
 * remote, unresolved, or cyclic references fail closed.
 */
export function resolveContractSchema(value: unknown, root: Record<string, unknown>): Record<string, unknown> | null {
  return resolveContractSchemaWithin(value, root, new Set(), { remainingWork: 512 }, 0)
}

interface SchemaInspectionBudget {
  remainingWork: number
}

function resolveContractSchemaWithin(
  value: unknown,
  root: Record<string, unknown>,
  resolving: Set<string>,
  budget: SchemaInspectionBudget,
  depth: number,
): Record<string, unknown> | null {
  if (depth > 64 || !consumeInspectionWork(budget)) return null
  if (!isRecord(value)) return null
  let resolved: Record<string, unknown> = { ...value }
  if (Object.hasOwn(value, '$ref')) {
    if (typeof value.$ref !== 'string' || (value.$ref !== '#' && !value.$ref.startsWith('#/'))) return null
    if (resolving.has(value.$ref)) return null
    const target = localPointerTarget(value.$ref, root, budget)
    if (target === null) return null
    resolving.add(value.$ref)
    try {
      const referenced = resolveContractSchemaWithin(target, root, resolving, budget, depth + 1)
      if (!referenced) return null
      const siblings = { ...value }
      delete siblings.$ref
      const resolvedSiblings = resolveContractSchemaWithin(siblings, root, resolving, budget, depth + 1)
      if (!resolvedSiblings) return null
      const conjunction = mergeInspectionSchemas(referenced, resolvedSiblings)
      if (!conjunction) return null
      resolved = conjunction
    } finally {
      resolving.delete(value.$ref)
    }
  }

  if (resolved.allOf !== undefined) {
    if (!Array.isArray(resolved.allOf)) return null
    let aggregate = { ...resolved }
    delete aggregate.allOf
    for (const branch of resolved.allOf) {
      const branchSchema = resolveContractSchemaWithin(branch, root, resolving, budget, depth + 1)
      if (!branchSchema) return null
      const conjunction = mergeInspectionSchemas(aggregate, branchSchema)
      if (!conjunction) return null
      aggregate = conjunction
    }
    resolved = aggregate
  }
  return resolved
}

function mergeInspectionSchemas(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged = { ...left, ...right }
  const type = intersectSchemaTypes(left.type, right.type)
  if (type === null) return null
  if (type !== undefined) merged.type = type

  if (!mergeBounds(merged, left, right, 'minLength', 'maxLength')) return null
  if (!mergeBounds(merged, left, right, 'minItems', 'maxItems')) return null
  if (!mergeBounds(merged, left, right, 'minProperties', 'maxProperties')) return null

  const leftProperties = recordValue(left.properties)
  const rightProperties = recordValue(right.properties)
  const required = [
    ...(Array.isArray(left.required) ? left.required.filter((item): item is string => typeof item === 'string') : []),
    ...(Array.isArray(right.required) ? right.required.filter((item): item is string => typeof item === 'string') : []),
  ]
  if (required.length > 0) merged.required = [...new Set(required)]
  const leftClosed = left.additionalProperties === false
  const rightClosed = right.additionalProperties === false
  if (leftClosed || rightClosed) {
    if (hasPatternProperties(left) || hasPatternProperties(right)) return null
    const leftKeys = new Set(Object.keys(leftProperties ?? {}))
    const rightKeys = new Set(Object.keys(rightProperties ?? {}))
    const allowedKeys = leftClosed
      ? rightClosed
        ? [...leftKeys].filter((key) => rightKeys.has(key))
        : [...leftKeys]
      : [...rightKeys]
    if (required.some((key) => !allowedKeys.includes(key))) return null
    merged.properties = Object.fromEntries(
      allowedKeys.map((key) => [key, rightProperties?.[key] ?? leftProperties?.[key]]),
    )
    merged.additionalProperties = false
  } else if (leftProperties || rightProperties) {
    merged.properties = { ...(leftProperties ?? {}), ...(rightProperties ?? {}) }
  }
  return merged
}

function consumeInspectionWork(budget: SchemaInspectionBudget): boolean {
  if (budget.remainingWork <= 0) return false
  budget.remainingWork -= 1
  return true
}

function localPointerTarget(
  reference: string,
  root: Record<string, unknown>,
  budget: SchemaInspectionBudget,
): unknown | null {
  if (reference === '#') return root
  let target: unknown = root
  for (const encoded of reference.slice(2).split('/')) {
    if (!consumeInspectionWork(budget)) return null
    const segment = decodePointerSegment(encoded)
    if (segment === null) return null
    if (Array.isArray(target)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) return null
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index >= target.length || !Object.hasOwn(target, index)) return null
      target = target[index]
    } else if (isRecord(target) && Object.hasOwn(target, segment)) {
      target = target[segment]
    } else {
      return null
    }
  }
  return target
}

function decodePointerSegment(segment: string): string | null {
  if (/(?:~[^01]|~$)/.test(segment)) return null
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function intersectSchemaTypes(left: unknown, right: unknown): string | readonly string[] | undefined | null {
  const leftTypes = schemaTypes(left)
  const rightTypes = schemaTypes(right)
  if (leftTypes === null || rightTypes === null) return null
  if (leftTypes === undefined) return rightTypes === undefined ? undefined : schemaTypeValue(rightTypes)
  if (rightTypes === undefined) return schemaTypeValue(leftTypes)
  const intersection = [...leftTypes].filter((type) => rightTypes.has(type))
  if (intersection.length === 0) return null
  return intersection.length === 1 ? intersection[0] : intersection
}

function schemaTypeValue(types: ReadonlySet<string>): string | readonly string[] {
  const values = [...types]
  return values.length === 1 ? values[0]! : values
}

function schemaTypes(value: unknown): Set<string> | undefined | null {
  if (value === undefined) return undefined
  if (typeof value === 'string') return new Set([value])
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) return new Set(value)
  return null
}

function mergeBounds(
  merged: Record<string, unknown>,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  minimumKeyword: string,
  maximumKeyword: string,
): boolean {
  const minimum = numericBound(left[minimumKeyword], right[minimumKeyword], Math.max)
  const maximum = numericBound(left[maximumKeyword], right[maximumKeyword], Math.min)
  if (minimum === null || maximum === null || (minimum !== undefined && maximum !== undefined && minimum > maximum)) {
    return false
  }
  if (minimum !== undefined) merged[minimumKeyword] = minimum
  if (maximum !== undefined) merged[maximumKeyword] = maximum
  return true
}

function numericBound(
  left: unknown,
  right: unknown,
  combine: (leftValue: number, rightValue: number) => number,
): number | undefined | null {
  if (left !== undefined && typeof left !== 'number') return null
  if (right !== undefined && typeof right !== 'number') return null
  if (typeof left === 'number' && typeof right === 'number') return combine(left, right)
  return typeof left === 'number' ? left : typeof right === 'number' ? right : undefined
}

function hasPatternProperties(schema: Record<string, unknown>): boolean {
  const patterns = recordValue(schema.patternProperties)
  return patterns !== null && Object.keys(patterns).length > 0
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deduplicateIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.document}\u0000${issue.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
