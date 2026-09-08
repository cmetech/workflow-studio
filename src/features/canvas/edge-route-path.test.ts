import { describe, expect, it } from 'vitest'
import { roundedOrthogonalPath } from './edge-route-path'
import ELK from 'elkjs/lib/elk.bundled.js'
import { arrangeWithElk } from './layout-graph'
import { showcaseRoot } from './fixtures/routed-layout-cases'
import { normalizeRoute } from './routed-layout'

describe('roundedOrthogonalPath', () => {
  it('[RG2] renders accepted sub-tolerance drift without changing either endpoint', () => {
    for (const drift of [Number.EPSILON * 64, 0.25, 0.5]) {
      const points = [
        { x: 216, y: 52 },
        { x: 400, y: 52 + drift },
      ]
      expect(normalizeRoute(points)).not.toBeNull()
      expect(roundedOrthogonalPath(points)).toBe(`M 216 52 L 400 ${52 + drift}`)
    }
    expect(
      roundedOrthogonalPath([
        { x: 216, y: 52 },
        { x: 400, y: 52.500001 },
      ]),
    ).toBe('')
  })

  it('[RG1] renders every accepted real ELK showcase route with unequal integer card heights', async () => {
    const result = await arrangeWithElk(
      {
        ...showcaseRoot.request,
        nodes: showcaseRoot.request.nodes.map((node, index) => ({ ...node, width: 216, height: 106 + index })),
      },
      new ELK(),
    )
    expect(result.type).toBe('layout-result')
    if (result.type !== 'layout-result') throw new Error('Arrangement failed')
    for (const route of Object.values(result.routes)) {
      const path = roundedOrthogonalPath(route.points)
      expect(path, route.edgeId).not.toBe('')
      expect(path).toContain(`M ${route.points[0]!.x} ${route.points[0]!.y}`)
      expect(path.endsWith(`${route.points.at(-1)!.x} ${route.points.at(-1)!.y}`)).toBe(true)
    }
  })

  it('renders horizontal and vertical turns with line and quadratic corner commands', () => {
    expect(
      roundedOrthogonalPath([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
        { x: 80, y: 30 },
      ]),
    ).toBe('M 0 0 L 32 0 Q 40 0 40 8 L 40 22 Q 40 30 48 30 L 80 30')
  })

  it('clamps a corner radius to half of the shortest adjoining segment', () => {
    expect(
      roundedOrthogonalPath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 6 },
        ],
        8,
      ),
    ).toBe('M 0 0 L 7 0 Q 10 0 10 3 L 10 6')
  })

  it('removes consecutive duplicate points without mutating the caller-owned route', () => {
    const points = Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 20, y: 0 }),
      Object.freeze({ x: 20, y: 0 }),
      Object.freeze({ x: 20, y: 20 }),
    ])
    const before = structuredClone(points)

    expect(roundedOrthogonalPath(points)).toBe('M 0 0 L 12 0 Q 20 0 20 8 L 20 20')
    expect(points).toEqual(before)
  })

  it('does not emit a zero-length line when adjoining rounded corners meet', () => {
    expect(
      roundedOrthogonalPath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        10,
      ),
    ).toBe('M 0 0 L 5 0 Q 10 0 10 5 Q 10 10 15 10 L 20 10')
  })

  it('bounds output to the validated 64-point route capacity', () => {
    const points = Array.from({ length: 64 }, (_, index) =>
      index % 2 === 0 ? { x: index * 10, y: index * 10 } : { x: (index + 1) * 10, y: (index - 1) * 10 },
    )

    expect(roundedOrthogonalPath(points).match(/[MLQ]/g)).toHaveLength(126)
    expect(roundedOrthogonalPath([...points, { x: 640, y: 640 }])).toBe('')
  })

  it.each([
    [
      'a diagonal segment',
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    ],
    [
      'a non-finite coordinate',
      [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
      ],
    ],
    [
      'an out-of-bounds coordinate',
      [
        { x: 0, y: 0 },
        { x: 1_000_001, y: 0 },
      ],
    ],
  ])('rejects %s instead of emitting unsafe SVG data', (_name, points) => {
    expect(roundedOrthogonalPath(points)).toBe('')
  })
})
