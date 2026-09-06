import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { Document, parse } from 'yaml'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import aliases from '../../../tests/fixtures/yaml/patch-golden/aliases.yaml?raw'
import ambiguousNodesAlias from '../../../tests/fixtures/yaml/patch-golden/ambiguous-nodes-alias.yaml?raw'
import richDefinition from '../../../tests/fixtures/yaml/patch-golden/rich-definition.txt?raw'
import { patchWorkflowDocument } from './patch-document'
import { parseWorkflowYaml } from './parse-document'

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

export const mutationContract: AuthoringContract = {
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

function expectUntouched(source: string, output: string, slice: string): void {
  expect(source).toContain(slice)
  expect(output).toContain(slice)
}

function expectExactPrefixAndSuffix(source: string, output: string, start: number, end: number): void {
  expect(output.startsWith(source.slice(0, start))).toBe(true)
  expect(output.endsWith(source.slice(end))).toBe(true)
}

describe('source-preserving YAML patches', () => {
  it.each([
    ['plain', 'next-value', 'plain: next-value # plain comment'],
    ['single', "next 'single'", "single: 'next ''single''' # single comment"],
    ['double', 'next "double"', 'double: "next \\"double\\"" # double comment'],
    ['literal', 'next\nliteral', 'literal: |-\n  next\n  literal\n'],
    ['folded', 'next folded value', 'folded: >-\n  next folded value\n'],
  ] as const)('source-patches an existing %s scalar without cloning the YAML document', (key, value, expected) => {
    const source = `# keep header
plain: old-value # plain comment
single: 'old ''single''' # single comment
double: "old \\"double\\"" # double comment
literal: |-
  old
  literal
folded: >-
  old folded value
unknown: {keep: "exact", spacing: [one,  two]}
# keep footer
`
    const clone = vi.spyOn(Document.prototype, 'clone')
    try {
      const result = patchWorkflowDocument(
        source,
        { type: 'set-field', document: 'definition', path: [key], value },
        mutationContract,
      )

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) return
      expect(result.text).toContain(expected)
      expect(parse(result.text)[key]).toBe(value)
      expect(result.text).toContain('unknown: {keep: "exact", spacing: [one,  two]}\n# keep footer\n')
      expect(clone).not.toHaveBeenCalled()
    } finally {
      clone.mockRestore()
    }
  })

  it.each([
    ['literal', '|-', 'next\nliteral', 'outer:\n  x: |-\n    next\n    literal\n  y: z\n'],
    ['folded', '>-', 'next folded', 'outer:\n  x: >-\n    next folded\n  y: z\n'],
  ] as const)(
    'source-patches an empty nested %s block scalar without consuming the following sibling',
    (_style, indicator, value, expected) => {
      const source = `outer:\n  x: ${indicator}\n  y: z\n`
      const clone = vi.spyOn(Document.prototype, 'clone')
      try {
        const result = patchWorkflowDocument(
          source,
          { type: 'set-field', document: 'definition', path: ['outer', 'x'], value },
          mutationContract,
        )

        expect(result).toEqual({ ok: true, text: expected })
        expect(parse(result.ok ? result.text : '')).toEqual({ outer: { x: value, y: 'z' } })
        expect(clone).not.toHaveBeenCalled()
      } finally {
        clone.mockRestore()
      }
    },
  )

  it('falls back to the general patcher when a plain scalar needs a different safe style', () => {
    const source = 'name: Flow\nmetadata: old # keep comment\nunknown: keep\n'
    const clone = vi.spyOn(Document.prototype, 'clone')
    try {
      const result = patchWorkflowDocument(
        source,
        { type: 'set-field', document: 'definition', path: ['metadata'], value: 'colon: value' },
        mutationContract,
      )

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) return
      expect(parse(result.text)).toMatchObject({ metadata: 'colon: value', unknown: 'keep' })
      expect(result.text).toContain('unknown: keep\n')
      expect(clone).toHaveBeenCalledOnce()
    } finally {
      clone.mockRestore()
    }
  })

  it('rejects malformed YAML before attempting the scalar source-range fast path', () => {
    const result = patchWorkflowDocument(
      'name: [unterminated\n',
      { type: 'set-field', document: 'definition', path: ['name'], value: 'Flow' },
      mutationContract,
    )

    expect(result).toEqual({
      ok: false,
      code: 'mutation_invalid_yaml',
      message: 'The YAML document cannot be patched safely.',
    })
  })

  it('sets and deletes nested fields while preserving unrelated byte slices', () => {
    const setResult = patchWorkflowDocument(
      richDefinition,
      {
        type: 'set-field',
        document: 'definition',
        path: ['metadata', 'owner'],
        value: 'new owner',
      },
      mutationContract,
    )
    expect(setResult).toMatchObject({ ok: true })
    if (!setResult.ok) return

    const ownerStart = richDefinition.indexOf('old # edited owner')
    expectExactPrefixAndSuffix(richDefinition, setResult.text, ownerStart, ownerStart + 'old'.length)

    expect(parse(setResult.text)).toMatchObject({ metadata: { owner: 'new owner', untouched: 'keep quoted' } })
    expectUntouched(
      richDefinition,
      setResult.text,
      'description: |-\n  Keep this multiline text.\n  Exactly as authored.\n',
    )
    expectUntouched(richDefinition, setResult.text, 'settings: {retries: 2, mode: "careful"}\n')
    expectUntouched(richDefinition, setResult.text, '  # owner guidance\n')
    expect(setResult.text).toContain('  owner: new owner # edited owner\n')
    expectUntouched(richDefinition, setResult.text, '  untouched: "keep quoted" # keep this comment\n')

    const deleteResult = patchWorkflowDocument(
      setResult.text,
      {
        type: 'delete-field',
        document: 'definition',
        path: ['metadata', 'owner'],
      },
      mutationContract,
    )
    expect(deleteResult).toMatchObject({ ok: true })
    if (!deleteResult.ok) return
    const ownerLineStart = setResult.text.indexOf('  owner:')
    const ownerLineEnd = setResult.text.indexOf('\n', ownerLineStart) + 1
    expectExactPrefixAndSuffix(setResult.text, deleteResult.text, ownerLineStart, ownerLineEnd)
    expect(parse(deleteResult.text).metadata).toEqual({ untouched: 'keep quoted' })
    expectUntouched(setResult.text, deleteResult.text, '  untouched: "keep quoted" # keep this comment\n')
    expectUntouched(setResult.text, deleteResult.text, '# workflow footer\n')
  })

  it('adds an absent nested mapping field without reserializing sibling fields', () => {
    const result = patchWorkflowDocument(
      richDefinition,
      { type: 'set-field', document: 'definition', path: ['metadata', 'reviewer'], value: 'Ada' },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const insertion = richDefinition.indexOf('nodes:')
    const metadataEnd = richDefinition.indexOf('nodes:')
    expect(result.text.startsWith(richDefinition.slice(0, insertion))).toBe(true)
    expect(result.text.endsWith(richDefinition.slice(metadataEnd))).toBe(true)
    expect(parse(result.text).metadata).toMatchObject({ owner: 'old', reviewer: 'Ada' })
    expectUntouched(richDefinition, result.text, '  owner: old # edited owner\n')
    expectUntouched(richDefinition, result.text, '  untouched: "keep quoted" # keep this comment\n')
  })

  it('appends and deletes nodes without changing quoted IDs, block scalars, flow collections, or comments', () => {
    const added = patchWorkflowDocument(
      richDefinition,
      {
        type: 'add-node',
        scopeKey: 'root',
        afterNodeId: 'prepare',
        node: { id: 'middle', depends_on: ['prepare'], command: 'middle' },
      },
      mutationContract,
    )
    expect(added).toMatchObject({ ok: true })
    if (!added.ok) return
    expect(parse(added.text).nodes.map((node: { id: string }) => node.id)).toEqual(['prepare', 'middle', 'consume'])
    expectUntouched(richDefinition, added.text, '  - id: "prepare"\n')
    expectUntouched(richDefinition, added.text, "    command: |-\n      printf 'prepare'\n      printf 'again'\n")
    expectUntouched(richDefinition, added.text, '    depends_on: ["prepare"]\n')
    expectUntouched(richDefinition, added.text, '# workflow footer\n')

    const deleted = patchWorkflowDocument(
      added.text,
      { type: 'delete-node', scopeKey: 'root', nodeId: 'middle' },
      mutationContract,
    )
    expect(deleted).toMatchObject({ ok: true })
    if (!deleted.ok) return
    expect(parse(deleted.text).nodes.map((node: { id: string }) => node.id)).toEqual(['prepare', 'consume'])
    expectUntouched(added.text, deleted.text, '  - id: "prepare"\n')
    expectUntouched(added.text, deleted.text, '    optional: keep-me\n')
  })

  it('renames quoted IDs, exact dependencies, and only contract-recognized reference fields', () => {
    const source = richDefinition.replace(
      '    optional: keep-me',
      '    optional: "$prepare.output must remain because this field is not contract-recognized"',
    )
    const result = patchWorkflowDocument(
      source,
      { type: 'rename-node', scopeKey: 'root', from: 'prepare', to: 'setup' },
      mutationContract,
    )
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    const value = parse(result.text)
    expect(value.nodes[0].id).toBe('setup')
    expect(value.nodes[1].depends_on).toEqual(['setup'])
    expect(value.nodes[1].prompt).toBe('Use $setup.output.value')
    expect(value.nodes[1].optional).toContain('$prepare.output')
    expect(result.text).toContain('  - id: "setup"\n')
    expectUntouched(source, result.text, "    command: |-\n      printf 'prepare'\n      printf 'again'\n")
  })

  it('honors contract reference flags while atomically renaming Unicode IDs and references', () => {
    const unicodeContract: AuthoringContract = {
      ...mutationContract,
      semantic_rules: [
        mutationContract.semantic_rules[0]!,
        {
          ...mutationContract.semantic_rules[1]!,
          parameters: {
            pattern: '\\$([\\p{L}\\p{N}_.:-]+)\\.output',
            pattern_flags: 'u',
            node_id_capture_group: 1,
            require_upstream: true,
          },
        },
      ],
    }
    const source = `name: Unicode\ndescription: Rename Unicode IDs\nnodes:\n  - id: café\n    command: prepare\n  - id: consume\n    depends_on: [café]\n    prompt: "Use $café.output"\n`

    const result = patchWorkflowDocument(
      source,
      { type: 'rename-node', scopeKey: 'root', from: 'café', to: 'résumé' },
      unicodeContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(parse(result.text).nodes).toEqual([
      { id: 'résumé', command: 'prepare' },
      { id: 'consume', depends_on: ['résumé'], prompt: 'Use $résumé.output' },
    ])
  })

  it('preserves unrelated anchors and aliases', () => {
    const result = patchWorkflowDocument(
      aliases,
      {
        type: 'set-field',
        document: 'definition',
        path: ['nodes', 0, 'command'],
        value: 'changed',
      },
      mutationContract,
    )
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(parse(result.text).nodes[0].command).toBe('changed')
    expectUntouched(aliases, result.text, 'defaults: &defaults\n  timeout: 30\n')
    expectUntouched(aliases, result.text, '  inherited: *defaults\n')
    expectUntouched(aliases, result.text, '  unchanged: *defaults\n')
  })

  it('creates an explicit local override for an unambiguous alias-derived mapping field', () => {
    const result = patchWorkflowDocument(
      aliases,
      { type: 'set-field', document: 'definition', path: ['metadata', 'inherited', 'timeout'], value: 45 },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const aliasStart = aliases.indexOf('*defaults', aliases.indexOf('inherited:'))
    expectExactPrefixAndSuffix(aliases, result.text, aliasStart, aliasStart + '*defaults'.length)
    expect(result.text).toContain('    timeout: 45\n')
    expect(result.text).not.toContain('<<:')
    expect(result.text).toContain('defaults: &defaults\n  timeout: 30\n  nested:\n    enabled: true\n    label: keep\n')
    expect(result.text).toContain('  unchanged: *defaults\n')
    expect(expectProductionValue(result.text)).toMatchObject({
      metadata: { inherited: { timeout: 45, nested: { enabled: true, label: 'keep' } } },
    })
  })

  it('materializes an alias mapping before applying a nested set under production YAML semantics', () => {
    const result = patchWorkflowDocument(
      aliases,
      {
        type: 'set-field',
        document: 'definition',
        path: ['metadata', 'inherited', 'nested', 'enabled'],
        value: false,
      },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(expectProductionValue(result.text)).toMatchObject({
      metadata: { inherited: { timeout: 30, nested: { enabled: false, label: 'keep' } } },
    })
    expect(result.text).not.toContain('<<:')
    expect(result.text).toContain('defaults: &defaults\n  timeout: 30\n  nested:\n    enabled: true\n    label: keep\n')
    expect(result.text).toContain('  unchanged: *defaults\n')
  })

  it('materializes an alias mapping before applying a nested delete under production YAML semantics', () => {
    const result = patchWorkflowDocument(
      aliases,
      {
        type: 'delete-field',
        document: 'definition',
        path: ['metadata', 'inherited', 'nested', 'enabled'],
      },
      mutationContract,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(expectProductionValue(result.text)).toMatchObject({
      metadata: { inherited: { timeout: 30, nested: { label: 'keep' } } },
    })
    expect(result.text).not.toContain('<<:')
    expect(result.text).toContain('defaults: &defaults\n  timeout: 30\n  nested:\n    enabled: true\n    label: keep\n')
    expect(result.text).toContain('  unchanged: *defaults\n')
  })

  it('refuses graph mutations when the node sequence is alias-derived and ambiguous', () => {
    const result = patchWorkflowDocument(
      ambiguousNodesAlias,
      { type: 'rename-node', scopeKey: 'root', from: 'prepare', to: 'setup' },
      mutationContract,
    )

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'mutation_ambiguous_alias' }))
  })

  it('continues refusing generic field edits that cross a graph-shaping alias', () => {
    const result = patchWorkflowDocument(
      ambiguousNodesAlias,
      { type: 'set-field', document: 'definition', path: ['nodes', 0, 'command'], value: 'changed' },
      mutationContract,
    )

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'mutation_ambiguous_alias' }))
  })

  it('preserves designated unrelated text for arbitrary safe scalar replacements', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        const result = patchWorkflowDocument(
          richDefinition,
          {
            type: 'set-field',
            document: 'definition',
            path: ['metadata', 'owner'],
            value,
          },
          mutationContract,
        )
        expect(result).toMatchObject({ ok: true })
        if (!result.ok) return
        const start = richDefinition.indexOf('old # edited owner')
        expectExactPrefixAndSuffix(richDefinition, result.text, start, start + 'old'.length)
        expect(parse(result.text).metadata.owner).toBe(value)
        expectUntouched(richDefinition, result.text, 'settings: {retries: 2, mode: "careful"}\n')
        expectUntouched(richDefinition, result.text, '# workflow footer\n')
      }),
    )
  })

  it('round-trips bounded generated node insert/delete mutations exactly', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 1, maxLength: 12 }),
        fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
        (ids, candidate) => {
          fc.pre(!ids.includes(candidate))
          const source = [
            'name: Generated',
            'description: Generated transaction property',
            'nodes:',
            ...ids.flatMap((id) => [`  - id: ${id}`, `    command: run ${id}`]),
            '',
          ].join('\n')
          const added = patchWorkflowDocument(
            source,
            { type: 'add-node', scopeKey: 'root', node: { id: candidate, command: `run ${candidate}` } },
            mutationContract,
          )
          expect(added).toMatchObject({ ok: true })
          if (!added.ok) return
          const deleted = patchWorkflowDocument(
            added.text,
            { type: 'delete-node', scopeKey: 'root', nodeId: candidate },
            mutationContract,
          )
          expect(deleted).toMatchObject({ ok: true })
          if (!deleted.ok) return
          expect(deleted.text).toBe(source)
        },
      ),
      { numRuns: 40 },
    )
  })
})

