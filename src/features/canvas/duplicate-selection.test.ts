import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import { createDocumentRevision } from '$src/lib/documents/revisions'
import { applyWorkflowMutation } from '$src/lib/documents/transactions'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { copySelection, duplicateSelection, pasteSelection } from './duplicate-selection'
import { CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH } from './layout-graph'

let contractSerial = 0

function descriptor(id: string, profiles: AuthoringContract['profile'][]): NodeKindDescriptor {
  return {
    id,
    label: id,
    description: `${id} node`,
    field_path: `nodes[].${id}`,
    applicability: { profiles, documents: ['definition'] },
    widget: 'text',
    section: 'general',
    order: 1,
    status: 'supported',
    examples: [],
    fields: [],
  }
}

function fieldDescriptor(
  id: string,
  fieldPath: string,
  profiles: FieldDescriptor['applicability']['profiles'],
): FieldDescriptor {
  return {
    id,
    label: id,
    description: `${id} field`,
    field_path: fieldPath,
    applicability: { profiles, documents: ['definition'] },
    widget: 'text',
    section: 'advanced',
    order: 2,
    status: 'supported',
    examples: [],
  }
}

function contract(
  profile: AuthoringContract['profile'] = 'hermes-legacy',
  additionalProperties = true,
): AuthoringContract {
  contractSerial += 1
  return {
    schema_version: 1,
    contract_reader_version: 1,
    profile,
    normalizer_version: 1,
    contract_digest: `sha256:${contractSerial.toString(16).padStart(64, '0')}`,
    definition_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              depends_on: { type: 'array', items: { type: 'string' } },
              command: { type: 'string' },
              prompt: { type: 'string' },
              legacy_only: { type: 'string' },
            },
            required: ['id'],
            additionalProperties,
          },
        },
      },
      required: ['name', 'description', 'nodes'],
      additionalProperties,
    },
    sidecar_schema: { type: 'object' },
    node_kinds: [
      descriptor('command', ['hermes-legacy', 'archon-2026-07']),
      descriptor('prompt', ['hermes-legacy', 'archon-2026-07']),
    ],
    semantic_rules: [
      {
        id: 'dag',
        label: 'DAG',
        description: 'Graph fields',
        field_paths: ['nodes'],
        applicability: { profiles: [profile], documents: ['definition'] },
        status: 'supported',
        parameters: { nodes_path: 'nodes', id_field: 'id', dependencies_field: 'depends_on' },
        examples: [],
      },
      {
        id: 'references',
        label: 'References',
        description: 'Output references',
        field_paths: ['nodes[].prompt'],
        applicability: { profiles: [profile], documents: ['definition'], node_kinds: ['prompt'] },
        status: 'supported',
        parameters: { syntax: '$ID.output(.path)*', require_upstream: true },
        examples: [],
      },
    ],
    compatibility_codes: {},
    documentation: { topics: [], examples: [] },
    limits: { max_document_bytes: 2 * 1024 * 1024 },
    extensions: {},
  }
}

const source = `name: Duplicate selection
description: Duplicate fixture
x-future-top-level: keep me
nodes:
  - id: bootstrap
    command: bootstrap
  - id: prepare
    depends_on: [bootstrap]
    command: prepare
  - id: review
    depends_on: [bootstrap, prepare]
    prompt: "Review $prepare.output"
  - id: finish
    depends_on: [review]
    command: finish
`

function pair(text: string, profile: AuthoringContract['profile']): WorkflowPairText {
  return {
    workflowId: `duplicate-${profile}`,
    generation: 1,
    savedGeneration: 1,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'duplicate.yaml',
      text,
      revision: 1,
      savedRevision: 1,
      diskHash: 'sha256:disk',
    },
    companion: null,
  }
}

