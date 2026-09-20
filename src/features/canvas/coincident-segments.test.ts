import { describe, expect, it } from 'vitest'
import type { EdgeRouteV1 } from '$src/lib/layout/routing'
import { hasLongCoincidentSegment } from './routed-layout'

function routes(lines: number[][]): Record<string, EdgeRouteV1> {
  return Object.fromEntries(
    lines.map(([x1, y1, x2, y2], index) => [
      String(index),
      {
        edgeId: String(index),
        points: [
          { x: x1!, y: y1! },
          { x: x2!, y: y2! },
        ],
      },
    ]),
  )
}

describe('coincident route segments', () => {
  it('reads separated capacity geometry a bounded number of times', () => {
    let reads = 0
    const candidate = routes(Array.from({ length: 500 }, (_, i) => [0, i * 2, 100, i * 2]))
    for (const route of Object.values(candidate)) {
      for (const point of route.points) {
        for (const key of ['x', 'y'] as const) {
          const value = point[key]
          Object.defineProperty(point, key, {
            get: () => {
              reads++
              return value
            },
          })
        }
      }
    }
    expect(hasLongCoincidentSegment(candidate)).toBe(false)
    // Re-reading every route pair is quadratic even when no axes are near.
    expect(reads).toBeLessThan(500 * 40)
  })

  it.each([
    { label: 'horizontal tolerance boundary', line: [100, 0.5, 0, 0.5], overlap: true },
    { label: 'outside axis tolerance', line: [0, 0.5001, 100, 0.5001], overlap: false },
    { label: 'fan zone boundary', line: [75.5, 0, 150, 0], overlap: false },
    { label: 'beyond fan zone', line: [75.499, 0, 150, 0], overlap: true },
    { label: 'perpendicular crossing', line: [50, -50, 50, 50], overlap: false },
  ])('$label', ({ line, overlap }) => {
    expect(hasLongCoincidentSegment(routes([[0, 0, 100, 0], line]))).toBe(overlap)
  })

  it('checks vertical segments and near-equal axes across sorting boundaries', () => {
    expect(
      hasLongCoincidentSegment(
        routes([
          [0, 100, 0, 0],
          [0.5, 0, 0.5, 100],
        ]),
      ),
    ).toBe(true)
    expect(
      hasLongCoincidentSegment(
        routes([
          [0, 0, 100, 0],
          [0, 1, 100, 1],
          [0, 0.5, 100, 0.5],
        ]),
      ),
    ).toBe(true)
  })

  it('does not treat retracing within one route as overlap between routes', () => {
    expect(
      hasLongCoincidentSegment({
        one: {
          edgeId: 'one',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 0, y: 0 },
          ],
        },
      }),
    ).toBe(false)
  })

  it('matches an independent all-pairs oracle for seeded orthogonal geometry', () => {
    let seed = 19
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
    for (let sample = 0; sample < 200; sample++) {
      const lines = Array.from({ length: 20 }, () => {
        const axis = Math.floor(random() * 20) / 2
        const a = Math.floor(random() * 200) - 100
        const b = Math.floor(random() * 200) - 100
        return random() < 0.5 ? [a, axis, b, axis] : [axis, a, axis, b]
      })
      let expected = false
      for (let i = 0; i < lines.length; i++)
        for (let j = i + 1; j < lines.length; j++) {
          const a = lines[i]!,
            b = lines[j]!
          const horizontalA = a[1] === a[3],
            horizontalB = b[1] === b[3]
          if (horizontalA !== horizontalB) continue
          const axis = horizontalA ? 1 : 0,
            along = horizontalA ? 0 : 1
          if (Math.abs(a[axis]! - b[axis]!) > 0.5) continue
          const overlap =
            Math.min(Math.max(a[along]!, a[along + 2]!), Math.max(b[along]!, b[along + 2]!)) -
            Math.max(Math.min(a[along]!, a[along + 2]!), Math.min(b[along]!, b[along + 2]!))
          if (overlap > 24.5) expected = true
        }
      expect(hasLongCoincidentSegment(routes(lines)), `sample ${sample}`).toBe(expected)
    }
  })
})
