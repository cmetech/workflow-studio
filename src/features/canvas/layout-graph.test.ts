import { describe, expect, it } from 'vitest'
import { layoutGraph } from './layout-graph'

describe('layoutGraph', () => {
  it('is deterministic, finite, non-overlapping, and places dependencies left of consumers', () => {
    const nodes = [{ id: 'review' }, { id: 'collect' }, { id: 'publish' }]
    const edges = [
      { id: 'dependency:review->publish', source: 'review', target: 'publish' },
      { id: 'dependency:collect->review', source: 'collect', target: 'review' },
    ]
    const beforeNodes = structuredClone(nodes)
    const beforeEdges = structuredClone(edges)

    const forward = layoutGraph(nodes, edges)
    const reverse = layoutGraph([...nodes].reverse(), [...edges].reverse())

    expect(forward).toEqual(reverse)
    expect(forward.collect!.x).toBeLessThan(forward.review!.x)
    expect(forward.review!.x).toBeLessThan(forward.publish!.x)
    expect(Object.values(forward).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    for (const [index, position] of Object.values(forward).entries()) {
      for (const other of Object.values(forward).slice(index + 1)) {
        expect(Math.abs(position.x - other.x) >= 216 || Math.abs(position.y - other.y) >= 104).toBe(true)
      }
    }
    expect(nodes).toEqual(beforeNodes)
    expect(edges).toEqual(beforeEdges)
  })
})
