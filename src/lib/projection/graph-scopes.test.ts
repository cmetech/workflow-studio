import { describe, expect, it } from 'vitest'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import legacyContractText from '../../../contracts/hermes-legacy-v2.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { discoverGraphScopes } from './graph-scopes'

async function archonContract() {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  return loaded.contract
}

async function legacyContract() {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(legacyContractText), {
    kind: 'bundled',
    identifier: 'hermes-legacy-v2.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  return loaded.contract
}

function parsedDefinition(source: string) {
  const result = parseWorkflowYaml(source, { document: 'definition', maxBytes: 2 * 1024 * 1024 })
  if (!result.parsed) throw new Error('Expected valid YAML fixture.')
  return result.parsed
}

describe('discoverGraphScopes', () => {
  it('discovers stable root and sibling loop-body scopes from the contract body path', async () => {
    const source = `name: Triage\ndescription: Scoped workflow\nnodes:\n  - id: prepare\n    command: collect\n  - id: process-tickets\n    depends_on: [prepare]\n    loop_group:\n      nodes:\n        - id: select\n          command: select ticket\n        - id: resolve\n          depends_on: [select]\n          prompt: resolve ticket\n      until: done\n      max_iterations: 3\n      unknown_group_field: keep\n  - id: process-alerts\n    loop_group:\n      nodes:\n        - id: select\n          command: select alert\n      until: done\n      max_iterations: 2\n`
    const scopes = discoverGraphScopes(parsedDefinition(source), await archonContract(), 'archon-2026-07')

    expect(
      scopes.map(({ scope, sourcePath, editorNodePrefix }) => ({ key: scope.key, sourcePath, editorNodePrefix })),
    ).toEqual([
      { key: 'root', sourcePath: ['nodes'], editorNodePrefix: '' },
      {
        key: 'loop-group:process-tickets',
        sourcePath: ['nodes', 1, 'loop_group', 'nodes'],
        editorNodePrefix: 'process-tickets/',
      },
      {
        key: 'loop-group:process-alerts',
        sourcePath: ['nodes', 2, 'loop_group', 'nodes'],
        editorNodePrefix: 'process-alerts/',
      },
    ])
    expect(scopes[1]?.outerInputs).toEqual(['prepare'])
    expect(scopes[1]?.sourceRange).toEqual({
      start: source.indexOf('- id: select', source.indexOf('loop_group')),
      end: source.indexOf('      until: done'),
    })
    expect(scopes[1]?.nodes.map((node) => `${scopes[1]!.editorNodePrefix}${node.id}`)).toEqual([
      'process-tickets/select',
      'process-tickets/resolve',
    ])
    expect(scopes[2]?.nodes.map((node) => `${scopes[2]!.editorNodePrefix}${node.id}`)).toEqual([
      'process-alerts/select',
    ])
    expect(scopes[1]?.definitionOrder).toEqual(['select', 'resolve'])
    expect(scopes[1]?.primarySinkId).toBe('resolve')
    expect(scopes[1]?.nodes[0]?.options).toEqual({})
  })

  it('keeps a body above Studio visual capacity intact and clone-safe', async () => {
    const body = Array.from(
      { length: 251 },
      (_, index) => `        - id: child-${index}\n          command: work ${index}`,
    ).join('\n')
    const source = `name: Large\ndescription: Large body\nnodes:\n  - id: repeat\n    loop_group:\n      nodes:\n${body}\n      until: done\n      max_iterations: 1\n  - id: finish\n    command: finish\n`
    const scopes = discoverGraphScopes(parsedDefinition(source), await archonContract(), 'archon-2026-07')
    const bodyScope = scopes[1]

    expect(bodyScope?.capacity).toEqual({ status: 'yaml-only', nodeCount: 251, edgeCount: 0 })
    expect(bodyScope?.nodes).toHaveLength(251)
    expect(structuredClone(scopes)).toEqual(scopes)
    expect(Object.isFrozen(scopes)).toBe(true)
  })

  it('keeps scope keys stable after reparsing the same YAML', async () => {
    const source = `name: Stable\ndescription: Keys\nnodes:\n  - id: repeat\n    loop_group:\n      nodes:\n        - id: child\n          command: work\n      until: done\n      max_iterations: 1\n`
    const contract = await archonContract()

    expect(
      discoverGraphScopes(parsedDefinition(source), contract, 'archon-2026-07').map(({ scope }) => scope.key),
    ).toEqual(discoverGraphScopes(parsedDefinition(source), contract, 'archon-2026-07').map(({ scope }) => scope.key))
  })

  it('filters invalid group outer inputs without changing the authored root dependencies', async () => {
    const source = `name: Inputs\ndescription: Filtered\nnodes:\n  - id: prepare\n    command: collect\n  - id: repeat\n    depends_on: [prepare, missing, repeat]\n    loop_group:\n      nodes:\n        - id: child\n          command: work\n      until: done\n      max_iterations: 1\n`
    const scopes = discoverGraphScopes(parsedDefinition(source), await archonContract(), 'archon-2026-07')

    expect(scopes[0]?.nodes.find(({ id }) => id === 'repeat')?.dependsOn).toEqual(['prepare', 'missing', 'repeat'])
    expect(scopes[1]?.outerInputs).toEqual(['prepare'])
  })

  it.each([
    [
      'is absent',
      (contract: Awaited<ReturnType<typeof archonContract>>) => ({
        ...contract,
        semantic_rules: contract.semantic_rules.filter(({ id }) => id !== 'scoped-output-reference-v1'),
      }),
    ],
    [
      'changes',
      (contract: Awaited<ReturnType<typeof archonContract>>) => ({
        ...contract,
        semantic_rules: contract.semantic_rules.map((rule) =>
          rule.id === 'scoped-dag-topology-v1' ? { ...rule, parameters: { ...rule.parameters, max_nodes: 513 } } : rule,
        ),
      }),
    ],
  ])('fails closed when an applicable scoped capability %s', async (_, change) => {
    const source = `name: Unsupported\ndescription: Scoped\nnodes:\n  - id: repeat\n    loop_group:\n      nodes:\n        - id: child\n          command: work\n      until: done\n      max_iterations: 1\n`
    const scopes = discoverGraphScopes(parsedDefinition(source), change(await archonContract()), 'archon-2026-07')

    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: 'scoped_dag_capability_unsupported', blocking: true }),
    )
  })

  it('permits the generated legacy root-only contract without scoped findings', async () => {
    const source = `name: Legacy\ndescription: Root only\nnodes:\n  - id: prepare\n    command: collect\n`
    const scopes = discoverGraphScopes(parsedDefinition(source), await legacyContract(), 'hermes-legacy')

    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.issues).toEqual([])
  })

  it('classifies root and body capacity independently at the 500-edge boundary', async () => {
    const bodyDependencies = Array.from({ length: 33 }, () => [] as string[])
    let edges = 0
    for (let target = 1; target < bodyDependencies.length && edges < 500; target += 1) {
      for (let source = 0; source < target && edges < 500; source += 1) {
        bodyDependencies[target]!.push(`body-${source}`)
        edges += 1
      }
    }
    const body = bodyDependencies
      .map(
        (dependsOn, index) =>
          `        - id: body-${index}\n          command: work ${index}${dependsOn.length ? `\n          depends_on: [${dependsOn.join(', ')}]` : ''}`,
      )
      .join('\n')
    const root = Array.from({ length: 250 }, (_, index) => `  - id: root-${index}\n    command: root ${index}`).join(
      '\n',
    )
    const source = `name: Independent\ndescription: Capacity\nnodes:\n${root}\n  - id: repeat\n    loop_group:\n      nodes:\n${body}\n      until: done\n      max_iterations: 1\n`
    const scopes = discoverGraphScopes(parsedDefinition(source), await archonContract(), 'archon-2026-07')

    expect(scopes[0]?.capacity).toEqual({ status: 'yaml-only', nodeCount: 251, edgeCount: 0 })
    expect(scopes[1]?.capacity).toEqual({ status: 'visual', nodeCount: 33, edgeCount: 500 })
  })
})
