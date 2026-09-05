import { emptyIdentityChanges } from '$src/features/canvas/canvas-actions'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyScopeLayout, type LayoutRecordV2, type ScopeLayoutV1 } from '$src/lib/layout/types'
import type { GraphScopeKey, ProjectedGraph, WorkflowProjection } from '$src/lib/projection/types'
import { $activeLayout, clearActiveLayout, setActiveLayout, updateScopeLayout } from './layout'
import {
  $canvasPositions,
  $canvasSelection,
  $canvasWorkflowIdentity,
  clearCanvasState,
  moveCanvasPosition,
  setCanvasSelection,
} from './canvas'
import {
  $activeScopeKey,
  $scopeNavigationEvent,
  enterLoopGroup,
  returnToRoot,
  publishCanvasProjection,
  captureActiveScope,
  consumeScopeNavigationEvent,
  commitCanvasIdentityChanges,
  queueCanvasLayoutHistory,
} from './canvas-scope'

function graph(key: GraphScopeKey, ids = ['child']): ProjectedGraph {
  return {
    scope: {
      key,
      kind: key === 'root' ? 'root' : 'loop-group',
      workflow: { name: 'flow', profile: 'archon-2026-07' },
      ...(key === 'root' ? {} : { groupId: key.slice(11) }),
    },
    nodes: ids.map((id) => ({
      id,
      kind: key === 'root' ? 'loop_group' : 'bash',
      value: key === 'root' ? { nodes: [{ id: 'child', bash: 'echo hi' }] } : 'echo hi',
      dependsOn: [],
      options: {},
      source: { path: 'nodes', start: 0, end: 10 },
    })),
    edges: [],
    editorNodePrefix: '',
    sourcePath: ['nodes'],
    sourceRange: { start: 0, end: 10 },
    definitionOrder: ids,
    outerInputs: [],
    issues: [],
    capacity: { status: 'visual', nodeCount: ids.length, edgeCount: 0 },
  }
}
function projection(groups = ['first', 'second']): WorkflowProjection {
  return {
    name: 'flow',
    profile: 'archon-2026-07',
    definition: {},
    graphs: [graph('root', groups), ...groups.map((id) => graph(`loop-group:${id}`))],
  }
}
function state(x: number, id = 'child'): ScopeLayoutV1 {
  return {
    nodePositions: { [id]: { x, y: x + 1 } },
    viewport: { x, y: -x, zoom: 1.25 },
    selectedNodeIds: [id],
    focusTarget: { kind: 'node', nodeId: id },
    inspector: { tab: 'Advanced', scrollTop: x + 20 },
    canvasScroll: { left: x + 30, top: x + 40 },
  }
}
function layout(): LayoutRecordV2 {
  return {
    schemaVersion: 2,
    workspaceId: 'workspace',
    workflowPath: 'flow.yaml',
    activeScopeKey: 'root',
    scopeLayouts: {
      root: { ...state(0, 'first'), nodePositions: { first: { x: 0, y: 1 }, second: { x: 320, y: 0 } } },
      'loop-group:first': state(100),
      'loop-group:second': state(200),
    },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-09-05T00:00:00.000Z',
  }
}
afterEach(() => {
  clearActiveLayout()
  clearCanvasState()
  consumeScopeNavigationEvent()
})

