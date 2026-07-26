import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import type { AuthoringContract, NodeKindDescriptor } from '$src/lib/contract/types'
import { applyWorkflowMutation } from '$src/lib/documents/transactions'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { copySelection, duplicateSelection, pasteSelection } from './duplicate-selection'

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

function contract(
  profile: AuthoringContract['profile'] = 'hermes-legacy',
  additionalProperties = true,
): AuthoringContract {
  return {
    schema_version: 1,
    contract_reader_version: 1,
    profile,
    normalizer_version: 1,
    contract_digest: `sha256:${profile === 'hermes-legacy' ? 'b'.repeat(64) : 'c'.repeat(64)}`,
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parsedNodes(text: string): Record<string, unknown>[] {
  const definition = record(parse(text))
  return Array.isArray(definition.nodes) ? definition.nodes.map(record) : []
}

function context(text = source, activeContract = contract()) {
  const currentPair = pair(text, activeContract.profile)
  const commit = vi.fn(() => undefined)
  return {
    pair: currentPair,
    projection: projection(text, activeContract.profile),
    contract: activeContract,
    positions: {
      bootstrap: { x: 0, y: 0 },
      prepare: { x: 320, y: 0 },
      review: { x: 640, y: 0 },
      finish: { x: 960, y: 0 },
    },
    applyMutation: vi.fn(applyWorkflowMutation),
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
    expect(result.positions['prepare-2']).toEqual({ x: 368, y: 48 })
    expect(result.positions['review-2']).toEqual({ x: 688, y: 48 })
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
