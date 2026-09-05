import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { applyWorkflowMutation } from '$src/lib/documents/transactions'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import type { WorkflowMutation } from './mutations'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import { referenceIndexBuildCountForTest } from '$src/lib/references/reference-index'
import { createHistoryState, recordTransaction, undoTransaction, redoTransaction } from '$src/stores/history'

const contract = (await loadBundledAuthoringContracts()).find((contract) => contract.profile === 'archon-2026-07')!
const sibling =
  '  - id: sibling\n    loop_group:\n      until: done\n      max_iterations: 2\n      nodes: [{id: child, bash: "echo", timeout: 3}]\n# footer\n'
const source =
  'name: Properties\ndescription: Scoped operations\nnodes:\n  - id: outer\n    bash: echo\n  - id: repeat\n    loop_group:\n      until: done\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo\n' +
  sibling
function pair(definition = source): WorkflowPairText {
  return {
    workflowId: 'scoped',
    generation: 1,
    savedGeneration: 1,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'workflow.yaml',
      text: definition,
      revision: 1,
      savedRevision: 1,
      diskHash: 'disk',
    },
    companion: {
      id: 'companion',
      kind: 'companion',
      path: 'workflow.hermes.yaml',
      text: 'language_compatibility: archon-2026-07\n',
      revision: 1,
      savedRevision: 1,
      diskHash: 'disk',
    },
  }
}
function analyze(current: WorkflowPairText) {
  return analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'scoped',
      workflowId: current.workflowId,
      pairGeneration: current.generation,
      definition: current.definition,
      companion: current.companion,
      profile: contract.profile,
      contractDigest: contract.contract_digest,
      reason: 'explicit-validate',
    },
    contract,
  )
}

describe('bounded scoped mutation sequences', () => {
  it('preserves scope identities, containment, DAG validity and unrelated bytes across settings/connect/disconnect/rename/delete and copied-node insertion', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), fc.boolean(), async (count, reorder) => {
        let current = pair(
          reorder
            ? source
                .replace('  - id: outer\n    bash: echo\n', '')
                .replace(sibling, sibling.replace('# footer\n', '  - id: outer\n    bash: echo\n# footer\n'))
            : source,
        )
        const untouched = parse(current.definition.text).nodes.find((node: { id: string }) => node.id === 'sibling')
        const groupIndex = reorder ? 0 : 1
        let analysis = await analyze(current)
        expect(analysis.structurallyValid, JSON.stringify(analysis.issues)).toBe(true)
        const mutations: WorkflowMutation[] = [
          {
            type: 'set-field',
            document: 'definition',
            path: ['nodes', groupIndex, 'loop_group', 'max_iterations'],
            value: count,
          },
        ]
        for (let index = 0; index < count; index++) {
          const id = `copy_${index}`
          // Copy/duplicate/paste are compositions of ordinary scoped additions; action policy is Task 8.
          const copied = structuredClone({ id, bash: 'echo' })
          mutations.push(
            { type: 'add-node', scopeKey: 'loop-group:repeat', node: copied },
            { type: 'set-dependencies', scopeKey: 'loop-group:repeat', nodeId: id, dependsOn: ['child'] },
            { type: 'rename-node', scopeKey: 'loop-group:repeat', from: id, to: `${id}_renamed` },
            { type: 'set-dependencies', scopeKey: 'loop-group:repeat', nodeId: `${id}_renamed`, dependsOn: [] },
            { type: 'delete-node', scopeKey: 'loop-group:repeat', nodeId: `${id}_renamed` },
          )
        }
        for (const mutation of mutations) {
          const result = await applyWorkflowMutation(current, mutation, contract, analyze, analysis)
          expect(result, JSON.stringify({ mutation, result, source: current.definition.text })).toMatchObject({
            ok: true,
          })
          if (!result.ok || !result.analysis) return
          current = result.pair
          analysis = result.analysis
          expect(analysis.structurallyValid).toBe(true)
          const projection = analysis.projection as WorkflowProjection
          const graphs = projection.graphs
          expect(new Set(graphs.map((graph) => graph.scope.key)).size).toBe(graphs.length)
          for (const graph of graphs) {
            expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length)
            for (const node of graph.nodes)
              for (const dependency of node.dependsOn)
                expect(graph.nodes.some((node) => node.id === dependency)).toBe(true)
          }
          expect(parse(current.definition.text)).toEqual(projection.definition)
          expect(parse(current.definition.text).nodes.find((node: { id: string }) => node.id === 'sibling')).toEqual(
            untouched,
          )
          expect(current.definition.text).toContain('      nodes: [{id: child, bash: "echo", timeout: 3}]\n')
          expect(current.companion?.text).toBe(pair().companion?.text)
        }
      }),
      { numRuns: 12 },
    )
  })
  it('reuses the current reference index and analyzes the changed pair once with one undo/redo boundary', async () => {
    const current = pair()
    current.companion!.text += 'outward_action_nodes: [repeat/child]\n'
    const analysis = await analyze(current)
    const builds = referenceIndexBuildCountForTest()
    let analyses = 0
    const result = await applyWorkflowMutation(
      current,
      { type: 'rename-node', scopeKey: 'loop-group:repeat', from: 'child', to: 'work' },
      contract,
      (next) => {
        analyses++
        return analyze(next)
      },
      analysis,
    )
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(analyses).toBe(1)
    expect(referenceIndexBuildCountForTest() - builds).toBe(1)
    const history = recordTransaction(createHistoryState(), result.transaction)
    expect(history.undo).toHaveLength(1)
    const undo = undoTransaction(history, result.pair)
    expect(undo.ok).toBe(true)
    if (!undo.ok) return
    expect(undo.pair.definition.text).toBe(current.definition.text)
    expect(undo.pair.companion?.text).toBe(current.companion?.text)
    const redo = redoTransaction(undo.history, undo.pair)
    expect(redo.ok).toBe(true)
    if (redo.ok)
      expect([redo.pair.definition.text, redo.pair.companion?.text]).toEqual([
        result.pair.definition.text,
        result.pair.companion?.text,
      ])
  })
})