function expectProductionValue(source: string): Record<string, unknown> {
  const parsed = parseWorkflowYaml(source, {
    document: 'definition',
    maxBytes: mutationContract.limits.max_document_bytes,
  })
  expect(parsed.issues).toEqual([])
  expect(parsed.parsed).not.toBeNull()
  return (parsed.parsed?.document.toJS({ maxAliasCount: 1_000 }) ?? {}) as Record<string, unknown>
}

describe('stable scoped source patches', () => {
  it('renames only resolved body/current/previous/control references with Unicode prefixes', async () => {
    const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
    const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
    const source = (await import('../../../tests/fixtures/yaml/patch-golden/loop-group-rich.yaml?raw')).default
    const result = patchWorkflowDocument(
      source,
      { type: 'rename-node', scopeKey: 'loop-group:repeat', from: 'child', to: 'renamed' },
      contract,
    )
    const expected = source
      .replace("id: 'child'", "id: 'renamed'")
      .replace('["child"]', '["renamed"]')
      .replace('test "$child.output"', 'test "$renamed.output"')
      .replace('😀 é $child.output / $LOOP_PREV.child.output', '😀 é $renamed.output / $LOOP_PREV.renamed.output')
    expect(result).toEqual({ ok: true, text: expected })
  })
  it('adds and deletes a child in a flow body without normalizing sibling items', async () => {
    const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
    const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
    const source = 'nodes: [{id: repeat, loop_group: {nodes: [{id: child, bash: "echo", unknown: [a,  b]}]}}]\n'
    const added = patchWorkflowDocument(
      source,
      { type: 'add-node', scopeKey: 'loop-group:repeat', node: { id: 'next', bash: 'echo' } },
      contract,
    )
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.text).toContain('{id: child, bash: "echo", unknown: [a,  b]}')
    expect(
      patchWorkflowDocument(
        added.text,
        { type: 'delete-node', scopeKey: 'loop-group:repeat', nodeId: 'next' },
        contract,
      ),
    ).toEqual({ ok: true, text: source })
  })
})

