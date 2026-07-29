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
  if (!isRecord(value)) return null
  if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value

  let resolved: unknown = root
  for (const segment of pointerTokens(value.$ref.slice(1))) {
    if (!isRecord(resolved)) return null
    resolved = resolved[segment]
  }
  return isRecord(resolved) ? resolved : null
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
