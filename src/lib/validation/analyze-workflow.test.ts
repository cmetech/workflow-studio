import { describe, expect, it } from 'vitest'
import type {
  AuthoringContract,
  FieldDescriptor,
  NodeKindDescriptor,
  SemanticRuleDescriptor,
  WorkflowProfile,
} from '$src/lib/contract/types'
import type { ContractDigest } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import type { AnalyzeDocumentRequest } from '$src/workers/document-worker-protocol'
import invalidCycle from '../../../tests/fixtures/workflows/invalid-cycle.yaml?raw'
import invalidReference from '../../../tests/fixtures/workflows/invalid-reference.yaml?raw'
import validMinimal from '../../../tests/fixtures/workflows/valid-minimal.yaml?raw'
import { analyzeWorkflowPair } from './analyze-workflow'
import { compiledContractValidatorCountForTest } from './schema-validator'

let digestNumber = 100

function applicability(profile: WorkflowProfile) {
  return { profiles: [profile], documents: ['definition'] as const }
}

function kindDescriptor(profile: WorkflowProfile, id: string): NodeKindDescriptor {
  const field: FieldDescriptor = {
    id: `node-${id}-value`,
    label: `${id} value`,
    description: `Value for the ${id} node kind.`,
    field_path: `nodes[].${id}`,
    applicability: { ...applicability(profile), node_kinds: [id] },
    widget: 'multiline',
    section: 'general',
    order: 1,
    status: 'supported',
    examples: [],
  }

  return {
    ...field,
    id,
    label: id,
    description: `${id} node`,
    fields: [field],
  }
}

function importedComposedContract(): AuthoringContract {
  const activeContract = contract('hermes-legacy')
  activeContract.node_kinds = [
    kindDescriptor(activeContract.profile, 'command'),
    kindDescriptor(activeContract.profile, 'prompt'),
    kindDescriptor(activeContract.profile, 'loop'),
  ]
  activeContract.definition_schema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      nodes: { $ref: '#/$defs/nodeList' },
    },
    required: ['name', 'description', 'nodes'],
    additionalProperties: false,
    $defs: {
      nodeList: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/$defs/node' },
      },
      node: {
        oneOf: [
          { allOf: [{ $ref: '#/$defs/commonNode' }, { $ref: '#/$defs/commandNode' }] },
          { allOf: [{ $ref: '#/$defs/commonNode' }, { $ref: '#/$defs/promptNode' }] },
          { allOf: [{ $ref: '#/$defs/commonNode' }, { $ref: '#/$defs/loopNode' }] },
        ],
      },
      id: { type: 'string', minLength: 1 },
      dependencies: { type: 'array', items: { $ref: '#/$defs/id' } },
      nonEmptyText: { type: 'string', minLength: 1 },
      loopConfig: {
        type: 'object',
        properties: { over: { $ref: '#/$defs/nonEmptyText' } },
        required: ['over'],
        additionalProperties: false,
      },
      commonNode: {
        type: 'object',
        properties: {
          id: { $ref: '#/$defs/id' },
          depends_on: { $ref: '#/$defs/dependencies' },
        },
        required: ['id'],
      },
      commandNode: {
        type: 'object',
        properties: {
          id: { $ref: '#/$defs/id' },
          depends_on: { $ref: '#/$defs/dependencies' },
          command: { $ref: '#/$defs/nonEmptyText' },
        },
        required: ['command'],
        additionalProperties: false,
      },
      promptNode: {
        type: 'object',
        properties: {
          id: { $ref: '#/$defs/id' },
          depends_on: { $ref: '#/$defs/dependencies' },
          prompt: { $ref: '#/$defs/nonEmptyText' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      loopNode: {
        type: 'object',
        properties: {
          id: { $ref: '#/$defs/id' },
          depends_on: { $ref: '#/$defs/dependencies' },
          loop: { $ref: '#/$defs/loopConfig' },
        },
        required: ['loop'],
        additionalProperties: false,
      },
    },
  }
  return activeContract
}

function semanticRules(profile: WorkflowProfile): readonly SemanticRuleDescriptor[] {
  return [
    {
      id: 'workflow-dag-v1',
      label: 'Workflow DAG',
      description: 'Defines the contract-owned node and dependency fields.',
      field_paths: ['nodes'],
      applicability: applicability(profile),
      status: 'supported',
      parameters: { nodes_path: 'nodes', id_field: 'id', dependencies_field: 'depends_on' },
      examples: [],
    },
    {
      id: 'hermes-output-reference-v1',
      label: 'Output references',
      description: 'Output references must name upstream nodes.',
      field_paths: ['nodes[].prompt'],
      applicability: { ...applicability(profile), node_kinds: ['prompt'] },
      status: 'supported',
      parameters: { syntax: '$ID.output(.path)*', require_upstream: true },
      examples: ['$prepare.output'],
    },
  ]
}

