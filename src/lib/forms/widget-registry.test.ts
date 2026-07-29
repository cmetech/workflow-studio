import { describe, expect, it } from 'vitest'
import type { AuthoringContract, FieldDescriptor } from '$src/lib/contract/types'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { collectContractFields, resolveWidget, validateContractFormCoverage } from './widget-registry'

const baseField: FieldDescriptor = {
  id: 'prompt.node.prompt',
  label: 'Prompt',
  description: 'Prompt text sent to the model.',
  field_path: 'nodes[].prompt',
  applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: ['prompt'] },
  widget: 'textarea',
  section: 'General',
  order: 2,
  status: 'supported',
  examples: ['Summarize the release.'],
}

function contract(overrides: Partial<AuthoringContract> = {}): AuthoringContract {
  return {
    schema_version: 1,
    contract_reader_version: 1,
    profile: 'archon-2026-07',
    normalizer_version: 1,
    contract_digest: `sha256:${'a'.repeat(64)}`,
    definition_schema: {
      type: 'object',
      required: ['name', 'nodes'],
      properties: {
        name: {
          type: 'string',
          title: 'Workflow name',
          description: 'Stable workflow name.',
          examples: ['Release flow'],
          minLength: 1,
          'x-hermes-widget': 'text',
          'x-hermes-section': 'General',
          'x-hermes-order': 1,
          'x-hermes-status': 'supported',
        },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: {
                type: 'string',
                pattern: '^[^\\s/\\\\]+$',
                default: 'node',
                title: 'Node ID',
                description: 'Unique node identifier.',
                examples: ['prepare'],
                'x-hermes-widget': 'text',
                'x-hermes-section': 'General',
                'x-hermes-order': 1,
                'x-hermes-status': 'supported',
              },
              prompt: {
                type: 'string',
                title: 'Prompt',
                description: 'Prompt text sent to the model.',
                examples: ['Summarize the release.'],
                'x-hermes-widget': 'textarea',
                'x-hermes-section': 'General',
                'x-hermes-order': 2,
                'x-hermes-status': 'supported',
              },
            },
          },
        },
      },
    },
    sidecar_schema: {
      type: 'object',
      properties: {
        max_concurrency: {
          type: 'integer',
          minimum: 1,
          maximum: 32,
          default: 4,
          title: 'Maximum concurrency',
          description: 'Maximum concurrent nodes.',
          examples: [4],
          'x-hermes-unit': 'nodes',
          'x-hermes-widget': 'number',
          'x-hermes-section': 'Execution',
          'x-hermes-order': 1,
          'x-hermes-status': 'supported',
        },
      },
    },
    node_kinds: [
      {
        id: 'prompt',
        label: 'Prompt',
        description: 'Prompt node.',
        field_path: 'nodes[].prompt',
        applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: ['prompt'] },
        widget: 'textarea',
        section: 'General',
        order: 1,
        status: 'supported',
        examples: [{ id: 'prepare', prompt: 'Prepare.' }],
        fields: [
          {
            ...baseField,
            id: 'prompt.node.id',
            label: 'Node ID',
            description: 'Unique node identifier.',
            field_path: 'nodes[].id',
            widget: 'text',
            order: 1,
            examples: ['prepare'],
          },
          baseField,
        ],
      },
    ],
    semantic_rules: [],
    compatibility_codes: {},
    documentation: { topics: [], examples: [] },
    limits: { max_document_bytes: 2 * 1024 * 1024 },
    extensions: {},
    ...overrides,
  }
}

describe('schema-driven widget registry', () => {
  it('provides exactly one compatible documented widget for every production contract field', async () => {
    const contracts = await loadBundledAuthoringContracts()
    expect(contracts.map(({ profile }) => profile)).toEqual(['archon-2026-07', 'hermes-legacy'])
    for (const productionContract of contracts) {
      expect(validateContractFormCoverage(productionContract), productionContract.profile).toEqual([])
    }
  })

  it('normalizes requiredness, explicit defaults, constraints, units, and path templates from schema annotations', () => {
    const fields = collectContractFields(contract())

    expect(fields.find(({ fieldPath }) => fieldPath === 'name')).toEqual(
      expect.objectContaining({
        required: true,
        hasDefault: false,
        constraints: expect.objectContaining({ minLength: 1 }),
        pathTemplate: ['name'],
      }),
    )
    expect(fields.find(({ fieldPath }) => fieldPath === 'sidecar.max_concurrency')).toEqual(
      expect.objectContaining({
        document: 'companion',
        required: false,
        hasDefault: true,
        defaultValue: 4,
        unit: 'nodes',
        constraints: expect.objectContaining({ minimum: 1, maximum: 32 }),
      }),
    )
    expect(fields.find(({ fieldPath }) => fieldPath === 'nodes[].id')).toEqual(
      expect.objectContaining({ pathTemplate: ['nodes', '$node', 'id'], required: true, hasDefault: true }),
    )
  })

  it.each(['text', 'textarea', 'code', 'number', 'boolean', 'enum', 'array', 'map', 'object', 'json-schema'])(
    'resolves the supported %s widget without a raw fallback',
    (widget) => {
      expect(resolveWidget({ ...baseField, widget }).ok).toBe(true)
    },
  )

  it('fails closed for an unsupported loaded widget and leaves mutation disabled', () => {
    expect(resolveWidget({ ...baseField, widget: 'future-control' })).toEqual({
      ok: false,
      code: 'contract_reader_unsupported_widget',
      message: 'Workflow Studio does not support the contract widget "future-control".',
    })
  })

  it('rejects descriptor/schema mismatches and blank documentation', () => {
    const invalid = contract({
      node_kinds: [
        {
          ...contract().node_kinds[0]!,
          fields: [{ ...baseField, description: ' ', examples: [] }],
        },
      ],
    })

    expect(validateContractFormCoverage(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'field_documentation_missing', fieldPath: 'nodes[].prompt' }),
      ]),
    )
  })

  it('rejects duplicate normalized field paths/orders in one applicability scope', () => {
    const duplicate = { ...baseField, id: 'prompt.node.prompt-copy' }
    const invalid = contract({
      node_kinds: [{ ...contract().node_kinds[0]!, fields: [baseField, duplicate] }],
    })

    expect(validateContractFormCoverage(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'field_path_duplicate', fieldPath: 'nodes[].prompt' }),
        expect.objectContaining({ code: 'field_order_duplicate', fieldPath: 'nodes[].prompt' }),
      ]),
    )
  })
})
