import { describe, expect, it } from 'vitest'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import type { WorkflowPairText } from './types'
import { applyWorkflowMutation } from './transactions'
import { createHistoryState, recordTransaction, redoTransaction, undoTransaction } from '$src/stores/history'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'

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
    savedGeneration: 2,
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
  it('crosses a macrotask boundary before patching when the browser scheduler is unavailable', async () => {
    let boundaryReached = false
    let patchSawBoundary = false
    let observedPatchStart = false
    const observedContract = new Proxy(mutationContract, {
      get(target, property, receiver) {
        if (property === 'limits' && !observedPatchStart) {
          observedPatchStart = true
          patchSawBoundary = boundaryReached
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const schedulerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
    Reflect.deleteProperty(globalThis, 'scheduler')

    try {
      const boundaryChannel = new MessageChannel()
      const boundary = new Promise<void>((resolve) => {
        boundaryChannel.port1.onmessage = () => {
          boundaryReached = true
          boundaryChannel.port1.close()
          boundaryChannel.port2.close()
          resolve()
        }
      })
      boundaryChannel.port2.postMessage(undefined)
      const operation = applyWorkflowMutation(
        pair(),
        { type: 'rename-node', from: 'prepare', to: 'setup' },
        observedContract,
      )

      await boundary
      const result = await operation

      expect(result).toMatchObject({ ok: true })
      expect(patchSawBoundary).toBe(true)
    } finally {
      if (schedulerDescriptor) Object.defineProperty(globalThis, 'scheduler', schedulerDescriptor)
      else Reflect.deleteProperty(globalThis, 'scheduler')
    }
  })

  it('yields to the browser before a structural mutation starts patching YAML', async () => {
    const events: string[] = []
    let observedPatchStart = false
    const observedContract = new Proxy(mutationContract, {
      get(target, property, receiver) {
        if (property === 'limits' && !observedPatchStart) {
          observedPatchStart = true
          events.push('patch')
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const schedulerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
    Object.defineProperty(globalThis, 'scheduler', {
      configurable: true,
      value: {
        yield: async () => {
          events.push('yield')
        },
      },
    })

    try {
      const result = await applyWorkflowMutation(
        pair(),
        { type: 'rename-node', from: 'prepare', to: 'setup' },
        observedContract,
      )

      expect(result).toMatchObject({ ok: true })
      expect(events.slice(0, 2)).toEqual(['yield', 'patch'])
    } finally {
      if (schedulerDescriptor) Object.defineProperty(globalThis, 'scheduler', schedulerDescriptor)
      else Reflect.deleteProperty(globalThis, 'scheduler')
    }
  })

  it('yields again between structural YAML patching and synchronous analysis', async () => {
    const events: string[] = []
    let observedPatchStart = false
    const observedContract = new Proxy(mutationContract, {
      get(target, property, receiver) {
        if (property === 'limits' && !observedPatchStart) {
          observedPatchStart = true
          events.push('patch')
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const schedulerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
    Object.defineProperty(globalThis, 'scheduler', {
      configurable: true,
      value: {
        yield: async () => {
          events.push('yield')
        },
      },
    })

    try {
      const result = await applyWorkflowMutation(
        pair(),
        { type: 'rename-node', from: 'prepare', to: 'setup' },
        observedContract,
        async (proposedPair) => {
          events.push('analyze')
          return {
            workflowId: proposedPair.workflowId,
            pairGeneration: proposedPair.generation,
            definitionPath: proposedPair.definition.path,
            companionPath: proposedPair.companion?.path ?? null,
            definitionRevision: proposedPair.definition.revision,
            companionRevision: proposedPair.companion?.revision ?? null,
            contractDigest: mutationContract.contract_digest,
            issues: [],
            structurallyValid: true,
          }
        },
      )

      expect(result).toMatchObject({ ok: true })
      expect(events).toEqual(['yield', 'patch', 'yield', 'analyze'])
    } finally {
      if (schedulerDescriptor) Object.defineProperty(globalThis, 'scheduler', schedulerDescriptor)
      else Reflect.deleteProperty(globalThis, 'scheduler')
    }
  })

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

  it('admits only an explicit empty node-kind draft while retaining blocking schema diagnostics', async () => {
    const definitionSchema = structuredClone(mutationContract.definition_schema)
    const nodesProperty = (definitionSchema.properties as Record<string, { items?: unknown }>).nodes
    if (!nodesProperty) throw new Error('Expected the test node schema.')
    const nodes = nodesProperty.items as {
      properties: Record<string, Record<string, unknown>>
    }
    nodes.properties.command = { type: 'string', minLength: 1, examples: ['/review'] }
    nodes.properties.prompt = { type: 'string', minLength: 1, examples: ['Review'] }
    const strictContract: AuthoringContract = {
      ...mutationContract,
      contract_digest: `sha256:${'5'.repeat(64)}`,
      definition_schema: definitionSchema,
    }

    const commandResult = await applyWorkflowMutation(
      pair(),
      { type: 'add-node', node: { id: 'draft', command: '' } },
      strictContract,
    )
    const promptResult = await applyWorkflowMutation(
      pair(),
      { type: 'add-node', node: { id: 'draft', prompt: '' } },
      strictContract,
    )

    expect(commandResult).toMatchObject({ ok: true })
    expect(promptResult).toMatchObject({ ok: true })
    if (!commandResult.ok || !promptResult.ok) return
    expect(commandResult.pair.definition.text).toContain('  - id: draft\n    command: ""\n')
    expect(promptResult.pair.definition.text).toContain('  - id: draft\n    prompt: ""\n')
  })

  it('allows progressive inspector edits while two explicit bundled object drafts remain incomplete', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )
    if (!productionContract) throw new Error('Expected the bundled Archon contract.')
    const incomplete = pair(
      `name: Progressive drafts
description: Keep both drafts inspectable.
nodes:
  - id: loop
    loop: {}
  - id: approval
    approval: {}
`,
    )
    const withProfile = {
      ...incomplete,
      companion: {
        ...incomplete.companion!,
        text: 'language_compatibility: archon-2026-07\n',
      },
    }

    const progressive = await applyWorkflowMutation(
      withProfile,
      { type: 'set-field', document: 'definition', path: ['nodes', 0, 'loop', 'prompt'], value: 'Try again.' },
      productionContract,
    )
    const unknown = await applyWorkflowMutation(
      withProfile,
      { type: 'set-field', document: 'definition', path: ['nodes', 0, 'loop', 'unexpected'], value: true },
      productionContract,
    )
    const graphMutation = await applyWorkflowMutation(
      withProfile,
      { type: 'set-dependencies', nodeId: 'approval', dependsOn: ['loop'] },
      productionContract,
    )
    const unresolved = await applyWorkflowMutation(
      withProfile,
      { type: 'set-dependencies', nodeId: 'approval', dependsOn: ['missing'] },
      productionContract,
    )
    const cyclePair = {
      ...withProfile,
      definition: {
        ...withProfile.definition,
        text: withProfile.definition.text.replace('    loop: {}', '    loop: {}\n    depends_on: [approval]'),
      },
    }
    const cycle = await applyWorkflowMutation(
      cyclePair,
      { type: 'set-dependencies', nodeId: 'approval', dependsOn: ['loop'] },
      productionContract,
    )
    const duplicate = await applyWorkflowMutation(
      withProfile,
      { type: 'set-field', document: 'definition', path: ['nodes', 1, 'id'], value: 'loop' },
      productionContract,
    )
    const missingKind = await applyWorkflowMutation(
      withProfile,
      { type: 'add-node', node: { id: 'missing-kind' } },
      productionContract,
    )

    expect(progressive).toMatchObject({ ok: true })
    expect(unknown).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
    expect(graphMutation).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
    expect(unresolved).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
    expect(cycle).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
    expect(duplicate).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
    expect(missingKind).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
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

  it.each([
    ['add-node', { type: 'add-node', node: { id: 'incomplete' } } as const, 'missing_node_kind'],
    [
      'set-field',
      {
        type: 'set-field',
        document: 'definition',
        path: ['nodes', 1, 'depends_on'],
        value: ['consume'],
      } as const,
      'self_dependency',
    ],
    [
      'delete-field',
      { type: 'delete-field', document: 'definition', path: ['description'] } as const,
      'schema_required',
    ],
  ])('analyzes %s before committing the semantic mutation', async (_label, mutation, issueCode) => {
    const result = await applyWorkflowMutation(pair(), mutation, mutationContract)

    expect(result).toMatchObject({ ok: false, code: 'mutation_invalid_workflow' })
    if (!result.ok && result.code === 'mutation_invalid_workflow') {
      expect(result.issues.map(({ code }) => code)).toContain(issueCode)
    }
  })

  it('allows raw replace-document to preserve invalid editor text without semantic analysis', async () => {
    const text = 'name: [unterminated\n'
    const result = await applyWorkflowMutation(
      pair(),
      { type: 'replace-document', document: 'definition', text },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.pair.definition.text).toBe(text)
  })

  it('ignores recognized references inside the node being deleted because they do not survive', async () => {
    const source = `name: Self reference cleanup
description: Delete the only invalid node
nodes:
  - id: prepare
    prompt: "Self $prepare.output"
`
    const result = await applyWorkflowMutation(
      pair(source),
      { type: 'delete-node', nodeId: 'prepare' },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.pair.definition.text).not.toContain('$prepare.output')
  })

  it('rewrites the declared custom-pattern capture span when earlier match text repeats the node ID', async () => {
    const patternContract: AuthoringContract = {
      ...mutationContract,
      semantic_rules: mutationContract.semantic_rules.map((rule) =>
        rule.id === 'output-reference-v1'
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
    const source = validSource.replace('Use $prepare.output', 'prepare-prefix:$prepare.output')
    const result = await applyWorkflowMutation(
      pair(source),
      { type: 'rename-node', from: 'prepare', to: 'setup' },
      patternContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.pair.definition.text).toContain('prepare-prefix:$setup.output')
  })

  it('fails safely when a custom reference pattern does not expose its declared capture group', async () => {
    const invalidCaptureContract: AuthoringContract = {
      ...mutationContract,
      semantic_rules: mutationContract.semantic_rules.map((rule) =>
        rule.id === 'output-reference-v1'
          ? {
              ...rule,
              parameters: {
                pattern: '\\$([A-Za-z_][A-Za-z0-9_-]*)\\.output',
                node_id_capture_group: 2,
                require_upstream: true,
              },
            }
          : rule,
      ),
    }
    const result = await applyWorkflowMutation(
      pair(),
      { type: 'rename-node', from: 'prepare', to: 'setup' },
      invalidCaptureContract,
    )

    expect(result).toMatchObject({ ok: false, code: 'mutation_contract_invalid' })
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
    expect(undone.pair.savedGeneration).toBe(2)

    const redone = redoTransaction(undone.history, undone.pair)
    expect(redone).toMatchObject({ ok: true })
    if (!redone.ok) return
    expect(redone.pair.definition.text).toBe(first.pair.definition.text)
    expect(redone.pair.savedGeneration).toBe(2)

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

  it('clones and deeply freezes history snapshots so caller mutation cannot alter retention accounting', async () => {
    const template = await applyWorkflowMutation(
      pair(),
      { type: 'set-field', document: 'definition', path: ['description'], value: 'Changed' },
      mutationContract,
    )
    expect(template).toMatchObject({ ok: true })
    if (!template.ok) return

    const callerOwned = structuredClone(template.transaction)
    const history = recordTransaction(createHistoryState(), callerOwned)
    const retained = history.undo[0]
    expect(retained).toBeDefined()
    if (!retained) return

    ;(callerOwned.before as { definition: string }).definition = 'tampered after record'
    ;(callerOwned.mutation as unknown as { path: (string | number)[] }).path[0] = 'tampered'

    expect(retained.before.definition).toBe(validSource)
    expect(retained.mutation).toEqual(template.transaction.mutation)
    expect(Object.isFrozen(history)).toBe(true)
    expect(Object.isFrozen(history.undo)).toBe(true)
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained.mutation)).toBe(true)
  })
})
