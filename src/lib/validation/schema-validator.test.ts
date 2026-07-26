import { describe, expect, it } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { compileContractValidators, validateContractDocument } from './schema-validator'

let digestNumber = 0

function contract(
  profile: AuthoringContract['profile'],
  definitionSchema: Record<string, unknown>,
  compatibilityCodes: AuthoringContract['compatibility_codes'] = {},
): AuthoringContract {
  digestNumber += 1
  return {
    schema_version: 1,
    contract_reader_version: 1,
    profile,
    normalizer_version: 1,
    contract_digest: `sha256:${digestNumber.toString(16).padStart(64, '0')}`,
    definition_schema: definitionSchema,
    sidecar_schema: { type: 'object' },
    node_kinds: [],
    semantic_rules: [],
    compatibility_codes: compatibilityCodes,
    documentation: { topics: [], examples: [] },
    limits: { max_document_bytes: 2 * 1024 * 1024 },
    extensions: {},
  }
}

function parsed(source: string) {
  const result = parseWorkflowYaml(source, { document: 'definition', maxBytes: 2 * 1024 * 1024 })
  if (!result.parsed) throw new Error(`fixture did not parse: ${JSON.stringify(result.issues)}`)
  return result.parsed
}

describe('contract schema validation', () => {
  it('compiles and caches Draft 2020-12 validators by contract digest', () => {
    const activeContract = contract('archon-2026-07', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        tuple: {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'integer' }],
          minItems: 2,
          items: false,
        },
      },
      required: ['tuple'],
      additionalProperties: false,
    })

    const first = compileContractValidators(activeContract)
    const second = compileContractValidators(activeContract)

    expect(first).toBe(second)
    expect(first.definition({ tuple: ['ok', 1] })).toBe(true)
    expect(first.definition({ tuple: ['ok', 1, true] })).toBe(false)
    expect(first.definition.errors?.map(({ keyword }) => keyword)).toContain('items')
  })

  it('reports Archon additional properties at the property YAML path and source', () => {
    const activeContract = contract('archon-2026-07', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    })
    const source = 'name: Flow\nunexpected: retained\n'

    const issues = validateContractDocument(parsed(source), 'definition', activeContract)

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'schema_additional_properties',
        layer: 'contract',
        severity: 'error',
        blocking: true,
        path: '/unexpected',
        line: 2,
        column: 13,
      }),
    ])
  })

  it('projects legacy unknown properties as non-blocking warnings without dropping them', () => {
    const activeContract = contract('hermes-legacy', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: true,
    })

    const issues = validateContractDocument(
      parsed('name: Legacy\nfuture_setting: preserved\n'),
      'definition',
      activeContract,
    )

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'legacy_unknown_field',
        layer: 'compatibility',
        severity: 'warning',
        blocking: false,
        path: '/future_setting',
      }),
    ])
  })

  it('does not label contract-declared map entries as unknown legacy fields', () => {
    const activeContract = contract('hermes-legacy', {
      type: 'object',
      properties: {
        labels: {
          type: 'object',
          properties: { stable: { type: 'string' } },
          additionalProperties: { type: 'string' },
        },
      },
      additionalProperties: true,
    })

    const issues = validateContractDocument(
      parsed('labels:\n  stable: known\n  team: workflow\n'),
      'definition',
      activeContract,
    )

    expect(issues).toEqual([])
  })

  it('reports every required field with a stable missing-field path', () => {
    const activeContract = contract('archon-2026-07', {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        nodes: { type: 'array' },
      },
      required: ['name', 'description', 'nodes'],
      additionalProperties: false,
    })

    const issues = validateContractDocument(parsed('name: Flow\n'), 'definition', activeContract)

    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'schema_required', path: '/description' },
      { code: 'schema_required', path: '/nodes' },
    ])
  })

  it('maps nested Ajv instance paths to deterministic YAML value locations', () => {
    const activeContract = contract('archon-2026-07', {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      },
      required: ['nodes'],
    })
    const source = 'nodes:\n  - id: 42\n'

    const first = validateContractDocument(parsed(source), 'definition', activeContract)
    const second = validateContractDocument(parsed(source), 'definition', activeContract)

    expect(first).toEqual(second)
    expect(first).toEqual([
      expect.objectContaining({
        code: 'schema_type',
        path: '/nodes/0/id',
        line: 2,
        column: 9,
      }),
    ])
  })

  it('turns present contract status annotations into non-blocking compatibility issues', () => {
    const activeContract = contract(
      'archon-2026-07',
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          future_mode: {
            type: 'boolean',
            'x-hermes-status': 'deferred',
            'x-hermes-compatibility-code': 'future_mode_deferred',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      {
        future_mode_deferred: {
          status: 'deferred',
          description: 'Future mode is authorable but not executable in this profile.',
          migration: 'Remove future_mode before runtime use.',
        },
      },
    )

    const issues = validateContractDocument(parsed('name: Flow\nfuture_mode: true\n'), 'definition', activeContract)

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'future_mode_deferred',
        layer: 'compatibility',
        severity: 'warning',
        blocking: false,
        message: 'Future mode is authorable but not executable in this profile.',
        path: '/future_mode',
      }),
    ])
  })
})
