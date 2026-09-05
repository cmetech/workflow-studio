import { describe, expect, it } from 'vitest'
import { emptyScopeLayout } from '$src/lib/layout/types'
import type { GraphScopeKey, ProjectedGraph } from '$src/lib/projection/types'
import { canvasInstanceIdentity } from '$src/stores/canvas'
import { createMemoizedCanvasProjector } from './project-canvas'
import { createCanvasSelectionReconciler } from './reconcile-canvas-selection'

function graph(key: GraphScopeKey): ProjectedGraph {
  return {
    scope: { key, kind: 'loop-group', groupId: key.slice(11), workflow: { name: 'flow', profile: 'archon-2026-07' } },
    nodes: [
      {
        id: 'child',
        kind: 'bash',
        value: 'echo same',
        dependsOn: [],
        options: {},
        source: { path: 'nodes', start: 0, end: 10 },
      },
    ],
    edges: [],
    editorNodePrefix: '',
    sourcePath: ['nodes'],
    sourceRange: { start: 0, end: 10 },
    definitionOrder: ['child'],
    outerInputs: [],
    issues: [],
    capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
  }
}

describe('scope-qualified canvas selection reconciliation', () => {
  it('retains same-scope nodes but cannot reuse a same-named node from another scope', () => {
    const project = createMemoizedCanvasProjector()
    const reconcile = createCanvasSelectionReconciler()
    const layout = { ...emptyScopeLayout(), nodePositions: { child: { x: 0, y: 0 } } }
    const first = graph('loop-group:first')
    const firstNodes = project(first, layout).nodes
    const firstResult = reconcile(firstNodes, ['child'], undefined, canvasInstanceIdentity('flow', first.scope.key))
    const stable = reconcile(
      project(first, layout).nodes,
      ['child'],
      firstResult.nodes,
      canvasInstanceIdentity('flow', first.scope.key),
    )
    expect(stable.nodes).toBe(firstResult.nodes)
    const second = graph('loop-group:second')
    const secondNodes = project(second, layout).nodes
    expect(secondNodes[0]).not.toBe(firstNodes[0])
    const secondResult = reconcile(secondNodes, [], firstResult.nodes, canvasInstanceIdentity('flow', second.scope.key))
    expect(secondResult.nodes[0]).not.toBe(firstResult.nodes[0])
    expect(secondResult.nodes[0]?.selected).toBeFalsy()
  })
})
