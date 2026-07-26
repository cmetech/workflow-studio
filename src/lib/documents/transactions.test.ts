import { describe, expect, it } from 'vitest'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import type { WorkflowPairText } from './types'
import { applyWorkflowMutation } from './transactions'
import { createHistoryState, recordTransaction, redoTransaction, undoTransaction } from '$src/stores/history'

function field(path: string): FieldDescriptor {
  return {
    id: path,
    label: path,
    description: path,
    field_path: path,
    applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
    widget: 'text',
    section: 'general',
    order: 1,
    status: 'supported',
    examples: [],
  }
}

function nodeKind(id: string, path: string): NodeKindDescriptor {
  return { ...field(path), id, fields: [] }
}

const mutationContract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'hermes-legacy',
  normalizer_version: 1,
  contract_digest: `sha256:${'4'.repeat(64)}`,
  definition_schema: { type: 'object' },
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
      description: 'References',
      field_paths: ['nodes[].prompt'],
      applicability: {
        profiles: ['hermes-legacy'],
        documents: ['definition'],
        node_kinds: ['prompt'],
      },
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

const validSource = `name: Transactions
description: Transaction fixture
nodes:
  - id: prepare
    command: prepare
  - id: consume
    depends_on: [prepare]
    prompt: "Use $prepare.output"
`

function pair(source = validSource, revision = 3): WorkflowPairText {
  return {
    workflowId: 'transactions',
    generation: 2,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'transactions.yaml',
      text: source,
      revision,
      savedRevision: 1,
      diskHash: 'sha256:disk',
    },
    companion: {
      id: 'companion',
      kind: 'companion',
      path: 'transactions.hermes.yaml',
      text: 'note: keep exact companion bytes\n',
      revision: 5,
      savedRevision: 5,
      diskHash: 'sha256:sidecar',
    },
  }
}

describe('workflow YAML transactions', () => {
  it('creates one atomic pair transaction with revision boundaries and selection hints', async () => {
    const current = pair()
    const result = await applyWorkflowMutation(
      current,
      { type: 'rename-node', from: 'prepare', to: 'setup' },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.pair.definition.revision).toBe(4)
    expect(result.pair.companion).toEqual(current.companion)
    expect(result.transaction).toMatchObject({
      label: 'Rename node prepare to setup',
      before: { definition: validSource, companion: 'note: keep exact companion bytes\n' },
      beforeRevisions: { definition: 3, companion: 5 },
      afterRevisions: { definition: 4, companion: 5 },
      selection: { document: 'definition', nodeId: 'setup' },
    })
    expect(result.transaction.after.companion).toBe(result.transaction.before.companion)
  })

  it('rejects a delete that leaves recognized textual references for explicit user resolution', async () => {
    const result = await applyWorkflowMutation(pair(), { type: 'delete-node', nodeId: 'prepare' }, mutationContract)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'mutation_requires_resolution',
        references: [expect.objectContaining({ nodeId: 'consume', fieldPath: ['prompt'] })],
      }),
    )
  })

  it('removes exact dependency occurrences when deleting an otherwise unreferenced node', async () => {
    const source = validSource.replace('    prompt: "Use $prepare.output"', '    prompt: consume')
    const result = await applyWorkflowMutation(
      pair(source),
      { type: 'delete-node', nodeId: 'prepare' },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.pair.definition.text).not.toContain('id: prepare')
    expect(result.pair.definition.text).not.toContain('depends_on: [prepare]')
  })

  it('rejects dependency mutations that would create an invalid DAG', async () => {
    const result = await applyWorkflowMutation(
      pair(),
      { type: 'set-dependencies', nodeId: 'prepare', dependsOn: ['consume'] },
      mutationContract,
    )

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'mutation_invalid_workflow' }))
    if (!result.ok && result.code === 'mutation_invalid_workflow') {
      expect(result.issues.map(({ code }) => code)).toContain('dependency_cycle')
    }
  })

  it('supports exact undo/redo, clears redo on a new command, and detects revision conflicts', async () => {
    const first = await applyWorkflowMutation(
      pair(),
      { type: 'rename-node', from: 'prepare', to: 'setup' },
      mutationContract,
    )
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return

    let history = recordTransaction(createHistoryState(), first.transaction)
    const undone = undoTransaction(history, first.pair)
    expect(undone).toMatchObject({ ok: true })
    if (!undone.ok) return
    expect(undone.pair.definition.text).toBe(validSource)
    expect(undone.pair.definition.revision).toBe(5)

    const redone = redoTransaction(undone.history, undone.pair)
    expect(redone).toMatchObject({ ok: true })
    if (!redone.ok) return
    expect(redone.pair.definition.text).toBe(first.pair.definition.text)

    const conflict = undoTransaction(redone.history, {
      ...redone.pair,
      definition: { ...redone.pair.definition, revision: redone.pair.definition.revision + 1 },
    })
    expect(conflict).toEqual(expect.objectContaining({ ok: false, code: 'history_revision_conflict' }))

    const second = await applyWorkflowMutation(
      undone.pair,
      { type: 'set-field', document: 'definition', path: ['description'], value: 'New description' },
      mutationContract,
    )
    expect(second).toMatchObject({ ok: true })
    if (!second.ok) return
    history = recordTransaction(undone.history, second.transaction)
    expect(history.redo).toEqual([])
  })

  it('bounds history by 200 entries and 16 MiB of exact pair text', async () => {
    const seed = pair()
    const template = await applyWorkflowMutation(
      seed,
      { type: 'set-field', document: 'definition', path: ['description'], value: 'Changed' },
      mutationContract,
    )
    expect(template).toMatchObject({ ok: true })
    if (!template.ok) return

    let countBounded = createHistoryState()
    for (let index = 0; index < 205; index += 1) {
      countBounded = recordTransaction(countBounded, {
        ...template.transaction,
        beforeRevisions: { definition: index, companion: 5 },
        afterRevisions: { definition: index + 1, companion: 5 },
      })
    }
    expect(countBounded.undo).toHaveLength(200)

    const chunk = 'x'.repeat(1024 * 1024)
    let byteBounded = createHistoryState()
    for (let index = 0; index < 20; index += 1) {
      byteBounded = recordTransaction(byteBounded, {
        ...template.transaction,
        before: { definition: chunk, companion: null },
        after: { definition: `${chunk}${index}`, companion: null },
        beforeRevisions: { definition: index, companion: null },
        afterRevisions: { definition: index + 1, companion: null },
      })
    }
    const retainedBytes = byteBounded.undo.reduce(
      (total, transaction) =>
        total + new TextEncoder().encode(transaction.before.definition + transaction.after.definition).byteLength,
      0,
    )
    expect(retainedBytes).toBeLessThanOrEqual(16 * 1024 * 1024)
  })
})