it('preserves unrelated flow mapping fields when adding and removing group settings', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source = 'nodes: [{id: repeat, loop_group: {nodes: [], unknown: [a,  b]}}]\n'
  const result = patchWorkflowDocument(
    source,
    { type: 'set-field', document: 'definition', path: ['nodes', 0, 'loop_group', 'until'], value: 'done' },
    contract,
  )
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.text).toContain('nodes: [], unknown: [a,  b]')
  expect(
    patchWorkflowDocument(
      result.text,
      { type: 'delete-field', document: 'definition', path: ['nodes', 0, 'loop_group', 'until'] },
      contract,
    ),
  ).toEqual({ ok: true, text: source })
})

it('renames indexed Bash references while preserving comments, escaped/doubled dollars and literal resource names', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source =
    'name: Bash\ndescription: Bash references\nnodes:\n  - id: repeat\n    loop_group:\n      until: done\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo\n        - id: consumer\n          depends_on: [child]\n          bash: |-\n            echo "😀 $child.output"\n            # $child.output\n            echo $$child.output \\$child.output\n        - id: resource\n          command: "$child.output"\n'
  const result = patchWorkflowDocument(
    source,
    { type: 'rename-node', scopeKey: 'loop-group:repeat', from: 'child', to: 'work' },
    contract,
  )
  expect(result).toEqual({
    ok: true,
    text: source
      .replace('id: child', 'id: work')
      .replace('[child]', '[work]')
      .replace('😀 $child.output', '😀 $work.output'),
  })
})

