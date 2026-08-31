import { describe, expect, it } from 'vitest'
import {
  authoritativeNodeIds,
  clearEdgeSelection,
  commitEdgeSelection,
  emptyEdgeSelectionState,
  reconcileEdgeSelection,
} from './edge-selection-state'

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
})
