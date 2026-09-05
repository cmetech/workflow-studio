import { beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import archonContractText from '../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { ContractDigest } from '$src/lib/documents/types'
import { referenceIndexBuildCountForTest } from '$src/lib/references/reference-index'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'

let contract: AuthoringContract

beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  contract = loaded.contract
})

function boundedDag(prefix: string): Record<string, unknown>[] {
  const pairs = new Set<string>()
  for (let target = 1; target < 250; target += 1) pairs.add(`${target - 1}:${target}`)
  for (let distance = 2; pairs.size < 500; distance += 1) {
    for (let target = distance; target < 250 && pairs.size < 500; target += 1) {
      pairs.add(`${target - distance}:${target}`)
    }
  }
  const dependencies = new Map<number, number[]>()
  for (const pair of pairs) {
    const [source, target] = pair.split(':').map(Number) as [number, number]
    const values = dependencies.get(target) ?? []
    values.push(source)
    dependencies.set(target, values)
  }
  return Array.from({ length: 250 }, (_, index) => {
    const ids = dependencies.get(index)?.map((source) => `${prefix}-${source}`) ?? []
    return {
      id: `${prefix}-${index}`,
      prompt: ids.length ? `Use $${ids[0]}.output` : 'Produce.',
      ...(ids.length ? { depends_on: ids } : {}),
    }
  })
}

describe('indexed reference validation performance', () => {
  it('analyzes a 250-node/500-edge root and three hidden 250-node/500-edge bodies with one index', async () => {
    const root = boundedDag('root')
    for (let group = 0; group < 3; group += 1) {
      const replacement = 247 + group
      const original = root[replacement]!
      root[replacement] = {
        id: original.id,
        ...(original.depends_on ? { depends_on: original.depends_on } : {}),
        loop_group: {
          until: 'done',
          max_iterations: 1,
          nodes: boundedDag(`body-${group}`),
        },
      }
    }
    const definition = stringify({
      name: 'Indexed performance fixture',
      description: 'Bounded root and hidden scopes.',
      nodes: root,
    })
    const beforeIndexes = referenceIndexBuildCountForTest()
    const started = performance.now()
    const analysis = await analyzeWorkflowPair(
      {
        type: 'analyze',
        requestId: 'indexed-performance',
        workflowId: 'indexed-performance',
        pairGeneration: 1,
        definition: { path: 'indexed-performance.yaml', text: definition, revision: 1 },
        companion: {
          path: 'indexed-performance.hermes.yaml',
          text: 'language_compatibility: archon-2026-07\n',
          revision: 1,
        },
        profile: 'archon-2026-07',
        contractDigest: contract.contract_digest as ContractDigest,
        reason: 'explicit-validate',
      },
      contract,
    )
    const elapsedMilliseconds = performance.now() - started

    expect(analysis.structurallyValid).toBe(true)
    expect(referenceIndexBuildCountForTest() - beforeIndexes).toBe(1)
    expect(analysis.projection).toMatchObject({
      graphs: [
        { capacity: { nodeCount: 250, edgeCount: 500 } },
        { capacity: { nodeCount: 250, edgeCount: 500 } },
        { capacity: { nodeCount: 250, edgeCount: 500 } },
        { capacity: { nodeCount: 250, edgeCount: 500 } },
      ],
    })
    expect(elapsedMilliseconds).toBeLessThan(2_000)
  })
})