it('emits the exact nodes-only block draft without invented group defaults', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source = 'name: Draft\ndescription: Exact draft\nnodes:\n  - id: outer\n    bash: echo\n'
  expect(
    patchWorkflowDocument(
      source,
      { type: 'add-node', scopeKey: 'root', node: { id: 'repeat_work', loop_group: { nodes: [] } } },
      contract,
    ),
  ).toEqual({ ok: true, text: source + '  - id: repeat_work\n    loop_group:\n      nodes: []\n' })
})

it('keeps sibling shadowing when a root producer is renamed', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source =
    'name: Shadowing\ndescription: Root scope\nnodes:\n  - id: child\n    bash: echo\n  - id: repeat\n    depends_on: [child]\n    loop_group:\n      until: done\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo\n        - id: consumer\n          depends_on: [child]\n          prompt: "$child.output"\n  - id: root_consumer\n    depends_on: [child]\n    prompt: "$child.output"\n'
  const expected = source
    .replace('  - id: child', '  - id: outer')
    .replace('    depends_on: [child]', '    depends_on: [outer]')
    .replace(
      '  - id: root_consumer\n    depends_on: [child]\n    prompt: "$child.output"',
      '  - id: root_consumer\n    depends_on: [outer]\n    prompt: "$outer.output"',
    )
  expect(
    patchWorkflowDocument(source, { type: 'rename-node', scopeKey: 'root', from: 'child', to: 'outer' }, contract),
  ).toEqual({ ok: true, text: expected })
})

