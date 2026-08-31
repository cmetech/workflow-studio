import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import type { AuthoringContract, NodeKindDescriptor } from '$src/lib/contract/types'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import { applyWorkflowMutation } from '$src/lib/documents/transactions'
import type { WorkflowPairText } from '$src/lib/documents/types'
import { createDocumentRevision, editDocumentText } from '$src/lib/documents/revisions'
import type { WorkflowProjection } from '$src/lib/projection/types'
import {
  addNode,
  commitMutation,
  connectNodes,
  deleteNodes,
  disconnectNodes,
  previewDeleteNodes,
  renameNode,
  type CanvasActionContext,
} from './canvas-actions'

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((settle) => (resolve = settle)), resolve }
}

function nodeKind(id: string, fieldPath: string, examples: readonly unknown[] = []): NodeKindDescriptor {
  return {
    id,
    label: id,
    description: `${id} node`,
    field_path: fieldPath,
    applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
    widget: 'text',
    section: 'general',
    order: 1,
    status: 'supported',
    examples,
    fields: [],
  }
}

const contract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'hermes-legacy',
  normalizer_version: 1,
  contract_digest: `sha256:${'a'.repeat(64)}`,
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
            id: { type: 'string', pattern: '^[^\\s/\\\\]+$' },
            depends_on: { type: 'array', items: { type: 'string' } },
            command: { type: 'string' },
            prompt: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'description', 'nodes'],
    additionalProperties: false,
  },
  sidecar_schema: { type: 'object' },
  node_kinds: [nodeKind('command', 'nodes[].command'), nodeKind('prompt', 'nodes[].prompt')],
  semantic_rules: [
    {
      id: 'workflow-dag-v1',
      label: 'DAG',
      description: 'Graph fields',
      field_paths: ['nodes'],
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      status: 'supported',
      parameters: { nodes_path: 'nodes', id_field: 'id', dependencies_field: 'depends_on' },
      examples: [],
    },
    {
      id: 'output-reference-v1',
      label: 'References',
      description: 'Output references',
      field_paths: ['nodes[].prompt'],
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'], node_kinds: ['prompt'] },
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

const source = `name: Canvas actions
description: Action fixture
nodes:
  - id: root
    command: root
  - id: middle
    depends_on: [root]
    prompt: middle
  - id: leaf
    depends_on: [middle]
    prompt: "Use $middle.output"
`

function pair(text = source): WorkflowPairText {
  return {
    workflowId: 'canvas-actions',
    generation: 1,
    savedGeneration: 1,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'actions.yaml',
      text,
      revision: 3,
      savedRevision: 3,
      diskHash: 'sha256:disk',
    },
    companion: null,
  }
}

function pairWithCompanion(): WorkflowPairText {
  return {
    ...pair(),
    companion: {
      id: 'companion',
      kind: 'companion',
      path: 'actions.hermes.yaml',
      text: '{}\n',
      revision: 2,
      savedRevision: 2,
      diskHash: 'sha256:companion',
    },
  }
}

function projection(text = source): WorkflowProjection {
  const definition = parse(text) as Record<string, unknown>
  const rawNodes = definition.nodes as Record<string, unknown>[]
  const nodes = rawNodes.map((node, index) => {
    const kind = Object.hasOwn(node, 'command') ? 'command' : 'prompt'
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
    profile: 'hermes-legacy',
    nodes,
    edges: nodes.flatMap((target) =>
      target.dependsOn.map((dependency) => ({
        id: `dependency:${dependency}->${target.id}`,
        source: dependency,
        target: target.id,
      })),
    ),
    definition,
    companion: null,
  }
}

function parsedNodes(text: string): Record<string, unknown>[] {
  const definition = parse(text)
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) return []
  return Array.isArray(definition.nodes)
    ? definition.nodes.filter(
        (node: unknown): node is Record<string, unknown> =>
          node !== null && typeof node === 'object' && !Array.isArray(node),
      )
    : []
}

function actionContext(text = source) {
  let current = pair(text)
  let currentRevision = createDocumentRevision(current, contract.contract_digest)
  const apply = vi.fn(applyWorkflowMutation)
  const commit = vi.fn((next: WorkflowPairText) => {
    current = next
    currentRevision = createDocumentRevision(next, contract.contract_digest)
  })
  const commitPositions = vi.fn()
  const announce = vi.fn()
  const context: CanvasActionContext = {
    pair: current,
    revision: currentRevision,
    projection: projection(text),
    contract,
    positions: { root: { x: 0, y: 0 }, middle: { x: 320, y: 0 }, leaf: { x: 640, y: 0 } },
    applyMutation: apply,
    getCurrentSnapshot: () => ({ pair: current, revision: currentRevision }),
    commit,
    commitPositions,
    announce,
  }
  return { context, apply, commit, commitPositions, announce, current: () => current }
}

describe('canvas YAML actions', () => {
  it.each([
    ['analysis_unavailable', 'Document analysis worker is unavailable.'],
    ['worker_runtime_error', 'Document analysis worker failed.'],
    ['worker_message_error', 'Document analysis worker returned an unreadable message.'],
    ['worker_timeout', 'Document analysis worker timed out.'],
  ])('returns a user-visible %s rejection when worker analysis cannot settle successfully', async (code, message) => {
    const fixture = actionContext()
    const context = {
      ...fixture.context,
      applyMutation: vi.fn(() => Promise.reject(Object.assign(new Error(message), { code }))),
    }

    await expect(
      commitMutation(context, {
        type: 'set-field',
        document: 'definition',
        path: ['description'],
        value: 'Never committed',
      }),
    ).resolves.toEqual({ status: 'rejected', code, message })
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(fixture.announce).toHaveBeenCalledWith(message)
  })

  it('rejects the later of two visual mutations resolved from the same YAML revision', async () => {
    const base = pair()
    const firstMutation = {
      type: 'set-field' as const,
      document: 'definition' as const,
      path: ['description'] as const,
      value: 'First visual edit',
    }
    const secondMutation = { ...firstMutation, value: 'Second visual edit' }
    const firstResult = await applyWorkflowMutation(base, firstMutation, contract)
    const secondResult = await applyWorkflowMutation(base, secondMutation, contract)
    const firstAnalysis = deferred<typeof firstResult>()
    const secondAnalysis = deferred<typeof secondResult>()
    const pending = [firstAnalysis, secondAnalysis]
    let activePair: WorkflowPairText = base
    const fixture = actionContext()
    const context = {
      ...fixture.context,
      pair: base,
      revision: createDocumentRevision(base, contract.contract_digest),
      getCurrentSnapshot: () => ({
        pair: activePair,
        revision: createDocumentRevision(activePair, contract.contract_digest),
      }),
      applyMutation: vi.fn(() => pending.shift()!.promise),
      commit: vi.fn((next: WorkflowPairText) => {
        activePair = next
      }),
    }

    const first = commitMutation(context, firstMutation)
    const second = commitMutation(context, secondMutation)
    firstAnalysis.resolve(firstResult)
    await expect(first).resolves.toMatchObject({ status: 'committed' })
    secondAnalysis.resolve(secondResult)

    await expect(second).resolves.toMatchObject({ status: 'rejected', code: 'stale_document' })
    expect(activePair.definition.text).toContain('description: First visual edit')
    expect(context.commit).toHaveBeenCalledOnce()
  })

  it('preserves an intervening authoritative YAML edit while visual validation is pending', async () => {
    const base = pair()
    const mutation = {
      type: 'set-field' as const,
      document: 'definition' as const,
      path: ['description'] as const,
      value: 'Visual edit',
    }
    const visualResult = await applyWorkflowMutation(base, mutation, contract)
    const analysis = deferred<typeof visualResult>()
    let activePair = base
    const fixture = actionContext()
    const context = {
      ...fixture.context,
      pair: base,
      revision: createDocumentRevision(base, contract.contract_digest),
      getCurrentSnapshot: () => ({
        pair: activePair,
        revision: createDocumentRevision(activePair, contract.contract_digest),
      }),
      applyMutation: vi.fn(() => analysis.promise),
      commit: vi.fn((next: WorkflowPairText) => {
        activePair = next
      }),
    }

    const visual = commitMutation(context, mutation)
    activePair = editDocumentText(base, 'definition', base.definition.text.replace('Action fixture', 'YAML edit'))
    analysis.resolve(visualResult)

    await expect(visual).resolves.toMatchObject({ status: 'rejected', code: 'stale_document' })
    expect(activePair.definition.text).toContain('description: YAML edit')
    expect(activePair.definition.text).not.toContain('description: Visual edit')
    expect(context.commit).not.toHaveBeenCalled()
  })

  it('rejects pending visual analysis after a same-profile contract digest switch', async () => {
    const base = pair()
    const baseRevision = createDocumentRevision(base, contract.contract_digest)
    const replacementDigest = `sha256:${'b'.repeat(64)}` as const
    const mutation = {
      type: 'set-field' as const,
      document: 'definition' as const,
      path: ['description'] as const,
      value: 'Visual edit under the old contract',
    }
    const visualResult = await applyWorkflowMutation(base, mutation, contract)
    const analysis = deferred<typeof visualResult>()
    const fixture = actionContext()
    let activeRevision = baseRevision
    const context = {
      ...fixture.context,
      pair: base,
      revision: baseRevision,
      getCurrentSnapshot: () => ({ pair: base, revision: activeRevision }),
      applyMutation: vi.fn(() => analysis.promise),
      commit: vi.fn(),
    }

    const visual = commitMutation(context, mutation)
    activeRevision = { ...baseRevision, contractDigest: replacementDigest }
    analysis.resolve(visualResult)

    await expect(visual).resolves.toMatchObject({ status: 'rejected', code: 'stale_document' })
    expect(context.commit).not.toHaveBeenCalled()
  })

  it('preserves newer save metadata when a save completes while visual analysis is pending', async () => {
    const base = {
      ...pair(),
      savedGeneration: 0,
      definition: { ...pair().definition, savedRevision: 2, diskHash: 'sha256:before-save' },
    }
    const baseRevision = createDocumentRevision(base, contract.contract_digest)
    const mutation = {
      type: 'set-field' as const,
      document: 'definition' as const,
      path: ['description'] as const,
      value: 'Pending visual edit',
    }
    const visualResult = await applyWorkflowMutation(base, mutation, contract)
    const analysis = deferred<typeof visualResult>()
    const fixture = actionContext()
    let activePair: WorkflowPairText = base
    const context = {
      ...fixture.context,
      pair: base,
      revision: baseRevision,
      getCurrentSnapshot: () => ({ pair: activePair, revision: baseRevision }),
      applyMutation: vi.fn(() => analysis.promise),
      commit: vi.fn((next: WorkflowPairText) => {
        activePair = next
      }),
    }

    const visual = commitMutation(context, mutation)
    activePair = {
      ...base,
      savedGeneration: base.generation,
      definition: { ...base.definition, savedRevision: base.definition.revision, diskHash: 'sha256:after-save' },
    }
    analysis.resolve(visualResult)

    await expect(visual).resolves.toMatchObject({ status: 'rejected', code: 'stale_document' })
    expect(activePair.savedGeneration).toBe(base.generation)
    expect(activePair.definition.savedRevision).toBe(base.definition.revision)
    expect(activePair.definition.diskHash).toBe('sha256:after-save')
    expect(context.commit).not.toHaveBeenCalled()
  })

  it.each([
    ['workflow identity', (active: WorkflowPairText) => ({ ...active, workflowId: 'replacement-workflow' })],
    ['pair generation', (active: WorkflowPairText) => ({ ...active, generation: active.generation + 1 })],
    [
      'definition path',
      (active: WorkflowPairText) => ({ ...active, definition: { ...active.definition, path: 'replacement.yaml' } }),
    ],
    [
      'definition revision',
      (active: WorkflowPairText) => ({
        ...active,
        definition: { ...active.definition, revision: active.definition.revision + 1 },
      }),
    ],
    ['companion presence', (active: WorkflowPairText) => ({ ...active, companion: null })],
    [
      'companion path',
      (active: WorkflowPairText) => ({
        ...active,
        companion: active.companion ? { ...active.companion, path: 'replacement.hermes.yaml' } : null,
      }),
    ],
    [
      'companion revision',
      (active: WorkflowPairText) => ({
        ...active,
        companion: active.companion ? { ...active.companion, revision: active.companion.revision + 1 } : null,
      }),
    ],
  ] as const)('rejects a pending visual commit when the authoritative %s changes', async (_label, changeActivePair) => {
    const base = pairWithCompanion()
    const mutation = {
      type: 'set-field' as const,
      document: 'definition' as const,
      path: ['description'] as const,
      value: 'Pending visual edit',
    }
    const visualResult = await applyWorkflowMutation(base, mutation, contract)
    const analysis = deferred<typeof visualResult>()
    let activePair = base
    const fixture = actionContext()
    const context = {
      ...fixture.context,
      pair: base,
      revision: createDocumentRevision(base, contract.contract_digest),
      getCurrentSnapshot: () => ({
        pair: activePair,
        revision: createDocumentRevision(activePair, contract.contract_digest),
      }),
      applyMutation: vi.fn(() => analysis.promise),
      commit: vi.fn(),
    }

    const visual = commitMutation(context, mutation)
    activePair = changeActivePair(activePair)
    analysis.resolve(visualResult)

    await expect(visual).resolves.toMatchObject({ status: 'rejected', code: 'stale_document' })
    expect(context.commit).not.toHaveBeenCalled()
  })

  it('connects by changing only the target dependency list in one transaction', async () => {
    const fixture = actionContext()

    const result = await connectNodes(fixture.context, 'root', 'leaf')

    expect(result).toMatchObject({ status: 'committed' })
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.apply.mock.calls[0]?.[1]).toEqual({
      type: 'set-dependencies',
      nodeId: 'leaf',
      dependsOn: ['middle', 'root'],
    })
    expect(parsedNodes(fixture.current().definition.text)[2]?.depends_on).toEqual(['middle', 'root'])
    expect(parsedNodes(fixture.current().definition.text)[0]).toEqual({ id: 'root', command: 'root' })
  })

  it.each([
    ['self_edge', 'middle', 'middle'],
    ['duplicate_edge', 'root', 'middle'],
    ['cycle', 'leaf', 'root'],
    ['missing_endpoint', 'missing', 'leaf'],
  ] as const)('rejects %s before transaction or layout/history mutation', async (code, from, to) => {
    const fixture = actionContext()

    const result = await connectNodes(fixture.context, from, to)

    expect(result).toMatchObject({ status: 'rejected', code })
    expect(fixture.apply).not.toHaveBeenCalled()
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(fixture.commitPositions).not.toHaveBeenCalled()
    expect(fixture.announce).toHaveBeenCalledOnce()
  })

  it('disconnects only the exact dependency and leaves the other dependency untouched', async () => {
    const text = source.replace('depends_on: [middle]', 'depends_on: [root, middle]')
    const fixture = actionContext(text)

    const result = await disconnectNodes(fixture.context, 'root', 'leaf')

    expect(result).toMatchObject({ status: 'committed' })
    expect(parsedNodes(fixture.current().definition.text)[2]?.depends_on).toEqual(['middle'])
  })

  it('adds the smallest descriptor-driven node with a collision-free ID at the viewport center', async () => {
    const fixture = actionContext(source.replaceAll('root', 'prompt'))

    const result = await addNode(fixture.context, contract.node_kinds[1]!, { viewportCenter: { x: 900, y: 420 } })

    expect(result).toMatchObject({ status: 'committed', nodeId: 'prompt-2' })
    const added = parsedNodes(fixture.current().definition.text).find(({ id }) => id === 'prompt-2')
    expect(added).toEqual({ id: 'prompt-2', prompt: '' })
    expect(fixture.commitPositions).toHaveBeenCalledWith({ 'prompt-2': { x: 900, y: 420 } })
  })

  it('keeps a required node kind explicitly empty instead of copying schema examples into YAML', async () => {
    const fixture = actionContext()
    const definitionSchema = structuredClone(contract.definition_schema)
    const root = definitionSchema as { properties?: Record<string, unknown> }
    const nodes = root.properties?.nodes as { items?: { properties?: Record<string, unknown> } }
    if (!nodes.items?.properties) throw new Error('Expected the test node schema.')
    nodes.items.properties.command = { type: 'string', minLength: 1, examples: ['/review'] }
    const exampleContract: AuthoringContract = {
      ...contract,
      contract_digest: `sha256:${'c'.repeat(64)}`,
      definition_schema: definitionSchema,
    }

    const result = await addNode({ ...fixture.context, contract: exampleContract }, contract.node_kinds[0]!, {
      viewportCenter: { x: 900, y: 420 },
    })

    expect(result).toMatchObject({ status: 'committed', nodeId: 'command' })
    const added = parsedNodes(fixture.current().definition.text).find(({ id }) => id === 'command')
    expect(added).toEqual({ id: 'command', command: '' })
  })

  it('adds every bundled node kind as an inspectable incomplete draft without copying examples', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )
    if (!productionContract) throw new Error('Expected the bundled Archon contract.')

    const expectedDrafts: Readonly<Record<string, unknown>> = {
      command: '',
      prompt: '',
      bash: '',
      script: '',
      loop: {},
      approval: {},
      cancel: '',
    }
    for (const descriptor of productionContract.node_kinds) {
      const fixture = actionContext()
      const productionPair: WorkflowPairText = {
        ...fixture.context.pair,
        companion: {
          id: 'companion',
          kind: 'companion',
          path: 'actions.hermes.yaml',
          text: 'language_compatibility: archon-2026-07\n',
          revision: 1,
          savedRevision: 1,
          diskHash: 'sha256:companion',
        },
      }
      const productionRevision = createDocumentRevision(productionPair, productionContract.contract_digest)
      const productionContext: CanvasActionContext = {
        ...fixture.context,
        contract: productionContract,
        pair: productionPair,
        revision: productionRevision,
        getCurrentSnapshot: () => ({ pair: productionPair, revision: productionRevision }),
      }

      const result = await addNode(productionContext, descriptor, { viewportCenter: { x: 900, y: 420 } })

      expect(result, descriptor.id).toMatchObject({ status: 'committed', nodeId: descriptor.id })
      expect(parsedNodes(fixture.current().definition.text).find(({ id }) => id === descriptor.id)).toEqual({
        id: descriptor.id,
        [descriptor.id]: expectedDrafts[descriptor.id],
      })
      if (result.status !== 'committed') continue
      const analysis = await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: `bundled-${descriptor.id}`,
          workflowId: result.pair.workflowId,
          pairGeneration: result.pair.generation,
          definition: {
            path: result.pair.definition.path,
            text: result.pair.definition.text,
            revision: result.pair.definition.revision,
          },
          companion: result.pair.companion
            ? {
                path: result.pair.companion.path,
                text: result.pair.companion.text,
                revision: result.pair.companion.revision,
              }
            : null,
          profile: productionContract.profile,
          contractDigest: productionContract.contract_digest,
          reason: 'explicit-validate',
        },
        productionContract,
      )
      expect(analysis, descriptor.id).toMatchObject({ structurallyValid: false, visuallyAuthorable: true })
      const draftProjection = analysis.projection as WorkflowProjection | undefined
      expect(draftProjection?.nodes.find(({ id }) => id === descriptor.id)).toMatchObject({
        id: descriptor.id,
        kind: descriptor.id,
      })
    }
  })

  it('adds after selection to the right with one dependency and one YAML transaction', async () => {
    const fixture = actionContext()

    const result = await addNode(fixture.context, contract.node_kinds[0]!, {
      afterNodeId: 'middle',
      viewportCenter: { x: 0, y: 0 },
    })

    expect(result).toMatchObject({ status: 'committed', nodeId: 'command' })
    const added = parsedNodes(fixture.current().definition.text).find(({ id }) => id === 'command')
    expect(added).toEqual({ id: 'command', command: '', depends_on: ['middle'] })
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.commitPositions).toHaveBeenCalledWith({ command: { x: 640, y: 0 } })
  })

  it('previews exact dependency/reference impacts and requires resolution before deleting referenced YAML', async () => {
    const fixture = actionContext()

    expect(previewDeleteNodes(fixture.context.projection, ['middle'], contract)).toEqual({
      nodeIds: ['middle'],
      dependencies: [
        {
          key: 'dependency:/nodes/2/depends_on/0',
          nodeId: 'leaf',
          fieldPath: ['depends_on'],
          yamlPath: ['nodes', 2, 'depends_on', 0],
          dependencyId: 'middle',
        },
      ],
      references: [
        {
          key: 'reference:/nodes/2/prompt:4-18',
          nodeId: 'leaf',
          fieldPath: ['prompt'],
          yamlPath: ['nodes', 2, 'prompt'],
          value: 'Use $middle.output',
          referencedId: 'middle',
          occurrence: 0,
          start: 4,
          end: 18,
        },
      ],
    })

    const result = await deleteNodes(fixture.context, ['middle'])
    expect(result).toMatchObject({ status: 'resolution_required' })
    expect(fixture.apply).not.toHaveBeenCalled()
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('reports each surviving nested repeated reference exactly and rejects without a patch', async () => {
    const nestedContract: AuthoringContract = {
      ...contract,
      contract_digest: `sha256:${'b'.repeat(64)}`,
      definition_schema: {
        ...contract.definition_schema,
        properties: {
          ...(contract.definition_schema.properties as Record<string, unknown>),
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                depends_on: { type: 'array', items: { type: 'string' } },
                command: { type: 'string' },
                prompt: { type: 'string' },
                settings: { type: 'object', additionalProperties: true },
              },
              required: ['id'],
              additionalProperties: false,
            },
          },
        },
      },
      semantic_rules: contract.semantic_rules.map((rule) =>
        rule.id === 'output-reference-v1' ? { ...rule, field_paths: ['nodes[].settings'] } : rule,
      ),
    }
    const text = source.replace(
      '    prompt: "Use $middle.output"',
      '    prompt: leaf\n    settings:\n      messages:\n        - "$middle.output then $middle.output"',
    )

    const impact = previewDeleteNodes(projection(text), ['middle'], nestedContract)

    expect(impact.references).toEqual([
      {
        key: 'reference:/nodes/2/settings/messages/0:0-14',
        nodeId: 'leaf',
        fieldPath: ['settings', 'messages', 0],
        yamlPath: ['nodes', 2, 'settings', 'messages', 0],
        value: '$middle.output then $middle.output',
        referencedId: 'middle',
        occurrence: 0,
        start: 0,
        end: 14,
      },
      {
        key: 'reference:/nodes/2/settings/messages/0:20-34',
        nodeId: 'leaf',
        fieldPath: ['settings', 'messages', 0],
        yamlPath: ['nodes', 2, 'settings', 'messages', 0],
        value: '$middle.output then $middle.output',
        referencedId: 'middle',
        occurrence: 1,
        start: 20,
        end: 34,
      },
    ])
    const fixture = actionContext(text)
    const result = await deleteNodes({ ...fixture.context, contract: nestedContract }, ['middle'])
    expect(result).toMatchObject({ status: 'resolution_required', impact: { references: impact.references } })
    expect(fixture.apply).not.toHaveBeenCalled()
    expect(fixture.commit).not.toHaveBeenCalled()
  })

  it('atomically deletes mutual references when every reference source and target is selected', async () => {
    const text = `name: Mutual deletion
description: Internal references disappear together
nodes:
  - id: root
    command: root
  - id: left
    prompt: "$right.output"
  - id: right
    prompt: "$left.output"
`
    const fixture = actionContext(text)

    const result = await deleteNodes(fixture.context, ['left', 'right'])

    expect(result).toMatchObject({ status: 'committed' })
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.commit).toHaveBeenCalledOnce()
    expect(parsedNodes(fixture.current().definition.text)).toEqual([{ id: 'root', command: 'root' }])
  })

  it('deletes an unreferenced node and its exact downstream dependency in one transaction', async () => {
    const fixture = actionContext(source.replace('prompt: "Use $middle.output"', 'prompt: leaf'))

    const result = await deleteNodes(fixture.context, ['middle'])

    expect(result).toMatchObject({ status: 'committed' })
    expect(fixture.apply).toHaveBeenCalledOnce()
    const nodes = parsedNodes(fixture.current().definition.text)
    expect(nodes.map(({ id }) => id)).toEqual(['root', 'leaf'])
    expect(nodes[1]?.depends_on ?? []).toEqual([])
  })

  it('preserves surviving node comments and scalar styles when deleting multiple nodes', async () => {
    const text = source
      .replace('  - id: root\n    command: root', '  # root lead\n  - id: root\n    command: "root" # inline')
      .replace('prompt: "Use $middle.output"', 'prompt: |\n      leaf exact')
    const fixture = actionContext(text)

    const result = await deleteNodes(fixture.context, ['middle', 'leaf'])

    expect(result).toMatchObject({ status: 'committed' })
    expect(fixture.current().definition.text).toContain('  # root lead\n  - id: root\n    command: "root" # inline')
  })

  it('renames a node and its recognized dependency/output references as one transaction', async () => {
    const fixture = actionContext()

    const result = await renameNode(fixture.context, 'middle', 'review')

    expect(result).toMatchObject({ status: 'committed', nodeId: 'review' })
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.current().definition.text).toContain('depends_on: [review]')
    expect(fixture.current().definition.text).toContain('$review.output')
  })

  it('routes Unicode IDs through the contract transaction and rejects schema-invalid IDs', async () => {
    const unicodeSource = `name: Unicode\ndescription: Canvas rename\nnodes:\n  - id: café\n    command: prepare\n  - id: consume\n    depends_on: [café]\n    prompt: "Use $café.output"\n`
    const unicodeContract: AuthoringContract = {
      ...contract,
      semantic_rules: [
        contract.semantic_rules[0]!,
        {
          ...contract.semantic_rules[1]!,
          parameters: {
            pattern: '\\$([\\p{L}\\p{N}_.:-]+)\\.output',
            pattern_flags: 'u',
            node_id_capture_group: 1,
            require_upstream: true,
          },
        },
      ],
    }
    const fixture = actionContext(unicodeSource)
    const renamed = await renameNode({ ...fixture.context, contract: unicodeContract }, 'café', 'résumé')

    expect(renamed).toMatchObject({ status: 'committed', nodeId: 'résumé' })
    if (renamed.status === 'committed') {
      expect(parsedNodes(renamed.pair.definition.text)).toEqual([
        { id: 'résumé', command: 'prepare' },
        { id: 'consume', depends_on: ['résumé'], prompt: 'Use $résumé.output' },
      ])
    }

    const invalidFixture = actionContext(unicodeSource)
    const invalid = await renameNode({ ...invalidFixture.context, contract: unicodeContract }, 'café', 'bad/id')
    expect(invalid).toMatchObject({ status: 'rejected', code: 'mutation_invalid_workflow' })
  })
})
