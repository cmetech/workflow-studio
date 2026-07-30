import { describe, expect, it } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { compileContractValidators, resolveContractSchema, validateContractDocument } from './schema-validator'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'

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
  it('resolves local JSON Pointers through canonical array indices only', () => {
    const root = {
      $defs: {
        wrapper: {
          oneOf: [{ type: 'string', minLength: 1 }],
        },
      },
    }

    expect(resolveContractSchema({ $ref: '#/$defs/wrapper/oneOf/0' }, root)).toEqual({
      type: 'string',
      minLength: 1,
    })
    for (const reference of [
      '#/$defs/wrapper/oneOf/00',
      '#/$defs/wrapper/oneOf/01',
      '#/$defs/wrapper/oneOf/-',
      '#/$defs/wrapper/oneOf/1',
      'https://attacker.invalid/schema.json',
    ]) {
      expect(resolveContractSchema({ $ref: reference }, root), reference).toBeNull()
    }

    const cyclicRoot = { $defs: { cycle: { $ref: '#/$defs/cycle' } } }
    expect(resolveContractSchema({ $ref: '#/$defs/cycle' }, cyclicRoot)).toBeNull()
  })

  it('percent-decodes local URI fragments before decoding JSON Pointer tokens', () => {
    const root = {
      $defs: {
        'non empty': { type: 'string', minLength: 1 },
        'slash/name': { type: 'integer' },
      },
    }

    expect(resolveContractSchema({ $ref: '#/$defs/non%20empty' }, root)).toEqual({
      type: 'string',
      minLength: 1,
    })
    expect(resolveContractSchema({ $ref: '#/$defs/slash%7E1name' }, root)).toEqual({ type: 'integer' })
    for (const reference of ['#/$defs/non%', '#/$defs/non%2', '#/$defs/non%XZempty']) {
      expect(() => resolveContractSchema({ $ref: reference }, root), reference).not.toThrow()
      expect(resolveContractSchema({ $ref: reference }, root), reference).toBeNull()
    }
  })

  it('fails closed for contradictory allOf assertions instead of overwriting a branch', () => {
    expect(
      resolveContractSchema(
        {
          allOf: [
            { type: 'string', minLength: 1 },
            { type: 'string', enum: [''] },
          ],
        },
        {},
      ),
    ).toBeNull()
    expect(
      resolveContractSchema(
        {
          allOf: [
            { type: 'string', const: 'a' },
            { type: 'string', const: 'b' },
          ],
        },
        {},
      ),
    ).toBeNull()
    expect(
      resolveContractSchema(
        {
          allOf: [
            { type: 'object', properties: { command: { type: 'string', const: 'a' } } },
            { type: 'object', properties: { command: { type: 'string', const: 'b' } } },
          ],
        },
        {},
      ),
    ).toBeNull()
  })

  it('soundly intersects const, enum, annotations, and integer-as-number types', () => {
    expect(
      resolveContractSchema(
        {
          title: 'Imported numeric value',
          allOf: [
            { type: ['number', 'string'], enum: [1, 2, 'two'] },
            { type: ['integer', 'boolean'], const: 2, description: 'Must be the supported integer.' },
          ],
        },
        {},
      ),
    ).toEqual({
      title: 'Imported numeric value',
      type: 'integer',
      enum: [2],
      const: 2,
      description: 'Must be the supported integer.',
    })
    expect(resolveContractSchema({ allOf: [{ type: 'number' }, { type: 'integer' }] }, {})).toEqual({
      type: 'integer',
    })
  })

  it.each([
    [
      { type: 'string', pattern: '^a' },
      { type: 'string', minLength: 1 },
    ],
    [
      { type: 'number', minimum: 1 },
      { type: 'number', maximum: 2 },
    ],
    [
      { type: 'array', contains: { type: 'string' } },
      { type: 'array', minItems: 1 },
    ],
    [
      { type: 'object', propertyNames: { pattern: '^safe$' } },
      { type: 'object', minProperties: 1 },
    ],
    [
      { type: 'object', not: { required: ['blocked'] } },
      { type: 'object', required: ['value'] },
    ],
    [{ type: 'object', if: { required: ['flag'] }, then: { required: ['value'] } }, { type: 'object' }],
  ])('fails closed when unsupported conjunction assertions cannot be proven compatible', (left, right) => {
    expect(resolveContractSchema({ allOf: [left, right] }, {})).toBeNull()
  })

  it('bounds local reference inspection while preserving ordinary nested references', () => {
    const ordinaryDefinitions: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index < 32; index += 1) {
      ordinaryDefinitions[`level${index}`] = index === 31 ? { type: 'string' } : { $ref: `#/$defs/level${index + 1}` }
    }
    const ordinaryRoot = { $defs: ordinaryDefinitions }
    expect(resolveContractSchema({ $ref: '#/$defs/level0' }, ordinaryRoot)).toEqual({ type: 'string' })

    const excessiveDefinitions: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index < 2_000; index += 1) {
      excessiveDefinitions[`level${index}`] =
        index === 1_999 ? { type: 'string' } : { $ref: `#/$defs/level${index + 1}` }
    }
    const excessiveRoot = { $defs: excessiveDefinitions }
    let result: Record<string, unknown> | null = null
    expect(() => {
      result = resolveContractSchema({ $ref: '#/$defs/level0' }, excessiveRoot)
    }).not.toThrow()
    expect(result).toBeNull()
  })

  it('strictly compiles both production schemas with descriptive Hermes annotations registered', async () => {
    const contracts = await loadBundledAuthoringContracts()
    expect(contracts).toHaveLength(2)
    for (const productionContract of contracts) {
      expect(() => compileContractValidators(productionContract), productionContract.profile).not.toThrow()
    }
  })

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

  it('enforces supported formats declared by the contract as blocking schema issues', () => {
    const activeContract = contract('archon-2026-07', {
      type: 'object',
      properties: { workflow_id: { type: 'string', format: 'uuid' } },
      required: ['workflow_id'],
      additionalProperties: false,
    })

    const issues = validateContractDocument(
      parsed('workflow_id: definitely-not-a-uuid\n'),
      'definition',
      activeContract,
    )

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'schema_format',
        layer: 'contract',
        blocking: true,
        path: '/workflow_id',
        line: 1,
      }),
    ])
    expect(
      validateContractDocument(
        parsed('workflow_id: 123e4567-e89b-42d3-a456-426614174000\n'),
        'definition',
        activeContract,
      ),
    ).toEqual([])
  })

  it('rejects a contract that declares an unsupported format', () => {
    const activeContract = contract('archon-2026-07', {
      type: 'object',
      properties: { value: { type: 'string', format: 'workflow-specific-code' } },
    })

    expect(() => compileContractValidators(activeContract)).toThrowError(
      'Unsupported JSON Schema format "workflow-specific-code".',
    )
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

  it.each(['warning', 'blocking'])(
    'maps runtime %s status through the editor compatibility catalog',
    (runtimeStatus) => {
      const activeContract = contract(
        'archon-2026-07',
        {
          type: 'object',
          properties: {
            retry: {
              type: 'object',
              'x-hermes-status': runtimeStatus,
              'x-hermes-enforcement-phase': 3,
              'x-hermes-compatibility-code': 'archon_retry_semantics_unavailable',
            },
          },
        },
        {
          archon_retry_semantics_unavailable: {
            status: 'deferred',
            description: 'Retry is authorable but unavailable to this runtime profile.',
          },
        },
      )

      expect(validateContractDocument(parsed('retry: {}\n'), 'definition', activeContract)).toEqual([
        expect.objectContaining({
          code: 'archon_retry_semantics_unavailable',
          severity: 'warning',
          blocking: false,
          message: 'Retry is authorable but unavailable to this runtime profile.',
        }),
      ])
    },
  )
})