function contract(profile: WorkflowProfile): AuthoringContract {
  digestNumber += 1
  const nodeProperties = {
    id: { type: 'string', minLength: 1 },
    depends_on: { type: 'array', items: { type: 'string', minLength: 1 } },
    command: { type: 'string' },
    prompt: { type: 'string' },
  }

  return {
    schema_version: 1,
    contract_reader_version: 1,
    profile,
    normalizer_version: 1,
    contract_digest: `sha256:${digestNumber.toString(16).padStart(64, '0')}`,
    definition_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        nodes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: nodeProperties,
            required: ['id'],
            additionalProperties: false,
          },
        },
        future_mode: {
          type: 'boolean',
          'x-hermes-status': 'deferred',
          'x-hermes-compatibility-code': 'future_mode_deferred',
        },
      },
      required: ['name', 'description', 'nodes'],
      additionalProperties: profile === 'hermes-legacy',
    },
    sidecar_schema: {
      type: 'object',
      properties: {
        language_compatibility: { enum: ['hermes-legacy', 'archon-2026-07'] },
      },
      additionalProperties: false,
    },
    node_kinds: [kindDescriptor(profile, 'command'), kindDescriptor(profile, 'prompt')],
    semantic_rules: semanticRules(profile),
    compatibility_codes: {
      future_mode_deferred: {
        status: 'deferred',
        description: 'Future mode is not available to the runtime yet.',
      },
    },
    documentation: { topics: [], examples: [] },
    limits: { max_document_bytes: 2 * 1024 * 1024 },
    extensions: {},
  }
}

function request(
  activeContract: AuthoringContract,
  definition: string,
  companion: string | null = null,
): AnalyzeDocumentRequest {
  return {
    type: 'analyze',
    requestId: 'analysis-fixture',
    workflowId: 'fixture',
    pairGeneration: 2,
    definition: { path: 'fixture.yaml', text: definition, revision: 7 },
    companion: companion === null ? null : { path: 'fixture.hermes.yaml', text: companion, revision: 4 },
    profile: activeContract.profile,
    contractDigest: activeContract.contract_digest as ContractDigest,
    reason: 'explicit-validate',
  }
}

