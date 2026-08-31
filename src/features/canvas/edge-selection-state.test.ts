import { describe, expect, it } from 'vitest'
import {
  authoritativeNodeIds,
  clearEdgeSelection,
  commitEdgeSelection,
  createCanvasEdgeSelectionReconciler,
  emptyEdgeSelectionState,
  reconcileCanvasEdgeSelection,
  reconcileEdgeSelection,
} from './edge-selection-state'
import type { CanvasEdge } from './types'

describe('edge selection state', () => {
  it('keeps committed mixed selection authoritative across projection publication', () => {
    const committed = commitEdgeSelection(
      emptyEdgeSelectionState(),
      'workspace\0release.yaml',
      ['dependency:prepare->publish'],
      ['prepare'],
    )
    const refreshed = reconcileEdgeSelection(committed, 'workspace\0release.yaml', ['dependency:prepare->publish'])

    expect(refreshed.edgeIds).toEqual(['dependency:prepare->publish'])
    expect(authoritativeNodeIds(refreshed, ['stale-node'])).toEqual(['prepare'])
  })

  it('makes Escape clear authoritative over a queued projection publication', () => {
    const committed = commitEdgeSelection(
      emptyEdgeSelectionState(),
      'workspace\0release.yaml',
      ['dependency:prepare->publish'],
      ['prepare'],
    )
    const cleared = clearEdgeSelection(committed)
    const refreshed = reconcileEdgeSelection(cleared, 'workspace\0release.yaml', ['dependency:prepare->publish'])

    expect(refreshed.edgeIds).toEqual([])
    expect(authoritativeNodeIds(refreshed, [])).toEqual([])
  })

  it('prunes a removed edge so reintroducing the same id does not select it', () => {
    const committed = commitEdgeSelection(
      emptyEdgeSelectionState(),
      'workspace\0release.yaml',
      ['dependency:prepare->publish'],
      [],
    )
    const pruned = reconcileEdgeSelection(committed, 'workspace\0release.yaml', [])
    const restored = reconcileEdgeSelection(pruned, 'workspace\0release.yaml', ['dependency:prepare->publish'])

    expect(restored.edgeIds).toEqual([])
    expect(restored.nodeIds).toBeNull()
  })

  it('resets selection when a new workflow reuses the same edge id', () => {
    const committed = commitEdgeSelection(
      emptyEdgeSelectionState(),
      'workspace\0release.yaml',
      ['dependency:prepare->publish'],
      ['prepare'],
    )
    const nextWorkflow = reconcileEdgeSelection(committed, 'workspace\0deploy.yaml', ['dependency:prepare->publish'])

    expect(nextWorkflow.edgeIds).toEqual([])
    expect(nextWorkflow.nodeIds).toBeNull()
  })

  it('retains an unchanged 500-edge render array and every edge identity', () => {
    const edges: CanvasEdge[] = Array.from({ length: 500 }, (_, index) => ({
      id: `dependency:${index}->${index + 1}`,
      type: 'workflow',
      source: String(index),
      target: String(index + 1),
    }))

    const reconciled = reconcileCanvasEdgeSelection(edges, edges, [])

    expect(reconciled).toBe(edges)
    expect(reconciled.every((edge, index) => edge === edges[index])).toBe(true)
  })

  it('changes only the edge whose selection flag changed', () => {
    const edges: CanvasEdge[] = [
      { id: 'dependency:a->b', type: 'workflow', source: 'a', target: 'b' },
      { id: 'dependency:b->c', type: 'workflow', source: 'b', target: 'c' },
    ]

    const selected = reconcileCanvasEdgeSelection(edges, edges, ['dependency:b->c'])

    expect(selected).not.toBe(edges)
    expect(selected[0]).toBe(edges[0])
    expect(selected[1]).toEqual({ ...edges[1], selected: true })
  })

  it('does not reprocess an unchanged 500-edge projection with stable selection', () => {
    let propertyReads = 0
    const edges: CanvasEdge[] = Array.from(
      { length: 500 },
      (_, index) =>
        new Proxy(
          {
            id: `dependency:${index}->${index + 1}`,
            type: 'workflow',
            source: String(index),
            target: String(index + 1),
          } satisfies CanvasEdge,
          {
            get(target, property, receiver) {
              propertyReads += 1
              return Reflect.get(target, property, receiver)
            },
          },
        ),
    )
    const selectedIds = [edges[499]!.id]
    const reconcile = createCanvasEdgeSelectionReconciler()
    const selected = reconcile(edges, edges, selectedIds)
    propertyReads = 0

    const unchanged = reconcile(edges, selected, selectedIds)

    expect(unchanged).toBe(selected)
    expect(propertyReads).toBe(0)
  })
})