it('retains quoted dependency scalars and their comments when connecting another node', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source =
    'nodes:\n  - id: repeat\n    loop_group:\n      nodes:\n        - id: a\n          bash: echo\n        - id: b\n          bash: echo\n        - id: c\n          bash: echo\n          depends_on:\n            - "a" # retained dependency\n'
  const result = patchWorkflowDocument(
    source,
    { type: 'set-dependencies', scopeKey: 'loop-group:repeat', nodeId: 'c', dependsOn: ['a', 'b'] },
    contract,
  )
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.text).toContain('            - "a" # retained dependency\n')
})

it('patches an existing dependency sequence locally without cloning the full YAML document', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source =
    'nodes: [{id: a, bash: echo}, {id: b, bash: echo}, {id: c, depends_on: ["a", b], bash: echo}] # retained\n'
  const cloneDocument = vi.spyOn(Document.prototype, 'clone')

  try {
    expect(
      patchWorkflowDocument(
        source,
        { type: 'set-dependencies', scopeKey: 'root', nodeId: 'c', dependsOn: ['a', 'b'] },
        contract,
      ),
    ).toEqual({ ok: true, text: source.replace('["a", b]', '[ "a", b ]') })
    expect(cloneDocument).not.toHaveBeenCalled()
  } finally {
    cloneDocument.mockRestore()
  }
})