function projection(text: string, profile: AuthoringContract['profile']): WorkflowProjection {
  const definition = parse(text) as Record<string, unknown>
  const rawNodes = definition.nodes as Record<string, unknown>[]
  const nodes = rawNodes.map((node, index) => {
    const kind = Object.hasOwn(node, 'prompt') ? 'prompt' : 'command'
    return {
      id: String(node.id),
      kind,
      value: node[kind],
      dependsOn: Array.isArray(node.depends_on) ? (node.depends_on as string[]) : [],
      options: Object.fromEntries(
        Object.entries(node).filter(([key]) => !['id', 'depends_on', 'command', 'prompt'].includes(key)),
      ),
      source: { path: `/nodes/${index}`, start: index * 10, end: index * 10 + 9 },
    }
  })
  return {
    name: String(definition.name),
    description: String(definition.description),
    profile,
    graphs: [
      {
        scope: { key: 'root', kind: 'root', workflow: { name: String(definition.name), profile } },
        editorNodePrefix: '',
        sourcePath: ['nodes'],
        sourceRange: { start: 0, end: text.length },
        nodes,
        edges: nodes.flatMap((target) =>
          target.dependsOn.map((dependency) => ({
            id: `dependency:${dependency}->${target.id}`,
            source: dependency,
            target: target.id,
          })),
        ),
        definitionOrder: nodes.map(({ id }) => id),
        outerInputs: [],
        issues: [],
        capacity: {
          status: 'visual',
          nodeCount: nodes.length,
          edgeCount: nodes.flatMap((node) => node.dependsOn).length,
        },
      },
    ],
    definition,
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parsedNodes(text: string): Record<string, unknown>[] {
  const definition = record(parse(text))
  return Array.isArray(definition.nodes) ? definition.nodes.map(record) : []
}

function intersects(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
  return Math.abs(left.x - right.x) < CANVAS_NODE_WIDTH && Math.abs(left.y - right.y) < CANVAS_NODE_HEIGHT
}

function context(text = source, activeContract = contract()) {
  const currentPair = pair(text, activeContract.profile)
  const revision = createDocumentRevision(currentPair, activeContract.contract_digest)
  const commit = vi.fn(() => undefined)
  return {
    pair: currentPair,
    revision,
    projection: projection(text, activeContract.profile),
    scopeKey: 'root' as const,
    get graph() {
      return this.projection.graphs[0]!
    },
    contract: activeContract,
    positions: {
      bootstrap: { x: 0, y: 0 },
      prepare: { x: 320, y: 0 },
      review: { x: 640, y: 0 },
      finish: { x: 960, y: 0 },
    },
    applyMutation: vi.fn(applyWorkflowMutation),
    getCurrentSnapshot: () => ({ pair: currentPair, revision, scopeKey: 'root' as const }),
    commit,
    commitPositions: vi.fn(),
    announce: vi.fn(),
  }
}

describe('duplicate/copy/paste YAML transforms', () => {
  it('duplicates a multi-node selection as one complete transaction with remapped internal semantics', async () => {
    const fixture = context()

    const result = await duplicateSelection(fixture, ['prepare', 'review'])

    expect(result).toMatchObject({ status: 'committed', nodeIds: ['prepare-2', 'review-2'] })
    expect(fixture.applyMutation).toHaveBeenCalledOnce()
    expect(fixture.commit).toHaveBeenCalledOnce()
    if (result.status !== 'committed') return
    const nodes = parsedNodes(result.pair.definition.text)
    const ids = nodes.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(nodes.find(({ id }) => id === 'prepare-2')?.depends_on).toEqual(['bootstrap'])
    expect(nodes.find(({ id }) => id === 'review-2')).toMatchObject({
      depends_on: ['bootstrap', 'prepare-2'],
      prompt: 'Review $prepare-2.output',
    })
    expect(nodes.find(({ id }) => id === 'finish')?.depends_on).toEqual(['review'])
    for (const copied of Object.values(result.positions)) {
      expect(Object.values(fixture.positions).some((existing) => intersects(copied, existing))).toBe(false)
    }
    expect(intersects(result.positions['prepare-2']!, result.positions['review-2']!)).toBe(false)
  })

  it('repairs overlapping source layout while placing a duplicated multi-node cluster', async () => {
    const fixture = {
      ...context(),
      positions: {
        bootstrap: { x: 0, y: 0 },
        prepare: { x: 320, y: 0 },
        review: { x: 320, y: 0 },
        finish: { x: 960, y: 0 },
      },
    }

    const result = await duplicateSelection(fixture, ['prepare', 'review'])

    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(intersects(result.positions['prepare-2']!, result.positions['review-2']!)).toBe(false)
  })

  it('copies immutable raw YAML values rather than projected node objects', () => {
    const fixture = context()

    const clipboard = copySelection(fixture, ['review'])

    expect(clipboard).toMatchObject({ sourceProfile: 'hermes-legacy', selectedIds: ['review'] })
    expect(clipboard.nodes[0]).toEqual({
      id: 'review',
      depends_on: ['bootstrap', 'prepare'],
      prompt: 'Review $prepare.output',
    })
    expect(Object.isFrozen(clipboard)).toBe(true)
  })

  it('rejects profile-disallowed copied fields before any destination mutation', async () => {
    const sourceWithLegacyField = source.replace('command: prepare', 'command: prepare\n    legacy_only: retained')
    const sourceContext = context(sourceWithLegacyField, contract('hermes-legacy', true))
    const clipboard = copySelection(sourceContext, ['prepare'])
    const destinationContract = contract('archon-2026-07', false)
    const nodeProperties = record(
      record(record(record(destinationContract.definition_schema).properties).nodes).items,
    ).properties
    delete record(nodeProperties).legacy_only
    const destination = context(source, destinationContract)

    const result = await pasteSelection(destination, clipboard)

    expect(result).toMatchObject({ status: 'rejected', code: 'profile_disallowed' })
    expect(destination.applyMutation).not.toHaveBeenCalled()
    expect(destination.commit).not.toHaveBeenCalled()
  })

  it('rejects a known legacy-only descriptor even when the destination schema permits extensions', async () => {
    const sourceWithLegacyField = source.replace('command: prepare', 'command: prepare\n    legacy_only: retained')
    const sourceContext = context(sourceWithLegacyField, contract('hermes-legacy', true))
    const clipboard = copySelection(sourceContext, ['prepare'])
    const destinationBase = contract('archon-2026-07', true)
    const destinationContract: AuthoringContract = {
      ...destinationBase,
      node_kinds: destinationBase.node_kinds.map((kind) => ({
        ...kind,
        fields: [fieldDescriptor('legacy-only', 'nodes[].legacy_only', ['hermes-legacy'])],
      })),
    }
    const destination = context(source, destinationContract)

    const result = await pasteSelection(destination, clipboard)

    expect(result).toMatchObject({ status: 'rejected', code: 'profile_disallowed' })
    expect(destination.applyMutation).not.toHaveBeenCalled()
    expect(destination.commit).not.toHaveBeenCalled()
  })

  it('recursively rejects a known disallowed field below wildcard arrays before any patch', async () => {
    const sourceWithNestedLegacyField = source.replace(
      'command: prepare',
      'command: prepare\n    settings:\n      tools:\n        - name: compiler\n          legacy_option: retained',
    )
    const sourceContext = context(sourceWithNestedLegacyField, contract('hermes-legacy', true))
    const clipboard = copySelection(sourceContext, ['prepare'])
    const destinationBase = contract('archon-2026-07', true)
    const destinationContract: AuthoringContract = {
      ...destinationBase,
      node_kinds: destinationBase.node_kinds.map((kind) => ({
        ...kind,
        fields: [fieldDescriptor('legacy-tool-option', 'nodes[].settings.tools[].legacy_option', ['hermes-legacy'])],
      })),
    }
    const destination = context(source, destinationContract)

    const result = await pasteSelection(destination, clipboard)

    expect(result).toMatchObject({ status: 'rejected', code: 'profile_disallowed' })
    expect(destination.applyMutation).not.toHaveBeenCalled()
    expect(destination.commit).not.toHaveBeenCalled()
  })

  it('preflights nested combinator schema branches before any destination transaction', async () => {
    const sourceWithNested = source.replace(
      'command: prepare',
      'command: prepare\n    settings:\n      mode: legacy\n      nested:\n        enabled: true',
    )
    const sourceContext = context(sourceWithNested, contract('hermes-legacy', true))
    const clipboard = copySelection(sourceContext, ['prepare'])
    const destinationContract = contract('archon-2026-07', true)
    const itemSchema = record(record(record(destinationContract.definition_schema).properties).nodes).items
    Object.assign(record(itemSchema), {
      allOf: [
        {
          properties: {
            settings: {
              oneOf: [
                {
                  type: 'object',
                  properties: { mode: { const: 'modern' } },
                  required: ['mode'],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
      ],
    })
    const destination = context(source, destinationContract)

    const result = await pasteSelection(destination, clipboard)

    expect(result).toMatchObject({ status: 'rejected', code: 'profile_disallowed' })
    expect(destination.applyMutation).not.toHaveBeenCalled()
    expect(destination.commit).not.toHaveBeenCalled()
  })

  it('preserves unrelated unknown destination YAML while pasting in one transaction', async () => {
    const sourceContext = context()
    const clipboard = copySelection(sourceContext, ['prepare'])
    const destination = context(source.replace('x-future-top-level: keep me', 'x-destination-only: exact'))

    const result = await pasteSelection(destination, clipboard)

    expect(result).toMatchObject({ status: 'committed' })
    expect(destination.applyMutation).toHaveBeenCalledOnce()
    if (result.status !== 'committed') return
    expect(result.pair.definition.text).toContain('x-destination-only: exact')
    expect(result.pair.definition.text).not.toContain('x-future-top-level: keep me')
  })

  it('preserves comments and scalar styles on every existing node during duplication', async () => {
    const styled = source
      .replace(
        '  - id: bootstrap\n    command: bootstrap',
        '  # retained node lead\n  - id: bootstrap\n    command: "bootstrap" # retained inline',
      )
      .replace('    command: finish', '    command: |\n      finish exactly')
    const fixture = context(styled)

    const result = await duplicateSelection(fixture, ['prepare'])

    expect(result).toMatchObject({ status: 'committed' })
    if (result.status !== 'committed') return
    expect(result.pair.definition.text).toContain(
      '  # retained node lead\n  - id: bootstrap\n    command: "bootstrap" # retained inline',
    )
    expect(result.pair.definition.text).toContain('    command: |\n      finish exactly')
  })

  it('rewrites only the contract-declared capture when earlier match text repeats the node ID', async () => {
    const baseContract = contract()
    const activeContract: AuthoringContract = {
      ...baseContract,
      semantic_rules: baseContract.semantic_rules.map((rule) =>
        rule.id === 'references'
          ? {
              ...rule,
              parameters: {
                pattern: '(prepare-prefix:)\\$([A-Za-z_][A-Za-z0-9_-]*)\\.output',
                node_id_capture_group: 2,
                require_upstream: true,
              },
            }
          : rule,
      ),
    }
    const fixture = context(source.replace('Review $prepare.output', 'prepare-prefix:$prepare.output'), activeContract)

    const result = await duplicateSelection(fixture, ['prepare', 'review'])

    expect(result).toMatchObject({ status: 'committed' })
    if (result.status !== 'committed') return
    expect(parsedNodes(result.pair.definition.text).find(({ id }) => id === 'review-2')?.prompt).toBe(
      'prepare-prefix:$prepare-2.output',
    )
  })
})

async function scopedClipboardContext(
  scopeKey: import('$src/lib/projection/types').GraphScopeKey = 'loop-group:first',
  rewriteSource: (text: string) => string = (text) => text,
) {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const { analyzeWorkflowPair } = await import('$src/lib/validation/analyze-workflow')
  const activeContract = (await loadBundledAuthoringContracts()).find(
    (candidate) => candidate.profile === 'archon-2026-07',
  )!
  const originalSource = `name: Scoped clipboard
description: Copied namespaces
nodes:
  - id: external
    bash: echo external
  - id: rootconsumer
    depends_on: [external]
    bash: echo $external.output
  - id: first
    loop_group:
      max_iterations: 2
      until: 'false'
      nodes:
        - id: external
          bash: echo local
        - id: producer
          bash: echo producer
        - id: consumer
          depends_on: [producer]
          bash: |
            echo "😀 $producer.output $LOOP_PREV.producer.output"
            echo \\$producer.output # $producer.output
        - id: incoming
          depends_on: [external]
          bash: echo $external.output
  - id: second
    loop_group:
      max_iterations: 2
      until: 'false'
      nodes:
        - id: external
          bash: echo unrelated
`
  const text = rewriteSource(originalSource)
  const currentPair = {
    ...pair(text, activeContract.profile),
    companion: {
      ...pair(text, activeContract.profile).definition,
      id: 'companion',
      kind: 'companion' as const,
      path: 'clipboard.hermes.yaml',
      text: 'language_compatibility: archon-2026-07\n',
    },
  }
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'clipboard-scope',
      workflowId: currentPair.workflowId,
      pairGeneration: currentPair.generation,
      definition: currentPair.definition,
      companion: currentPair.companion,
      profile: activeContract.profile,
      contractDigest: activeContract.contract_digest,
      reason: 'explicit-validate',
    },
    activeContract,
  )
  expect(analysis.structurallyValid, JSON.stringify(analysis.issues)).toBe(true)
  const projection = analysis.projection as WorkflowProjection
  return {
    ...context(),
    pair: currentPair,
    revision: createDocumentRevision(currentPair, activeContract.contract_digest),
    contract: activeContract,
    scopeKey,
    graph: projection.graphs.find((graph) => graph.scope.key === scopeKey)!,
    projection,
    currentAnalysis: analysis,
    referenceIndex: analysis.referenceIndex,
    getCurrentSnapshot: () => ({
      pair: currentPair,
      revision: createDocumentRevision(currentPair, activeContract.contract_digest),
      scopeKey,
    }),
  }
}

describe('indexed scoped clipboard', () => {
  it('duplicates local selection-internal current and previous references using Unicode spans and scanner exclusions', async () => {
    const fixture = await scopedClipboardContext()
    const clipboard = copySelection(fixture, ['producer', 'consumer'])
    expect(clipboard).toMatchObject({ sourceScopeKey: 'loop-group:first', sourceWorkflowId: fixture.pair.workflowId })
    const result = await pasteSelection(fixture, clipboard)
    expect(result).toMatchObject({ status: 'committed', nodeIds: ['producer-2', 'consumer-2'] })
    if (result.status !== 'committed') return
    const nodes = parse(result.pair.definition.text).nodes[2].loop_group.nodes
    expect(nodes.find((node: { id: string }) => node.id === 'consumer-2').bash).toBe(
      'echo "😀 $producer-2.output $LOOP_PREV.producer-2.output"\necho \\$producer.output # $producer.output\n',
    )
    expect(nodes.find((node: { id: string }) => node.id === 'consumer').depends_on).toEqual(['producer'])
    expect(fixture.commit).toHaveBeenCalledOnce()
  })

  it.each(['root', 'loop-group:first'] as const)(
    'refuses cross-scope %s incoming references despite coincidentally matching external IDs',
    async (scope) => {
      const source = await scopedClipboardContext(scope)
      const destination = await scopedClipboardContext('loop-group:second')
      const result = await pasteSelection(
        destination,
        copySelection(source, [scope === 'root' ? 'rootconsumer' : 'incoming']),
      )
      expect(result).toMatchObject({
        status: 'resolution_required',
        code: 'resolution_required',
        clipboardImpact: {
          dependencies: [{ producer: { nodeId: 'external' } }],
          references: [{ references: [{ resolvedProducer: { nodeId: 'external' } }] }],
        },
      })
      expect(destination.commit).not.toHaveBeenCalled()
      expect(destination.commitPositions).not.toHaveBeenCalled()
    },
  )

  it('pastes a self-contained body selection into a sibling graph in one transaction', async () => {
    const source = await scopedClipboardContext()
    const destination = await scopedClipboardContext('loop-group:second')
    const result = await pasteSelection(destination, copySelection(source, ['producer', 'consumer']))
    expect(result).toMatchObject({
      status: 'committed',
      identityChanges: {
        nodeCopies: [
          {
            from: { scopeKey: 'loop-group:first', nodeId: 'producer' },
            to: { scopeKey: 'loop-group:second', nodeId: 'producer' },
          },
          {
            from: { scopeKey: 'loop-group:first', nodeId: 'consumer' },
            to: { scopeKey: 'loop-group:second', nodeId: 'consumer' },
          },
        ],
      },
    })
    if (result.status !== 'committed') return
    expect(parse(result.pair.definition.text).nodes[3].loop_group.nodes.map((node: { id: string }) => node.id)).toEqual(
      ['external', 'producer', 'consumer'],
    )
    expect(result.pair.definition.text).toContain('echo unrelated')
    expect(destination.commit).toHaveBeenCalledOnce()
  })

  it('duplicates a whole group with unchanged complete body and an explicit scope copy mapping', async () => {
    const fixture = await scopedClipboardContext('root')
    const result = await duplicateSelection(fixture, ['first'])
    expect(result).toMatchObject({
      status: 'committed',
      identityChanges: { scopeCopies: [{ from: 'loop-group:first', to: 'loop-group:first-2' }] },
    })
    if (result.status !== 'committed') return
    const nodes = parse(result.pair.definition.text).nodes
    expect(nodes.find((node: { id: string }) => node.id === 'first-2').loop_group).toEqual(
      nodes.find((node: { id: string }) => node.id === 'first').loop_group,
    )
    expect(result.pair.companion?.text).toBe(fixture.pair.companion.text)
  })
})

it('preserves the copied node comments, quoted scalars, literal blocks and unusual flow values', async () => {
  const styled = source.replace(
    '  - id: prepare\n    depends_on: [bootstrap]\n    command: prepare',
    '  # copied lead\n  - id: "prepare" # copied identity\n    depends_on: ["bootstrap"]\n    command: |\n      prepare exactly\n    x-unknown: { keep : "value", spacing: [ 1,  2 ] }',
  )
  const fixture = context(styled)
  const result = await duplicateSelection(fixture, ['prepare'])
  expect(result).toMatchObject({ status: 'committed' })
  if (result.status !== 'committed') return
  expect(result.pair.definition.text).toContain(
    '  # copied lead\n  - id: "prepare-2" # copied identity\n    depends_on: ["bootstrap"]\n    command: |\n      prepare exactly\n    x-unknown: { keep : "value", spacing: [ 1,  2 ] }',
  )
})

it('rejects inconsistent captured clipboard workflow and revision evidence', async () => {
  const fixture = await scopedClipboardContext()
  const copied = copySelection(fixture, ['producer'])
  const result = await pasteSelection(fixture, {
    ...copied,
    sourceRevision: { ...copied.sourceRevision, definitionPath: 'different.yaml' },
  })
  expect(result).toMatchObject({ status: 'rejected', code: 'stale_document' })
  expect(fixture.commit).not.toHaveBeenCalled()
})

it('requires explicit resolution for previous-iteration tokens pasted from a body into root', async () => {
  const source = await scopedClipboardContext()
  const destination = await scopedClipboardContext('root')
  const result = await pasteSelection(destination, copySelection(source, ['producer', 'consumer']))
  expect(result).toMatchObject({
    status: 'resolution_required',
    clipboardImpact: {
      references: [{ references: expect.arrayContaining([expect.objectContaining({ kind: 'previous' })]) }],
    },
  })
  expect(destination.commit).not.toHaveBeenCalled()
})

it('preserves exact flow mapping spacing when copying between flow collection items', async () => {
  const fixture = context(
    'name: Flow\ndescription: Flow copy\nnodes: [ { id: prepare, command: "value", x-unknown: { x : [1,  2] } } ]\n',
  )
  const result = await duplicateSelection(fixture, ['prepare'])
  expect(result.status).toBe('committed')
  if (result.status === 'committed')
    expect(result.pair.definition.text).toContain('{ id: prepare-2, command: "value", x-unknown: { x : [1,  2] } }')
})

it('copies a first node leading comment with CRLF and literal scalar chomping intact', async () => {
  const fixture = context(
    'name: Copy\ndescription: CRLF\nnodes:\n  # first lead\n  - id: "prepare"\n    command: |-\n      first\n      second\n'.replaceAll(
      '\n',
      '\r\n',
    ),
  )
  const result = await duplicateSelection(fixture, ['prepare'])
  expect(result.status).toBe('committed')
  if (result.status !== 'committed') return
  expect(result.pair.definition.text).toContain(
    '  # first lead\r\n  - id: "prepare-2"\r\n    command: |-\r\n      first\r\n      second\r\n',
  )
  expect(parsedNodes(result.pair.definition.text)[1]?.command).toBe('first\nsecond')
})

it('rejects invalid final clipboard analysis atomically through the active analyzer', async () => {
  const fixture = await scopedClipboardContext()
  const analyzePrepared = vi.fn(async () => ({
    ...fixture.currentAnalysis,
    structurallyValid: false,
    visuallyAuthorable: false,
  }))
  const result = await duplicateSelection({ ...fixture, analyzePrepared }, ['producer', 'consumer'])
  expect(result).toMatchObject({ status: 'rejected', code: 'mutation_invalid_workflow' })
  expect(analyzePrepared).toHaveBeenCalledOnce()
  expect(fixture.commit).not.toHaveBeenCalled()
  expect(fixture.commitPositions).not.toHaveBeenCalled()
})

it('rejects mismatched captured source values without mutating the destination', async () => {
  const fixture = await scopedClipboardContext()
  const copied = copySelection(fixture, ['producer'])
  const result = await pasteSelection(fixture, {
    ...copied,
    sourceText: copied.sourceText.replace('bash: echo producer', 'bash: echo changed'),
  })
  expect(result).toMatchObject({ status: 'rejected', code: 'mutation_stale_scope' })
  expect(fixture.commit).not.toHaveBeenCalled()
})

it('preserves a kept literal scalar value when pasting into an empty flow sequence', async () => {
  const source = context(
    'name: Copy\ndescription: Empty destination\nnodes:\n  - id: producer\n    command: |+\n      value\n\n',
  )
  const destination = context('name: Empty\ndescription: Ready\nnodes: []\n')
  const result = await pasteSelection(destination, copySelection(source, ['producer']))
  expect(result.status).toBe('committed')
  if (result.status === 'committed') expect(parsedNodes(result.pair.definition.text)[0]?.command).toBe('value\n\n')
})

it('preserves a first-node leading comment through the necessary block-to-flow insertion fallback', async () => {
  const source = context(
    'name: Copy\ndescription: Flow fallback\nnodes:\n  # copied first comment\n  - id: producer\n    command: |-\n      literal\n',
  )
  const destination = context('name: Flow\ndescription: Destination\nnodes: [{ id: other, command: exact }]\n')
  const result = await pasteSelection(destination, copySelection(source, ['producer']))
  expect(result.status).toBe('committed')
  if (result.status !== 'committed') return
  expect(result.pair.definition.text).toContain('# copied first comment')
  expect(parsedNodes(result.pair.definition.text)[1]?.command).toBe('literal')
})

it('rejects an inconsistent non-finite unknown scalar in captured clipboard values', async () => {
  const fixture = context(
    'name: Copy\ndescription: Unknown scalar\nnodes:\n  - id: producer\n    command: exact\n    x-unknown: .inf\n',
  )
  const copied = copySelection(fixture, ['producer'])
  const result = await pasteSelection(fixture, { ...copied, nodes: [{ ...copied.nodes[0]!, 'x-unknown': null }] })
  expect(result).toMatchObject({ status: 'rejected', code: 'mutation_stale_scope' })
  expect(fixture.commit).not.toHaveBeenCalled()
})

it('pastes into an empty graph inside a flow mapping without changing scalar values', async () => {
  const source = context('name: Copy\ndescription: Source\nnodes:\n  - id: producer\n    command: |-\n      exact\n')
  const destination = context('{ name: Flow, description: Destination, nodes: [] }\n')
  const result = await pasteSelection(destination, copySelection(source, ['producer']))
  expect(result.status).toBe('committed')
  if (result.status === 'committed') expect(parsedNodes(result.pair.definition.text)[0]?.command).toBe('exact')
})

it.each(['references', 'dependencies', 'selectedIdentities', 'nodePaths', 'groupScopes', 'selectedIds'] as const)(
  'rejects forged clipboard %s evidence before mutation',
  async (field) => {
    const source = await scopedClipboardContext()
    const destination = await scopedClipboardContext('loop-group:second')
    const clipboard = copySelection(source, ['incoming'])
    const forged = { ...clipboard, [field]: field === 'nodePaths' ? {} : [] }
    expect(await pasteSelection(destination, forged)).toMatchObject({
      status: 'rejected',
      code: 'mutation_stale_scope',
    })
    expect(destination.commit).not.toHaveBeenCalled()
    expect(destination.commitPositions).not.toHaveBeenCalled()
  },
)

it('rejects forged ordinary reference and dependency removal despite matching destination producer spelling', async () => {
  const source = await scopedClipboardContext()
  const destination = await scopedClipboardContext('loop-group:second')
  const clipboard = copySelection(source, ['incoming'])
  expect(await pasteSelection(destination, clipboard)).toMatchObject({ status: 'resolution_required' })
  expect(await pasteSelection(destination, { ...clipboard, dependencies: [], references: [] })).toMatchObject({
    status: 'rejected',
    code: 'mutation_stale_scope',
  })
  expect(destination.commit).not.toHaveBeenCalled()
})

it('rejects a structurally cloned clipboard while allowing the original immutable snapshot after source changes', async () => {
  const source = await scopedClipboardContext()
  const clipboard = copySelection(source, ['producer'])
  const destination = await scopedClipboardContext('loop-group:second')
  expect(await pasteSelection(destination, structuredClone(clipboard))).toMatchObject({
    status: 'rejected',
    code: 'mutation_stale_scope',
  })
  source.pair.definition.text = source.pair.definition.text.replace('echo producer', 'echo later')
  source.pair.definition.revision++
  expect(await pasteSelection(destination, clipboard)).toMatchObject({ status: 'committed' })
})

it('rejects forged whole-group identities and deeply freezes the captured subtree evidence', async () => {
  const source = await scopedClipboardContext('root')
  const clipboard = copySelection(source, ['first'])
  expect(Object.isFrozen(clipboard.sourceContract.semantic_rules[0]!.parameters)).toBe(true)
  expect(Object.isFrozen(clipboard.references[0]!.references)).toBe(true)
  expect(Object.isFrozen(clipboard.nodes[0]!.loop_group)).toBe(true)
  expect(await pasteSelection(source, { ...clipboard, groupScopes: [], selectedIdentities: [] })).toMatchObject({
    status: 'rejected',
    code: 'mutation_stale_scope',
  })
  expect(
    await pasteSelection(source, {
      ...clipboard,
      references: clipboard.references.map((occurrence) => ({ ...occurrence, references: [] })),
    }),
  ).toMatchObject({ status: 'rejected', code: 'mutation_stale_scope' })
  expect(source.commit).not.toHaveBeenCalled()
})

it('rejects forged LOOP_PREV-only evidence with no dependency entry to reveal the external producer', async () => {
  const source = await scopedClipboardContext('loop-group:first', (text) =>
    text.replace(
      '          depends_on: [external]\n          bash: echo $external.output',
      '          bash: echo $LOOP_PREV.external.output',
    ),
  )
  const destination = await scopedClipboardContext('loop-group:second')
  const clipboard = copySelection(source, ['incoming'])
  expect(clipboard.dependencies).toEqual([])
  expect(clipboard.references[0]?.references[0]?.kind).toBe('previous')
  expect(await pasteSelection(destination, clipboard)).toMatchObject({ status: 'resolution_required' })
  expect(await pasteSelection(destination, { ...clipboard, references: [] })).toMatchObject({
    status: 'rejected',
    code: 'mutation_stale_scope',
  })
  expect(destination.commit).not.toHaveBeenCalled()
})

it.each([
  ['leading', '# copied lead, comma\n  { id: producer, command: exact },\n  { id: neighbor, command: other }'],
  [
    'trailing after comma',
    '{ id: producer, command: exact }, # copied tail, comma\n  { id: neighbor, command: other }',
  ],
  [
    'trailing before comma',
    '{ id: producer, command: exact } # copied tail, comma\n  , { id: neighbor, command: other }',
  ],
  ['last trailing', '{ id: neighbor, command: other },\n  { id: producer, command: exact }, # final tail, comma\n'],
])(
  'rejects unsafe %s flow comment transplantation for block and flow destinations with unchanged bytes',
  async (_name, items) => {
    for (const newline of ['\n', '\r\n']) {
      const source = context(`name: Copy\ndescription: Source\nnodes: [\n  ${items}\n]\n`.replaceAll('\n', newline))
      const clipboard = copySelection(source, ['producer'])
      for (const destinationText of [
        'name: Destination\ndescription: Block\nnodes:\n  - id: other\n    command: keep\n',
        'name: Destination\ndescription: Flow\nnodes: [{ id: other, command: keep }]\n',
      ]) {
        const destination = context(destinationText.replaceAll('\n', newline))
        const before = structuredClone(destination.pair)
        expect(await pasteSelection(destination, clipboard)).toMatchObject({
          status: 'rejected',
          code: 'mutation_stale_scope',
        })
        expect(destination.pair).toEqual(before)
        expect(destination.commit).not.toHaveBeenCalled()
        expect(destination.commitPositions).not.toHaveBeenCalled()
      }
    }
  },
)

it('does not reassign the existing last flow node comment to a copied item', async () => {
  const source = context('name: Copy\ndescription: Source\nnodes:\n  - id: producer\n    command: exact\n')
  const destination = context(
    'name: Destination\ndescription: Flow\nnodes: [\n  { id: existing, command: keep }, # belongs to existing, comma\n]\n',
  )
  const before = destination.pair.definition.text
  expect(await pasteSelection(destination, copySelection(source, ['producer']))).toMatchObject({
    status: 'rejected',
    code: 'mutation_stale_scope',
  })
  expect(destination.pair.definition.text).toBe(before)
  expect(destination.commit).not.toHaveBeenCalled()
})

it.each(['value\n\nnext\n', 'value\n\n', 'value\n  \nnext\n\n'])(
  'preserves CRLF blank lines and kept literal scalar values: %j',
  async (body) => {
    const scalar = body
      .split('\n')
      .map((line, index, lines) => (index === lines.length - 1 ? '' : line ? `      ${line}\n` : '\n'))
      .join('')
    const text = (
      'name: Copy\ndescription: CRLF blanks\nnodes:\n  - id: producer\n    command: |+\n' + scalar
    ).replaceAll('\n', '\r\n')
    const fixture = context(text)
    const result = await duplicateSelection(fixture, ['producer'])
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.pair.definition.text).toContain(
      '  - id: producer-2\r\n    command: |+\r\n' + scalar.replaceAll('\n', '\r\n'),
    )
    const nodes = parsedNodes(result.pair.definition.text)
    expect(nodes[1]?.command).toBe(nodes[0]?.command)
    expect(result.pair.definition.text.replaceAll('\r\n', '')).not.toContain('\n')
  },
)

it('preserves CRLF blank lines and scalar values while reindenting a root copy into a body', async () => {
  const source = await scopedClipboardContext('root', (text) =>
    text.replace('    bash: echo external', '    bash: |+\n      alpha\n\n      omega\n\n').replaceAll('\n', '\r\n'),
  )
  const destination = await scopedClipboardContext('loop-group:second')
  const result = await pasteSelection(destination, copySelection(source, ['external']))
  expect(result.status).toBe('committed')
  if (result.status !== 'committed') return
  expect(result.pair.definition.text).toContain(
    '        - id: external-2\r\n          bash: |+\r\n            alpha\r\n\r\n            omega\r\n\r\n',
  )
  expect(parse(result.pair.definition.text).nodes[3].loop_group.nodes[1].bash).toBe(
    parse(source.pair.definition.text).nodes[0].bash,
  )
})
