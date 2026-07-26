import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import aliases from '../../../tests/fixtures/yaml/patch-golden/aliases.yaml?raw'
import ambiguousNodesAlias from '../../../tests/fixtures/yaml/patch-golden/ambiguous-nodes-alias.yaml?raw'
import richDefinition from '../../../tests/fixtures/yaml/patch-golden/rich-definition.txt?raw'
import { patchWorkflowDocument } from './patch-document'

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

describe('source-preserving YAML patches', () => {
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
    expect(parse(result.text).metadata).toMatchObject({ owner: 'old', reviewer: 'Ada' })
    expectUntouched(richDefinition, result.text, '  owner: old # edited owner\n')
    expectUntouched(richDefinition, result.text, '  untouched: "keep quoted" # keep this comment\n')
  })

  it('appends and deletes nodes without changing quoted IDs, block scalars, flow collections, or comments', () => {
    const added = patchWorkflowDocument(
      richDefinition,
      {
        type: 'add-node',
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

    const deleted = patchWorkflowDocument(added.text, { type: 'delete-node', nodeId: 'middle' }, mutationContract)
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
      { type: 'rename-node', from: 'prepare', to: 'setup' },
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
  })

  it('refuses graph mutations when the node sequence is alias-derived and ambiguous', () => {
    const result = patchWorkflowDocument(
      ambiguousNodesAlias,
      { type: 'rename-node', from: 'prepare', to: 'setup' },
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
        expect(parse(result.text).metadata.owner).toBe(value)
        expectUntouched(richDefinition, result.text, 'settings: {retries: 2, mode: "careful"}\n')
        expectUntouched(richDefinition, result.text, '# workflow footer\n')
      }),
    )
  })
})
