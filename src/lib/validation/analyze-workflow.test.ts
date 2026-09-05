import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import archonCorpusText from '../../../contracts/archon-2026-07-v6.corpus.json?raw'
import legacyContractText from '../../../contracts/hermes-legacy-v2.json?raw'
import legacyCorpusText from '../../../contracts/hermes-legacy-v2.corpus.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import { scopedDagCapabilityBuildCountForTest } from '$src/lib/contract/scoped-dag-rule'
import { loadConformanceCorpus } from '$src/lib/contract/conformance'
import type {
  AuthoringContract,
  FieldDescriptor,
  NodeKindDescriptor,
  SemanticRuleDescriptor,
  WorkflowProfile,
} from '$src/lib/contract/types'
import type { ContractDigest } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import {
  preparedReferenceContractBuildCountForTest,
  referenceIndexBuildCountForTest,
} from '$src/lib/references/reference-index'
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

function corpusPathToPointer(path: string): string {
  const normalized = path.startsWith('sidecar.') ? path.slice('sidecar.'.length) : path
  return `/${normalized
    .replace(/\[([0-9]+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`
}

function structuredArrayReference(maxItems: string, index: string): string {
  return [
    'name: Large schema integer',
    'description: Preserve authored numeric meaning.',
    'nodes:',
    '  - id: producer',
    '    prompt: Produce.',
    '    output_format:',
    '      type: array',
    `      maxItems: ${maxItems}`,
    '      items: {type: string}',
    '  - id: consumer',
    '    depends_on: [producer]',
    `    prompt: Use $producer.output.${index}`,
    '',
  ].join('\n')
}

function isCorpusDiagnostic(value: unknown): value is { readonly code: string; readonly path: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { path?: unknown }).path === 'string'
  )
}

function classifyCorpusFeature(feature: string): 'validation' | 'projection' | undefined {
  const prefix = feature.split(':', 1)[0]
  if (prefix === 'projection') return 'projection'
  if (
    prefix === 'boundary' ||
    prefix === 'field-family' ||
    prefix === 'invalid' ||
    prefix === 'legacy' ||
    prefix === 'mode' ||
    prefix === 'node-kind' ||
    prefix === 'ordering' ||
    prefix === 'preservation' ||
    prefix === 'provenance' ||
    prefix === 'reference' ||
    prefix === 'schema-proof' ||
    prefix === 'scope' ||
    prefix === 'surface'
  )
    return 'validation'
  return undefined
}

