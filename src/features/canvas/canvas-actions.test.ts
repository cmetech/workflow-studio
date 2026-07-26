import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import type { AuthoringContract, NodeKindDescriptor } from '$src/lib/contract/types'
import { applyWorkflowMutation } from '$src/lib/documents/transactions'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import {
  addNode,
  connectNodes,
  deleteNodes,
  disconnectNodes,
  previewDeleteNodes,
  renameNode,
  type CanvasActionContext,
} from './canvas-actions'

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
            id: { type: 'string' },
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
  const apply = vi.fn(applyWorkflowMutation)
  const commit = vi.fn((next: WorkflowPairText) => {
    current = next
  })
  const commitPositions = vi.fn()
  const announce = vi.fn()
  const context: CanvasActionContext = {
    pair: current,
    projection: projection(text),
    contract,
    positions: { root: { x: 0, y: 0 }, middle: { x: 320, y: 0 }, leaf: { x: 640, y: 0 } },
    applyMutation: apply,
    commit,
    commitPositions,
    announce,
  }
  return { context, apply, commit, commitPositions, announce, current: () => current }
}

describe('canvas YAML actions', () => {
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
      dependencies: [{ nodeId: 'leaf', fieldPath: ['depends_on'], dependencyId: 'middle' }],
      references: [{ nodeId: 'leaf', fieldPath: ['prompt'], value: 'Use $middle.output', referencedId: 'middle' }],
    })

    const result = await deleteNodes(fixture.context, ['middle'])
    expect(result).toMatchObject({ status: 'resolution_required' })
    expect(fixture.apply).not.toHaveBeenCalled()
    expect(fixture.commit).not.toHaveBeenCalled()
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
})
