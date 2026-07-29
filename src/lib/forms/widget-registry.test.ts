import { describe, expect, it } from 'vitest'
import type { AuthoringContract, FieldDescriptor } from '$src/lib/contract/types'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import {
  collectContractFields,
  fieldsForNode,
  materializeFormFields,
  resolveWidget,
  validateContractFormCoverage,
} from './widget-registry'

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

  it('fails closed when a known widget is incompatible with the published schema shape', () => {
    const field = collectContractFields(contract()).find(({ fieldPath }) => fieldPath === 'name')!

    expect(resolveWidget({ ...field, schema: { type: 'array', items: { type: 'string' } } })).toEqual({
      ok: false,
      code: 'contract_reader_unsupported_widget',
      message: 'Workflow Studio cannot safely render the contract widget "text" for name.',
    })
  })

  it('fails closed for object unions that the recursive editor cannot safely represent', () => {
    const field = collectContractFields(contract()).find(({ fieldPath }) => fieldPath === 'name')!

    expect(
      resolveWidget({
        ...field,
        widget: 'object',
        schema: {
          oneOf: [{ type: 'object', properties: { value: { type: 'string' } } }, { not: { type: 'null' } }],
        },
      }),
    ).toEqual({
      ok: false,
      code: 'contract_reader_unsupported_widget',
      message: 'Workflow Studio cannot safely render the contract widget "object" for name.',
    })
  })

  it('fails closed when a structured schema publishes a validation keyword the local editor does not implement', () => {
    const field = collectContractFields(contract()).find(({ fieldPath }) => fieldPath === 'name')!

    expect(
      resolveWidget({
        ...field,
        widget: 'object',
        schema: { type: 'object', unevaluatedProperties: false },
      }),
    ).toEqual(expect.objectContaining({ ok: false, code: 'contract_reader_unsupported_widget' }))
  })

  it('accepts each supported production union only when all of its branches are recursively editable', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const fields = fieldsForNode(productionContract, 'command')

    for (const fieldPath of ['nodes[].thinking', 'nodes[].hooks.*[].response.hookSpecificOutput']) {
      const field = fields.find((candidate) => candidate.fieldPath === fieldPath)
      expect(field?.schema.oneOf, fieldPath).toHaveLength(2)
      expect(resolveWidget(field!), fieldPath).toEqual(expect.objectContaining({ ok: true }))
    }
  })

  it('marks every production branch-required node field as required and non-removable', async () => {
    const expectedRequired = {
      command: ['id', 'command'],
      prompt: ['id', 'prompt'],
      bash: ['id', 'bash'],
      script: ['id', 'script', 'runtime'],
      loop: ['id', 'loop'],
      approval: ['id', 'approval'],
      cancel: ['id', 'cancel'],
    } as const

    for (const productionContract of await loadBundledAuthoringContracts()) {
      for (const [nodeKind, names] of Object.entries(expectedRequired)) {
        const nodeFields = collectContractFields(productionContract).filter((field) =>
          field.nodeKinds?.includes(nodeKind),
        )
        for (const name of names) {
          expect(
            nodeFields.find(({ fieldPath }) => fieldPath === `nodes[].${name}`),
            `${productionContract.profile}:${nodeKind}:${name}`,
          ).toEqual(expect.objectContaining({ required: true }))
        }
      }
    }
  })

  it('marks nested properties required by the selected production union branch as required', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const hookEventName = fieldsForNode(productionContract, 'command').find(
      ({ fieldPath }) => fieldPath === 'nodes[].hooks.*[].response.hookSpecificOutput.hookEventName',
    )

    expect(hookEventName).toEqual(expect.objectContaining({ required: true }))
  })

  it('uses distinct context wildcards for nested map and array descriptors', async () => {
    const [productionContract] = await loadBundledAuthoringContracts()
    const fields = collectContractFields(productionContract!)

    expect(fields.find(({ fieldPath }) => fieldPath === 'nodes[].agents.*.description')?.pathTemplate).toEqual([
      'nodes',
      '$node',
      'agents',
      '*',
      'description',
    ])
    expect(fields.find(({ fieldPath }) => fieldPath === 'nodes[].hooks.*[].matcher')?.pathTemplate).toEqual([
      'nodes',
      '$node',
      'hooks',
      '*',
      '*',
      'matcher',
    ])
  })

  it('materializes nested and wildcard production descriptors against a selected YAML node context', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'hermes-legacy',
    )!
    const collected = fieldsForNode(productionContract, 'prompt')
    expect(collected.find(({ fieldPath }) => fieldPath === 'nodes[].retry.max_attempts')).toBeDefined()
    expect(collected.find(({ fieldPath }) => fieldPath === 'nodes[].agents.*.description')).toBeDefined()

    const materialized = materializeFormFields(
      collected,
      {
        nodes: [
          {
            id: 'review',
            prompt: 'Review.',
            retry: { max_attempts: 2 },
            agents: { reviewer: { description: 'Review the result.', prompt: 'Check it.' } },
          },
        ],
      },
      0,
    )

    expect(materialized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'nodes[].retry.max_attempts',
          label: 'Retry Max attempts',
          concretePath: ['nodes', 0, 'retry', 'max_attempts'],
        }),
        expect.objectContaining({
          fieldPath: 'nodes[].agents.*.description',
          label: 'Agents Reviewer Description',
          concretePath: ['nodes', 0, 'agents', 'reviewer', 'description'],
        }),
      ]),
    )
  })

  it('keeps every production wildcard descriptor reachable through a recursively editable structured ancestor', async () => {
    const structuredWidgets = new Set(['array', 'map', 'object'])

    for (const productionContract of await loadBundledAuthoringContracts()) {
      for (const nodeKind of productionContract.node_kinds) {
        const fields = fieldsForNode(productionContract, nodeKind.id)
        for (const field of fields) {
          const wildcardIndex = field.pathTemplate.indexOf('*')
          if (wildcardIndex < 0) continue
          const ancestorPath = field.pathTemplate.slice(0, wildcardIndex)
          expect(
            fields.some(
              (candidate) =>
                structuredWidgets.has(candidate.widget) &&
                resolveWidget(candidate).ok &&
                candidate.pathTemplate.length === ancestorPath.length &&
                candidate.pathTemplate.every((token, index) => token === ancestorPath[index]),
            ),
            `${productionContract.profile}:${nodeKind.id}:${field.fieldPath}`,
          ).toBe(true)
        }
      }
    }
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