describe('scope canvas state', () => {
  it('retains unchanged authority and sibling references on a narrow update', () => {
    const saved = layout()
    setActiveLayout(saved)
    expect($activeLayout.get()).toBe(saved)
    const listener = vi.fn()
    const unsubscribe = $activeLayout.listen(listener)
    setActiveLayout(saved)
    updateScopeLayout('root', (scope) => scope)
    expect(listener).not.toHaveBeenCalled()
    updateScopeLayout('root', (scope) => ({ ...scope, viewport: { x: 88, y: 0, zoom: 1 } }))
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']).toBe(saved.scopeLayouts['loop-group:first'])
    expect($activeLayout.get()!.scopeLayouts.root.nodePositions).toBe(saved.scopeLayouts.root.nodePositions)
    unsubscribe()
  })

  it('restores repeated child IDs with independent complete state and scope identities', () => {
    const saved = layout()
    setActiveLayout(saved)
    publishCanvasProjection('workflow', projection())
    expect(enterLoopGroup('first')).toBe(true)
    const firstIdentity = $canvasWorkflowIdentity.get()
    expect($canvasSelection.get()).toEqual(['child'])
    expect($canvasPositions.get()).toEqual(state(100).nodePositions)
    moveCanvasPosition('child', { x: 777, y: 888 })
    setCanvasSelection([])
    captureActiveScope({
      viewport: { x: 33, y: 44, zoom: 2 },
      inspector: { tab: 'Execution', scrollTop: 52 },
      canvasScroll: { left: 13, top: 21 },
      focusTarget: { kind: 'scope-heading' },
    })
    const first = $activeLayout.get()!.scopeLayouts['loop-group:first']
    enterLoopGroup('second')
    expect($canvasWorkflowIdentity.get()).not.toBe(firstIdentity)
    expect($canvasSelection.get()).toEqual(['child'])
    expect($canvasPositions.get()).toEqual(state(200).nodePositions)
    returnToRoot()
    expect($activeLayout.get()!.scopeLayouts.root).toEqual(saved.scopeLayouts.root)
    expect($canvasSelection.get()).toEqual(['first'])
    enterLoopGroup('first')
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']).toBe(first)
    expect(first).toMatchObject({
      nodePositions: { child: { x: 777, y: 888 } },
      selectedNodeIds: [],
      viewport: { x: 33, y: 44, zoom: 2 },
      inspector: { tab: 'Execution', scrollTop: 52 },
      canvasScroll: { left: 13, top: 21 },
      focusTarget: { kind: 'scope-heading' },
    })
    const current = $activeLayout.get()
    enterLoopGroup('first')
    expect($activeLayout.get()).toBe(current)
  })

  it('creates deterministic scopes only on publication and refuses unprojected navigation', () => {
    setActiveLayout({ ...layout(), scopeLayouts: { root: emptyScopeLayout() } })
    expect(enterLoopGroup('missing')).toBe(false)
    publishCanvasProjection('workflow', projection())
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']!.nodePositions).toEqual({ child: { x: 0, y: 0 } })
    const scopes = $activeLayout.get()!.scopeLayouts
    enterLoopGroup('first')
    returnToRoot()
    expect($activeLayout.get()!.scopeLayouts).toBe(scopes)
  })

  it('prunes stale children and focus while preserving valid peers and unrelated scopes', () => {
    setActiveLayout(layout())
    const before = projection()
    publishCanvasProjection('workflow', before)
    enterLoopGroup('first')
    const second = $activeLayout.get()!.scopeLayouts['loop-group:second']
    const after = {
      ...before,
      graphs: before.graphs.map((g) =>
        g.scope.key === 'loop-group:first'
          ? {
              ...graph(g.scope.key, ['next']),
              nodes: graph(g.scope.key, ['next']).nodes.map((n) => ({ ...n, value: 'different command' })),
            }
          : g,
      ),
    }
    publishCanvasProjection('workflow', after, before)
    expect($canvasSelection.get()).toEqual([])
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']!.focusTarget).toBeUndefined()
    expect($activeLayout.get()!.scopeLayouts['loop-group:second']).toBe(second)
  })

  it('deletes inactive scopes silently and explains an active scope removal once', () => {
    setActiveLayout(layout())
    const before = projection()
    publishCanvasProjection('workflow', before)
    enterLoopGroup('first')
    consumeScopeNavigationEvent()
    publishCanvasProjection('workflow', projection(['first']), before)
    expect($scopeNavigationEvent.get()).toBeNull()
    publishCanvasProjection('workflow', projection([]), projection(['first']))
    expect($activeScopeKey.get()).toBe('root')
    expect(consumeScopeNavigationEvent()?.message).toMatch(/no longer|removed/i)
    expect(consumeScopeNavigationEvent()).toBeNull()
    expect(Object.keys($activeLayout.get()!.scopeLayouts)).toEqual(['root'])
  })

  it('follows only an unambiguous group rename and preserves the body object', () => {
    setActiveLayout(layout())
    const before = projection()
    publishCanvasProjection('workflow', before)
    enterLoopGroup('first')
    const body = $activeLayout.get()!.scopeLayouts['loop-group:first']
    publishCanvasProjection('workflow', projection(['renamed', 'second']), before)
    expect($activeScopeKey.get()).toBe('loop-group:renamed')
    expect($activeLayout.get()!.scopeLayouts['loop-group:renamed']).toBe(body)
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']).toBeUndefined()
    publishCanvasProjection('workflow', projection(['alpha', 'beta']), projection(['renamed', 'second']))
    expect($activeScopeKey.get()).toBe('root')
    expect($activeLayout.get()!.scopeLayouts['loop-group:alpha']!.nodePositions.child).toEqual({ x: 0, y: 0 })
  })

  it('applies committed copy/removal mappings and restores exact scopes after undo/redo analysis', () => {
    setActiveLayout(layout())
    const initial = projection()
    publishCanvasProjection('workflow', initial)
    enterLoopGroup('first')
    const before = $activeLayout.get()!
    const tx = {
      workflowId: 'workflow',
      before: { definition: 'before', companion: null },
      after: { definition: 'after', companion: null },
    } as YamlTransaction
    const copied = projection(['first', 'second', 'copy'])
    publishCanvasProjection('workflow', copied, initial)
    commitCanvasIdentityChanges(before, tx, {
      ...emptyIdentityChanges(),
      scopeCopies: [{ from: 'loop-group:first', to: 'loop-group:copy' }],
    })
    expect($activeLayout.get()!.scopeLayouts['loop-group:copy']).toEqual(before.scopeLayouts['loop-group:first'])
    updateScopeLayout('loop-group:copy', (scope) => ({ ...scope, viewport: { x: 99, y: 99, zoom: 2 } }))
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']!.viewport).toEqual(state(100).viewport)
    expect(queueCanvasLayoutHistory(tx, 'undo')).toBe(true)
    // History state waits for the accepted nodes, so invalid/stale analysis cannot prune it.
    expect($activeLayout.get()!.scopeLayouts['loop-group:copy']).toBeDefined()
    publishCanvasProjection('workflow', initial, copied, tx.before)
    expect($activeLayout.get()!.scopeLayouts['loop-group:copy']).toBeUndefined()
    expect($activeScopeKey.get()).toBe('loop-group:first')
    expect(queueCanvasLayoutHistory(tx, 'redo')).toBe(true)
    publishCanvasProjection('workflow', copied, initial, tx.after)
    expect($activeLayout.get()!.scopeLayouts['loop-group:copy']).toEqual(before.scopeLayouts['loop-group:first'])
    const deleteTx = {
      ...tx,
      before: { definition: 'after', companion: null },
      after: { definition: 'deleted', companion: null },
    }
    const beforeDelete = $activeLayout.get()!
    const deleted = projection(['second', 'copy'])
    publishCanvasProjection('workflow', deleted, copied)
    commitCanvasIdentityChanges(beforeDelete, deleteTx, {
      ...emptyIdentityChanges(),
      removedScopes: ['loop-group:first'],
    })
    queueCanvasLayoutHistory(deleteTx, 'undo')
    publishCanvasProjection('workflow', copied, deleted, deleteTx.before)
    expect($activeLayout.get()!.scopeLayouts['loop-group:first']).toEqual(before.scopeLayouts['loop-group:first'])
    expect($canvasSelection.get()).toEqual(['child'])
  })

  it('uses an explicit scope rename mapping over provisional placement after a nonmatching analysis', () => {
    setActiveLayout(layout())
    publishCanvasProjection('workflow', projection())
    enterLoopGroup('first')
    const before = $activeLayout.get()!
    publishCanvasProjection('workflow', projection(['renamed', 'second']))
    const tx = {
      workflowId: 'workflow',
      before: { definition: 'old', companion: null },
      after: { definition: 'renamed', companion: null },
    } as YamlTransaction
    commitCanvasIdentityChanges(before, tx, {
      ...emptyIdentityChanges(),
      scopeRenames: [{ from: 'loop-group:first', to: 'loop-group:renamed' }],
    })
    expect($activeLayout.get()!.scopeLayouts['loop-group:renamed']).toBe(before.scopeLayouts['loop-group:first'])
    expect($activeScopeKey.get()).toBe('loop-group:renamed')
  })

  it('keeps scope state and reference identity through workbench surface suspension', () => {
    setActiveLayout(layout())
    const current = projection()
    publishCanvasProjection('workflow', current)
    enterLoopGroup('first')
    captureActiveScope()
    const saved = $activeLayout.get()
    clearCanvasState() // Canvas unmounted while a workbench page owns the surface.
    publishCanvasProjection('workflow', current, current)
    expect($activeLayout.get()).toBe(saved)
    expect($canvasSelection.get()).toEqual(['child'])
    expect($canvasPositions.get()).toEqual(state(100).nodePositions)
  })
})