describe('workflow pair analysis', () => {
  it.each([
    ['archon-2026-07-v6.json', archonContractText, archonCorpusText],
    ['hermes-legacy-v2.json', legacyContractText, legacyCorpusText],
  ])('matches every literal Hermes conformance case in %s', async (identifier, contractText, corpusText) => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(contractText), {
      kind: 'bundled',
      identifier,
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const corpus = loadConformanceCorpus(new TextEncoder().encode(corpusText), loaded.contract)
    const mismatches: {
      id: string
      expectedValid: boolean
      expectedDiagnostics: readonly { code: string; path: string }[]
      actualDiagnostics: readonly { code: string; path: string }[]
    }[] = []
    const featureTags = new Set<string>()
    const unclassifiedFeatureTags = new Set<string>()
    const primarySinkFindings: string[] = []

    for (const testCase of corpus.cases) {
      const analysis = await analyzeWorkflowPair(
        request(loaded.contract, testCase.definitionYaml, testCase.companionYaml ?? null),
        loaded.contract,
      )
      for (const feature of testCase.features) {
        featureTags.add(feature)
        if (!classifyCorpusFeature(feature)) unclassifiedFeatureTags.add(feature)
      }
      if (testCase.features.includes('projection:primary-sink')) {
        const projection = analysis.projection as WorkflowProjection | undefined
        const body = projection?.graphs.find(({ scope }) => scope.kind === 'loop-group')
        const terminals = body?.definitionOrder.filter((nodeId) => !body.edges.some(({ source }) => source === nodeId))
        if (!body || body.primarySinkId !== terminals?.[0]) primarySinkFindings.push(testCase.id)
      }

      const expectedDiagnostics = testCase.diagnostics.map((diagnostic) => {
        if (!isCorpusDiagnostic(diagnostic)) throw new Error(`Invalid diagnostic in ${testCase.id}.`)
        return { code: diagnostic.code, path: corpusPathToPointer(diagnostic.path) }
      })
      const expectedCodeSet = new Set(testCase.codes)
      const actualDiagnostics = analysis.issues
        .filter((issue) => issue.blocking || expectedCodeSet.has(issue.code))
        .map(({ code, path }) => ({ code, path: path ?? '/' }))
      if (
        analysis.structurallyValid !== testCase.valid ||
        JSON.stringify(actualDiagnostics) !== JSON.stringify(expectedDiagnostics)
      ) {
        mismatches.push({ id: testCase.id, expectedValid: testCase.valid, expectedDiagnostics, actualDiagnostics })
      }
    }

    expect(mismatches).toEqual([])
    expect([...unclassifiedFeatureTags]).toEqual([])
    expect(primarySinkFindings).toEqual([])
    if (loaded.contract.profile === 'archon-2026-07') {
      expect(featureTags.size).toBe(70)
      expect(new Set([...featureTags].map((feature) => feature.split(':', 1)[0])).size).toBe(13)
      expect([...featureTags].filter((feature) => feature === 'projection:primary-sink')).toHaveLength(1)
    }
  })

  it('builds one prepared reader capability and one reference index for one multi-scope analysis', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const beforePrepared = preparedReferenceContractBuildCountForTest()
    const beforeIndexes = referenceIndexBuildCountForTest()
    const beforeCapabilities = scopedDagCapabilityBuildCountForTest()
    const definition = [
      'name: Indexed analysis',
      'description: One traversal across several scopes.',
      'nodes:',
      '  - id: root',
      '    prompt: Produce.',
      '  - id: first',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: child',
      '          prompt: Work.',
      '  - id: second',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: child',
      '          prompt: Work.',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(referenceIndexBuildCountForTest() - beforeIndexes).toBe(1)
    expect(preparedReferenceContractBuildCountForTest() - beforePrepared).toBe(1)
    expect(scopedDagCapabilityBuildCountForTest() - beforeCapabilities).toBe(1)
    expect(analysis.referenceIndex).toMatchObject({
      metrics: { indexBuilds: 1, definitionTraversals: 1, graphVisits: 3, nodeVisits: 5 },
    })
    expect(() => structuredClone(analysis.referenceIndex)).not.toThrow()
  })

  it('keeps two invalid references in one authored field as distinct diagnostics', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Repeated references',
      'description: Preserve both authored occurrences.',
      'nodes:',
      '  - id: consumer',
      '    prompt: Use $missing.output and $missing.output',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ code }) => code === 'output_reference_not_declared_dependency')).toHaveLength(2)
  })

  it('fails safely at the authored schema field when YAML integer precision is lost', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = structuredArrayReference('9007199254740993', '9007199254740992')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_authoring_integer_precision',
        blocking: true,
        path: '/nodes/0/output_format/maxItems',
      }),
    )
    expect(analysis.issues.some(({ code }) => code === 'structured_output_field_impossible')).toBe(false)
  })

  it.each([
    ['decimal', '9007199254740992'],
    ['hexadecimal', '0x20000000000000'],
  ])('accepts an exactly representable large %s schema bound without a precision diagnostic', async (_label, bound) => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)

    const analysis = await analyzeWorkflowPair(
      request(
        loaded.contract,
        structuredArrayReference(bound, '9007199254740991'),
        'language_compatibility: archon-2026-07\n',
      ),
      loaded.contract,
    )

    expect(analysis.issues.some(({ code }) => code === 'unsupported_authoring_integer_precision')).toBe(false)
    expect(analysis.structurallyValid).toBe(true)
  })

  it.each([
    ['a hexadecimal integer', '0x20000000000001'],
    ['an aliased integer', '*bound'],
  ])('fails safely when %s loses YAML precision', async (_label, maxItems) => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = structuredArrayReference(maxItems, '9007199254740992').replace(
      '      type: array',
      `      type: array\n${maxItems === '*bound' ? '      minItems: &bound 9007199254740993' : ''}`,
    )

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_authoring_integer_precision',
        blocking: true,
        path: '/nodes/0/output_format/maxItems',
      }),
    )
    expect(analysis.issues.some(({ code }) => code === 'structured_output_field_impossible')).toBe(false)
  })

  it('preserves eager root scanner failure precedence over an earlier missing dependency', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Eager root scanner',
      'description: A later malformed candidate wins within the template.',
      'nodes:',
      '  - id: consumer',
      '    prompt: Use $missing.output then $broken.output.',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code }) => code)).toEqual([
      'output_reference_path_unsupported',
    ])
  })

  it('translates an eager body scanner failure without emitting partial dependency diagnostics', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Eager body scanner',
      'description: Scoped callers translate scanner failure.',
      'nodes:',
      '  - id: group',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: consumer',
      '          prompt: Use $missing.output then $broken.output.',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code }) => code)).toEqual([
      'loop_group_scope_invalid',
    ])
  })

  it('keeps references in Bash comments and escaped literals outside validation', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Bash authored context',
      'description: Literal candidates do not become dependencies.',
      'nodes:',
      '  - id: shell',
      '    bash: |',
      '      # $missing.output',
      '      printf "%s" \\$missing.output',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.structurallyValid).toBe(true)
    expect(analysis.issues).toEqual([])
  })

  it('validates root conditions before static references and translates generic syntax failures', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Root condition syntax',
      'description: The scanner owns reader-3 condition parsing.',
      'nodes:',
      '  - id: first',
      '    prompt: $missing.output',
      '  - id: second',
      '    prompt: fine',
      '    when: $first.output ==',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'malformed_condition', path: '/nodes/1/when' },
    ])
  })

  it('translates generic body condition syntax during normalization', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Body condition syntax',
      'description: Scoped condition parsing retains native caller translation.',
      'nodes:',
      '  - id: root',
      '    prompt: $missing.output',
      '  - id: group',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: producer',
      '          prompt: Produce.',
      '        - id: consumer',
      '          depends_on: [producer]',
      '          prompt: Consume.',
      '          when: $producer.output ==',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'loop_group_shape_invalid', path: '/nodes/1/loop_group/nodes/1/when' },
    ])
  })

  it.each([
    ['root', '$producer.output. == 1'],
    ['body', '$producer.output. == 1'],
  ])('preserves the reference-syntax cause from a malformed %s condition', async (scope, when) => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const nodes =
      scope === 'root'
        ? [
            { id: 'producer', prompt: 'Produce.' },
            { id: 'consumer', depends_on: ['producer'], prompt: 'Consume.', when },
          ]
        : [
            {
              id: 'group',
              loop_group: {
                until: 'done',
                max_iterations: 1,
                nodes: [
                  { id: 'producer', prompt: 'Produce.' },
                  { id: 'consumer', depends_on: ['producer'], prompt: 'Consume.', when },
                ],
              },
            },
          ]

    const analysis = await analyzeWorkflowPair(
      request(
        loaded.contract,
        stringify({ name: 'Condition cause', description: 'Preserve nested reference syntax.', nodes }),
        'language_compatibility: archon-2026-07\n',
      ),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code, path }) => ({ code, path }))).toEqual([
      {
        code: scope === 'root' ? 'output_reference_path_unsupported' : 'loop_group_shape_invalid',
        path: scope === 'root' ? '/nodes/1/when' : '/nodes/0/loop_group/nodes/1/when',
      },
    ])
  })

  it('validates condition normalization before root topology', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Condition before topology',
      'description: Normalization stops before DAG validation.',
      'nodes:',
      '  - id: first',
      '    depends_on: [missing]',
      '    prompt: fine',
      '  - id: second',
      '    prompt: fine',
      '    when: $first.output ==',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'malformed_condition', path: '/nodes/1/when' },
    ])
  })

  it('stops before scoped reference validation when root static references fail', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Root before scoped',
      'description: Root static failure ends the reference phase.',
      'nodes:',
      '  - id: first',
      '    prompt: $missing.output',
      '  - id: group',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: child',
      '          prompt: $also_missing.output',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.issues.filter(({ blocking }) => blocking).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'output_reference_not_declared_dependency', path: '/nodes/0/prompt' },
    ])
  })

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
    expect((analysis.projection as WorkflowProjection | undefined)?.graphs[0]?.nodes).toContainEqual(
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

  it('fails closed when an imported allOf enum makes an empty scalar draft impossible', async () => {
    const activeContract = importedComposedContract()
    const definitions = activeContract.definition_schema.$defs as Record<string, Record<string, unknown>>
    definitions.nonEmptyText = {
      allOf: [
        { type: 'string', minLength: 1 },
        { type: 'string', enum: [''] },
      ],
    }

    const analysis = await analyzeWorkflowPair(
      request(
        activeContract,
        'name: Imported\ndescription: Impossible enum draft\nnodes:\n  - id: command\n    command: ""\n',
      ),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
    expect(analysis.issues.map(({ code }) => code)).toContain('schema_min_length')
  })

  it.each([
    ['enum', { type: 'string', minLength: 1, enum: [''] }],
    ['const', { type: 'string', minLength: 1, const: '' }],
  ])('fails closed when an imported inline command %s makes an empty draft impossible', async (_constraint, schema) => {
    const activeContract = importedComposedContract()
    const definitions = activeContract.definition_schema.$defs as Record<string, Record<string, unknown>>
    const commandNode = definitions.commandNode
    if (!commandNode) throw new Error('Expected the imported command node schema.')
    const properties = commandNode.properties as Record<string, unknown>
    properties.command = schema

    const analysis = await analyzeWorkflowPair(
      request(
        activeContract,
        'name: Imported\ndescription: Impossible inline command draft\nnodes:\n  - id: command\n    command: ""\n',
      ),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
  })

  it('fails closed when a structured child has an impossible inline required scalar', async () => {
    const activeContract = importedComposedContract()
    const definitions = activeContract.definition_schema.$defs as Record<string, Record<string, unknown>>
    const loopNode = definitions.loopNode
    if (!loopNode) throw new Error('Expected the imported loop node schema.')
    const properties = loopNode.properties as Record<string, unknown>
    properties.loop = {
      type: 'object',
      properties: { over: { type: 'string', minLength: 1, enum: [''] } },
      required: ['over'],
      additionalProperties: false,
    }

    const analysis = await analyzeWorkflowPair(
      request(
        activeContract,
        'name: Imported\ndescription: Impossible loop draft\nnodes:\n  - id: loop\n    loop: {}\n',
      ),
      activeContract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
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
    })
    expect(projection?.graphs[0]?.nodes).toEqual([
      expect.objectContaining({ id: 'prepare', kind: 'command', value: 'Prepare input', dependsOn: [], options: {} }),
      expect.objectContaining({
        id: 'finish',
        kind: 'prompt',
        value: 'Summarize $prepare.output',
        dependsOn: ['prepare'],
        options: {},
      }),
    ])
    expect(projection?.graphs[0]?.edges).toEqual([
      expect.objectContaining({ id: 'dependency:prepare->finish', source: 'prepare', target: 'finish' }),
    ])
    expect(projection?.graphs[0]?.nodes[0]?.source.path).toBe('/nodes/0')
    expect(projection?.graphs[0]?.nodes[0]?.source.start).toBe(validMinimal.indexOf('id: prepare'))
    expect(projection?.definition).not.toBe(activeContract.definition_schema)
    expect(Object.isFrozen(projection?.graphs[0]?.nodes[0])).toBe(true)
    expect(Object.isFrozen(projection?.graphs[0]?.edges[0])).toBe(true)
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

  it('returns only the explicit empty loop-group draft as a repairable scoped projection', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Empty group',
      'description: Repair this group visually.',
      'nodes:',
      '  - id: group',
      '    loop_group:',
      '      nodes: []',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false, visuallyAuthorable: true })
    expect((analysis.projection as WorkflowProjection | undefined)?.graphs).toHaveLength(2)
    expect(analysis.issues.map(({ code }) => code)).toEqual(['loop_group_shape_invalid'])
  })

  it('keeps a valid populated group authorable beside one explicit empty group draft', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Mixed groups',
      'description: Repair only the empty group visually.',
      'nodes:',
      '  - id: populated',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: work',
      '          prompt: Work.',
      '  - id: empty',
      '    loop_group:',
      '      nodes: []',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false, visuallyAuthorable: true })
    expect((analysis.projection as WorkflowProjection | undefined)?.graphs).toHaveLength(3)
    expect(analysis.issues).toEqual([expect.objectContaining({ code: 'loop_group_shape_invalid', groupId: 'empty' })])
  })

  it('does not let an empty group draft mask a separate invalid nonempty group', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Invalid mixed groups',
      'description: Keep the nonempty invalid group blocking.',
      'nodes:',
      '  - id: empty',
      '    loop_group: {}',
      '  - id: invalid',
      '    loop_group:',
      '      until: done',
      '      max_iterations: 1',
      '      nodes:',
      '        - id: nested',
      '          loop_group:',
      '            until: done',
      '            max_iterations: 1',
      '            nodes:',
      '              - id: work',
      '                prompt: Work.',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
    expect(analysis.issues).toContainEqual(
      expect.objectContaining({ code: 'loop_group_shape_invalid', groupId: 'invalid' }),
    )
  })

  it('does not make an arbitrary invalid loop-group shape visually authorable', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Invalid group',
      'description: This is not the explicit empty draft.',
      'nodes:',
      '  - id: group',
      '    loop_group:',
      '      nodes: not-a-list',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis).toMatchObject({ structurallyValid: false })
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
  })

  it.each([0, 101])('rejects loop-group max_iterations at the out-of-contract boundary %i', async (iterations) => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const definition = [
      'name: Invalid iterations',
      'description: Reject the numeric boundary.',
      'nodes:',
      '  - id: group',
      '    loop_group:',
      '      until: done',
      `      max_iterations: ${iterations}`,
      '      nodes:',
      '        - id: work',
      '          prompt: Work.',
      '',
    ].join('\n')

    const analysis = await analyzeWorkflowPair(
      request(loaded.contract, definition, 'language_compatibility: archon-2026-07\n'),
      loaded.contract,
    )

    expect(analysis.structurallyValid).toBe(false)
    expect(analysis.visuallyAuthorable).not.toBe(true)
    expect(analysis.projection).toBeUndefined()
  })
})
