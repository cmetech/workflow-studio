import { describe, expect, it } from 'vitest'
import { graphFingerprint, normalizeRoute, routingFingerprint } from '$src/features/canvas/routed-layout'
import { ROUTING_ENGINE, type EdgeRoutePointV1 } from './routing'

describe('routed layout normalization', () => {
  it('[RG2] removes consecutive duplicate and axis-collinear interior points without mutating input', () => {
    const points: readonly EdgeRoutePointV1[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 10 },
      { x: 24, y: 20 },
      { x: 40, y: 20 },
    ]
    const before = structuredClone(points)

    expect(normalizeRoute(points)).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 20 },
      { x: 40, y: 20 },
    ])
    expect(points).toEqual(before)
  })

  it.each([
    {
      name: 'a diagonal segment',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 1 },
      ],
    },
    {
      name: 'a non-finite x coordinate',
      points: [
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
      ],
    },
    {
      name: 'a non-finite y coordinate',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: Number.NaN },
      ],
    },
  ])('rejects $name', ({ points }) => {
    expect(normalizeRoute(points)).toBeNull()
  })

  it('accepts a segment whose off-axis drift is exactly the 0.5px geometry tolerance', () => {
    expect(
      normalizeRoute([
        { x: 0, y: 0 },
        { x: 10, y: 0.5 },
        { x: 20, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ])
  })
})

describe('routed layout fingerprints', () => {
  const nodes = [
    { id: 'collect', order: 0, width: 216, height: 104 },
    { id: 'review', order: 1, width: 232, height: 120 },
  ] as const
  const edges = [{ id: 'dependency:collect->review', source: 'collect', target: 'review', order: 0 }] as const

  it('[RG1] produces canonical lowercase SHA-256 graph fingerprints', async () => {
    const first = await graphFingerprint({ engine: ROUTING_ENGINE, scopeKey: 'root', nodes, edges })
    const reorderedProperties = await graphFingerprint({
      edges: edges.map(({ id, source, target, order }) => ({ order, target, source, id })),
      nodes: nodes.map(({ id, order, width, height }) => ({ height, width, order, id })),
      scopeKey: 'root',
      engine: ROUTING_ENGINE,
    })

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(reorderedProperties).toBe(first)
  })

  it.each([
    {
      name: 'engine',
      change: { engine: 'elk-layered-orthogonal-v2' as typeof ROUTING_ENGINE, scopeKey: 'root' as const, nodes, edges },
    },
    {
      name: 'scope',
      change: { engine: ROUTING_ENGINE, scopeKey: 'loop-group:cycle' as const, nodes, edges },
    },
    {
      name: 'node definition order',
      change: {
        engine: ROUTING_ENGINE,
        scopeKey: 'root' as const,
        nodes: [
          { ...nodes[0], order: 1 },
          { ...nodes[1], order: 0 },
        ],
        edges,
      },
    },
    {
      name: 'node dimensions',
      change: {
        engine: ROUTING_ENGINE,
        scopeKey: 'root' as const,
        nodes: [{ ...nodes[0], width: 217 }, nodes[1]],
        edges,
      },
    },
    {
      name: 'topology',
      change: {
        engine: ROUTING_ENGINE,
        scopeKey: 'root' as const,
        nodes,
        edges: [{ ...edges[0], source: 'review', target: 'collect' }],
      },
    },
  ])('changes when the $name changes', async ({ change }) => {
    const baseline = await graphFingerprint({ engine: ROUTING_ENGINE, scopeKey: 'root', nodes, edges })
    expect(await graphFingerprint(change)).not.toBe(baseline)
  })

  it('[RG1] canonicalizes position insertion order and changes for graph or position changes', async () => {
    const graph = await graphFingerprint({ engine: ROUTING_ENGINE, scopeKey: 'root', nodes, edges })
    const positions = {
      collect: { x: 32, y: 48 },
      review: { x: 384, y: 48 },
    }
    const first = await routingFingerprint({ graphFingerprint: graph, positions })
    const reversed = await routingFingerprint({
      graphFingerprint: graph,
      positions: { review: positions.review, collect: positions.collect },
    })

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(reversed).toBe(first)
    expect(await routingFingerprint({ graphFingerprint: `sha256:${'f'.repeat(64)}`, positions })).not.toBe(first)
    expect(
      await routingFingerprint({
        graphFingerprint: graph,
        positions: { ...positions, review: { ...positions.review, x: positions.review.x + 1 } },
      }),
    ).not.toBe(first)
  })
})