it('returns a rejection if current reference discovery encounters an unresolved YAML alias', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  expect(
    patchWorkflowDocument(
      'unknown: *missing\nnodes: [{id: child, bash: echo}]\n',
      { type: 'rename-node', scopeKey: 'root', from: 'child', to: 'work' },
      contract,
    ),
  ).toMatchObject({ ok: false })
})

it('refuses a generic graph field edit through an anchored body shared by an alias', async () => {
  const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
  const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
  const source =
    'nodes:\n  - id: repeat\n    loop_group:\n      nodes: &body [{id: child, bash: echo}]\n  - id: sibling\n    loop_group:\n      nodes: *body\n'
  expect(
    patchWorkflowDocument(
      source,
      {
        type: 'set-field',
        document: 'definition',
        path: ['nodes', 0, 'loop_group', 'nodes', 0, 'bash'],
        value: 'changed',
      },
      contract,
    ),
  ).toMatchObject({ ok: false, code: 'mutation_ambiguous_alias' })
})

describe('flow deletion retains surviving CST trivia', () => {
  it.each(['# important a comment', '# important, a comment', '# preceding comment, before the delimiter'])(
    'keeps a surviving sequence item comment: %s',
    async (comment) => {
      const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
      const contract = (await loadBundledAuthoringContracts()).find(
        (contract) => contract.profile === 'archon-2026-07',
      )!
      const beforeDelimiter = comment.includes('before the delimiter')
      const gap = beforeDelimiter ? ` ${comment}\n , ` : `, ${comment}\n `
      const source = `nodes: [{id: repeat, loop_group: {nodes: [{id: a, bash: echo}${gap}{id: b, bash: echo}]}}]\n`
      const result = patchWorkflowDocument(
        source,
        { type: 'delete-node', scopeKey: 'loop-group:repeat', nodeId: 'b' },
        contract,
      )
      const trivia = beforeDelimiter ? ` ${comment}\n  ` : ` ${comment}\n `
      expect(result).toEqual({
        ok: true,
        text: `nodes: [{id: repeat, loop_group: {nodes: [{id: a, bash: echo}${trivia}]}}]\n`,
      })
    },
  )
  it.each(['# important nodes comment', '# important, nodes comment', '# preceding comment, before the delimiter'])(
    'keeps a surviving mapping field comment: %s',
    (comment) => {
      const beforeDelimiter = comment.includes('before the delimiter')
      const gap = beforeDelimiter ? ` ${comment}\n , ` : `, ${comment}\n `
      const source = `group: {nodes: []${gap}until: done}\n`
      const trivia = beforeDelimiter ? ` ${comment}\n  ` : ` ${comment}\n `
      expect(
        patchWorkflowDocument(
          source,
          { type: 'delete-field', document: 'definition', path: ['group', 'until'] },
          mutationContract,
        ),
      ).toEqual({ ok: true, text: `group: {nodes: []${trivia}}\n` })
    },
  )
})