describe('workflow pair analysis', () => {
  it.each([
    ['a scalar kind draft', '  - id: command\n    command: ""\n', 'command'],
    ['an object kind draft', '  - id: loop\n    loop: {}\n', 'loop'],
  ])('recognizes %s through imported local refs and allOf composition', async (_case, nodes, kind) => {
    const activeContract = importedComposedContract()

    const analysis = await analyzeWorkflowPair(
      request(activeContract, `name: Imported\ndescription: Composed contract\nnodes:\n${nodes}`),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false, visuallyAuthorable: true })
    expect((analysis.projection as WorkflowProjection | undefined)?.nodes).toContainEqual(
      expect.objectContaining({ id: kind, kind }),
    )
  })

  it.each([
    ['an unknown node field', '  - id: command\n    command: ""\n    surprise: true\n', 'schema_additional_properties'],
    [
      'duplicate node identifiers',
      '  - id: same\n    command: echo\n  - id: same\n    prompt: hello\n',
      'duplicate_node_id',
    ],
    [
      'an unresolved dependency',
      '  - id: command\n    command: echo\n    depends_on: [missing]\n',
      'missing_dependency',
    ],
    [
      'a dependency cycle',
      '  - id: first\n    command: echo\n    depends_on: [second]\n  - id: second\n    prompt: hello\n    depends_on: [first]\n',
      'dependency_cycle',
    ],
  ])('keeps imported composed contracts fail-closed for %s', async (_case, nodes, issueCode) => {
    const activeContract = importedComposedContract()

    const analysis = await analyzeWorkflowPair(
      request(activeContract, `name: Imported\ndescription: Composed contract\nnodes:\n${nodes}`),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
    expect(analysis.issues.map(({ code }) => code)).toContain(issueCode)
  })

  it('fails closed when an imported contract uses a remote schema reference', async () => {
    const activeContract = importedComposedContract()
    const definitions = activeContract.definition_schema.$defs as Record<string, Record<string, unknown>>
    definitions.nonEmptyText = { $ref: 'https://attacker.invalid/schema.json' }

    const analysis = await analyzeWorkflowPair(
      request(activeContract, 'name: Imported\ndescription: Remote ref\nnodes:\n  - id: command\n    command: ""\n'),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
    expect(analysis.issues.map(({ code }) => code)).toContain('contract_schema_invalid')
  })

  it('fails closed when an imported allOf scalar conjunction is contradictory', async () => {
    const activeContract = importedComposedContract()
    const definitions = activeContract.definition_schema.$defs as Record<string, Record<string, unknown>>
    definitions.nonEmptyText = {
      allOf: [
        { type: 'string', minLength: 2 },
        { type: 'string', maxLength: 1 },
      ],
    }

    const analysis = await analyzeWorkflowPair(
      request(
        activeContract,
        'name: Imported\ndescription: Contradictory scalar\nnodes:\n  - id: command\n    command: ""\n',
      ),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
    expect(analysis.issues.map(({ code }) => code)).toContain('schema_min_length')
  })

  it('fails closed when an imported allOf object conjunction forbids its required kind field', async () => {
    const activeContract = importedComposedContract()
    const definitions = activeContract.definition_schema.$defs as Record<string, Record<string, unknown>>
    definitions.commonNode = {
      type: 'object',
      properties: { id: { $ref: '#/$defs/id' } },
      required: ['id'],
      additionalProperties: false,
    }

    const analysis = await analyzeWorkflowPair(
      request(
        activeContract,
        'name: Imported\ndescription: Contradictory object\nnodes:\n  - id: command\n    command: publish\n',
      ),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
    expect(analysis.issues.map(({ code }) => code)).toContain('schema_additional_properties')
  })

  it('keeps validator compilation bounded to one stable entry while draft subsets change', async () => {
    const activeContract = contract('hermes-legacy')
    const nodesSchema = (activeContract.definition_schema.properties as Record<string, { items?: unknown }>).nodes
    if (!nodesSchema || !nodesSchema.items) throw new Error('Expected the test node schema.')
    const nodeSchema = (nodesSchema.items as { properties: Record<string, Record<string, unknown>> }).properties
    nodeSchema.command = { type: 'string', minLength: 1 }
    nodeSchema.prompt = { type: 'string', minLength: 1 }
    const before = compiledContractValidatorCountForTest()
    const definitions = [
      '  - id: command\n    command: ""\n',
      '  - id: prompt\n    prompt: ""\n',
      '  - id: command\n    command: ""\n  - id: prompt\n    prompt: ""\n',
    ]

    for (const nodes of definitions) {
      const analysis = await analyzeWorkflowPair(
        request(activeContract, `name: Drafts\ndescription: Cache bound\nnodes:\n${nodes}`),
        activeContract,
      )
      expect(analysis).toMatchObject({ structurallyValid: false, visuallyAuthorable: true })
    }

    expect(compiledContractValidatorCountForTest() - before).toBe(1)
  })

  it('selects legacy without a companion and returns a contract-driven immutable DAG projection', async () => {
    const activeContract = contract('hermes-legacy')

    const analysis = await analyzeWorkflowPair(request(activeContract, validMinimal), activeContract)
    const projection = analysis.projection as WorkflowProjection | undefined

    expect(analysis).toMatchObject({
      workflowId: 'fixture',
      pairGeneration: 2,
      definitionRevision: 7,
      companionRevision: null,
      contractDigest: activeContract.contract_digest,
      issues: [],
      structurallyValid: true,
    })
    expect(projection).toMatchObject({
      name: 'Minimal workflow',
      description: 'A deliberately small valid DAG fixture.',
      profile: 'hermes-legacy',
      companion: null,
      nodes: [
        { id: 'prepare', kind: 'command', value: 'Prepare input', dependsOn: [], options: {} },
        {
          id: 'finish',
          kind: 'prompt',
          value: 'Summarize $prepare.output',
          dependsOn: ['prepare'],
          options: {},
        },
      ],
      edges: [{ id: 'dependency:prepare->finish', source: 'prepare', target: 'finish' }],
    })
    expect(projection?.nodes[0]?.source.path).toBe('/nodes/0')
    expect(projection?.nodes[0]?.source.start).toBe(validMinimal.indexOf('id: prepare'))
    expect(projection?.definition).not.toBe(activeContract.definition_schema)
    expect(Object.isFrozen(projection?.nodes[0])).toBe(true)
    expect(Object.isFrozen(projection?.edges[0])).toBe(true)
  })

  it('rejects an Archon contract when the missing companion selects legacy', async () => {
    const activeContract = contract('archon-2026-07')

    const analysis = await analyzeWorkflowPair(request(activeContract, validMinimal), activeContract)

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({ code: 'contract_profile_mismatch', layer: 'contract', blocking: true }),
    )
    expect(analysis.structurallyValid).toBe(false)
    expect(analysis.projection).toBeUndefined()
  })

  it('rejects an explicit companion profile that differs from the registered contract', async () => {
    const activeContract = contract('hermes-legacy')

    const analysis = await analyzeWorkflowPair(
      request(activeContract, validMinimal, 'language_compatibility: archon-2026-07\n'),
      activeContract,
    )

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({
        code: 'contract_profile_mismatch',
        document: 'companion',
        path: '/language_compatibility',
        blocking: true,
      }),
    )
    expect(analysis.projection).toBeUndefined()
  })

  it('rejects any unrecognized explicit companion profile instead of treating it as legacy', async () => {
    const activeContract = contract('hermes-legacy')

    const analysis = await analyzeWorkflowPair(
      request(activeContract, validMinimal, 'language_compatibility: future-profile\n'),
      activeContract,
    )

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({ code: 'contract_profile_mismatch', document: 'companion', blocking: true }),
    )
    expect(analysis.projection).toBeUndefined()
  })

  it.each([
    ['a dependency cycle', invalidCycle, 'dependency_cycle'],
    ['a missing output reference', invalidReference, 'missing_reference'],
  ])('blocks projection for %s', async (_case, definition, expectedCode) => {
    const activeContract = contract('hermes-legacy')

    const analysis = await analyzeWorkflowPair(request(activeContract, definition), activeContract)

    expect(analysis.issues.map(({ code }) => code)).toContain(expectedCode)
    expect(analysis.structurallyValid).toBe(false)
    expect(analysis.projection).toBeUndefined()
  })

  it('requires exactly one node-kind field from the applicable contract descriptors', async () => {
    const activeContract = contract('hermes-legacy')
    const definition = validMinimal.replace(
      '    command: Prepare input',
      '    command: Prepare input\n    prompt: Also prompt',
    )

    const analysis = await analyzeWorkflowPair(request(activeContract, definition), activeContract)

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({ code: 'multiple_node_kinds', nodeId: 'prepare', blocking: true }),
    )
    expect(analysis.projection).toBeUndefined()
  })

  it('keeps compatibility annotations non-blocking and makes no runtime-availability inference', async () => {
    const activeContract = contract('hermes-legacy')
    const definition = `future_mode: true\n${validMinimal}`

    const analysis = await analyzeWorkflowPair(request(activeContract, definition), activeContract)

    expect(analysis.issues).toEqual([
      expect.objectContaining({
        code: 'future_mode_deferred',
        layer: 'compatibility',
        blocking: false,
      }),
    ])
    expect(analysis.issues.some(({ layer }) => layer === 'operational')).toBe(false)
    expect(analysis.structurallyValid).toBe(true)
    expect(analysis.projection).toBeDefined()
  })

  it('projects a deferred contract node kind with a non-blocking compatibility issue', async () => {
    const baseContract = contract('hermes-legacy')
    const activeContract: AuthoringContract = {
      ...baseContract,
      node_kinds: baseContract.node_kinds.map((descriptor) =>
        descriptor.id === 'command' ? { ...descriptor, status: 'deferred' as const } : descriptor,
      ),
    }

    const analysis = await analyzeWorkflowPair(request(activeContract, validMinimal), activeContract)

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({ code: 'node_kind_deferred', layer: 'compatibility', blocking: false }),
    )
    expect(analysis.structurallyValid).toBe(true)
    expect(analysis.projection).toBeDefined()
  })

  it('returns syntax diagnostics without materializing or projecting invalid YAML', async () => {
    const activeContract = contract('hermes-legacy')

    const analysis = await analyzeWorkflowPair(request(activeContract, 'name: "unterminated\n'), activeContract)

    expect(analysis.issues[0]).toEqual(expect.objectContaining({ layer: 'syntax', blocking: true }))
    expect(analysis.structurallyValid).toBe(false)
    expect(analysis.projection).toBeUndefined()
  })
})
