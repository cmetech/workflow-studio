import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { resolveGraphScope } from './graph-scope'

const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
const group = '- id: repeat\n  loop_group:\n    nodes: [{id: child, bash: echo}]\n'
describe('current CST graph scopes', () => {
  it('resolves stable group identity after root reordering', () => {
    for (const [source, index] of [
      [`nodes:\n${group}- id: outer\n  bash: echo\n`, 0],
      [`nodes:\n- id: outer\n  bash: echo\n${group}`, 1],
    ] as const) {
      expect(resolveGraphScope(parseDocument(source), 'loop-group:repeat', contract)).toMatchObject({
        ok: true,
        fields: { nodesPath: ['nodes', index, 'loop_group', 'nodes'] },
      })
    }
  })
  it.each([
    `nodes:\n${group}${group}`,
    'nodes: [{id: repeat, bash: echo}]',
    'nodes: []',
    'nodes: [{id: repeat, loop_group: {nodes: wrong}}]',
    'nodes: [{id: repeat, bash: echo, loop_group: {nodes: []}}]',
  ])('refuses stale or ambiguous group identity: %s', (source) => {
    expect(resolveGraphScope(parseDocument(source), 'loop-group:repeat', contract)).toMatchObject({
      ok: false,
      code: 'mutation_stale_scope',
    })
  })
  it('refuses graph aliases', () => {
    expect(
      resolveGraphScope(
        parseDocument('shared: &body []\nnodes: [{id: repeat, loop_group: {nodes: *body}}]'),
        'loop-group:repeat',
        contract,
      ),
    ).toMatchObject({ ok: false, code: 'mutation_ambiguous_alias' })
  })
})

it.each([
  'shared: &body []\nnodes: [{id: repeat, loop_group: {nodes: *body}}]',
  'shared: &group {nodes: []}\nnodes: [{id: repeat, loop_group: *group}]',
  'shared: &child {id: child, bash: echo}\nnodes: [{id: repeat, loop_group: {nodes: [*child]}}]',
  'nodes: [{id: repeat, loop_group: {nodes: &body [{id: child, bash: echo}]}}]',
  'shared: &deps [child]\nnodes: [{id: repeat, loop_group: {nodes: [{id: child, depends_on: *deps, bash: echo}]}}]',
])('refuses shared or alias-derived group structures without mutation: %s', (source) => {
  const document = parseDocument(source)
  const before = document.toString()
  expect(resolveGraphScope(document, 'loop-group:repeat', contract)).toMatchObject({
    ok: false,
    code: 'mutation_ambiguous_alias',
  })
  expect(document.toString()).toBe(before)
})