it.each(['', '\nmetadata: *all'])(
  'refuses low-level body patches beneath an anchored root sequence: %s',
  async (suffix) => {
    const { loadBundledAuthoringContracts } = await import('$src/lib/contract/bundled-contracts')
    const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
    const source = `nodes: &all [{id: repeat, loop_group: {nodes: [{id: child, bash: echo}]}}]${suffix}\n`
    expect(
      patchWorkflowDocument(
        source,
        { type: 'add-node', scopeKey: 'loop-group:repeat', node: { id: 'added', bash: 'echo' } },
        contract,
      ),
    ).toMatchObject({ ok: false, code: 'mutation_ambiguous_alias' })
  },
)

it('retains following field trivia when deleting the first flow mapping entry', () => {
  const source = 'group: {until: done, # guidance, for the next field\n nodes: []}\n'
  expect(
    patchWorkflowDocument(
      source,
      { type: 'delete-field', document: 'definition', path: ['group', 'until'] },
      mutationContract,
    ),
  ).toEqual({ ok: true, text: 'group: { # guidance, for the next field\n nodes: []}\n' })
})

it('removes an actual trailing comma with the final flow mapping entry and retains its comment', () => {
  const source = 'group: {until: done, # final, comment\n }\n'
  expect(
    patchWorkflowDocument(
      source,
      { type: 'delete-field', document: 'definition', path: ['group', 'until'] },
      mutationContract,
    ),
  ).toEqual({ ok: true, text: 'group: { # final, comment\n }\n' })
})
