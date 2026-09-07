import { describe, expect, it } from 'vitest'
import { graphFingerprint, normalizeRoute, routingFingerprint } from '$src/features/canvas/routed-layout'
import { canonicalizeJsonValue } from '$src/lib/contract/canonical-json'
import { emptyScopeLayout } from './types'
import {
  MAX_ROUTE_POINTS_PER_EDGE,
  MAX_SERIALIZED_ROUTING_BYTES,
  ROUTING_ENGINE,
  sanitizeScopeRouting,
  withoutRouting,
  type EdgeRoutePointV1,
  type ScopeRoutingV1,
} from './routing'

const edgeId = 'dependency:collect->review'
const validRouting: ScopeRoutingV1 = {
  schemaVersion: 1,
  engine: ROUTING_ENGINE,
  fingerprint: `sha256:${'a'.repeat(64)}`,
  routes: {
    [edgeId]: {
      edgeId,
      points: [
        { x: 216, y: 52 },
        { x: 320, y: 52 },
      ],
    },
  },
}

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

  it('rejects a route when collinear collapse would create a diagonal replacement segment', () => {
    expect(
      normalizeRoute([
        { x: 100, y: 30 },
        { x: 150, y: 30.5 },
        { x: 200, y: 31 },
      ]),
    ).toBeNull()
  })

  it('preserves exact first and final coordinates when endpoint-adjacent points are tolerance duplicates', () => {
    expect(
      normalizeRoute([
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100.5, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100.5, y: 0 },
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

describe('persisted scope routing', () => {
  it('[RG5] sanitizes a complete route record without retaining caller-owned objects', () => {
    const sanitized = sanitizeScopeRouting(validRouting)

    expect(sanitized).toEqual(validRouting)
    expect(sanitized).not.toBe(validRouting)
    expect(sanitized?.routes).not.toBe(validRouting.routes)
    expect(sanitized?.routes[edgeId]).not.toBe(validRouting.routes[edgeId])
    expect(sanitized?.routes[edgeId]?.points).not.toBe(validRouting.routes[edgeId]?.points)
  })

  it.each([
    ['schema version', { ...validRouting, schemaVersion: 2 }],
    ['engine', { ...validRouting, engine: 'elk-layered-orthogonal-v2' }],
    ['digest prefix', { ...validRouting, fingerprint: `sha512:${'a'.repeat(64)}` }],
    ['uppercase digest', { ...validRouting, fingerprint: `sha256:${'A'.repeat(64)}` }],
    [
      'empty record key',
      { ...validRouting, routes: { '': { edgeId: '', points: validRouting.routes[edgeId]!.points } } },
    ],
    [
      'mismatched edge ID',
      { ...validRouting, routes: { [edgeId]: { ...validRouting.routes[edgeId]!, edgeId: 'dependency:other' } } },
    ],
    ['non-string edge ID', { ...validRouting, routes: { [edgeId]: { ...validRouting.routes[edgeId]!, edgeId: 42 } } }],
    [
      'coordinate above the layout bound',
      {
        ...validRouting,
        routes: {
          [edgeId]: {
            edgeId,
            points: [
              { x: 0, y: 0 },
              { x: 1_000_001, y: 0 },
            ],
          },
        },
      },
    ],
    [
      'non-finite coordinate',
      {
        ...validRouting,
        routes: {
          [edgeId]: {
            edgeId,
            points: [
              { x: 0, y: 0 },
              { x: Number.NaN, y: 0 },
            ],
          },
        },
      },
    ],
    ['one-point route', { ...validRouting, routes: { [edgeId]: { edgeId, points: [{ x: 0, y: 0 }] } } }],
    [
      'route above the per-edge point limit',
      {
        ...validRouting,
        routes: {
          [edgeId]: {
            edgeId,
            points: Array.from({ length: MAX_ROUTE_POINTS_PER_EDGE + 1 }, (_, x) => ({ x, y: 0 })),
          },
        },
      },
    ],
    [
      'route count above the limit',
      {
        ...validRouting,
        routes: Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => {
            const id = `edge-${index}`
            return [
              id,
              {
                edgeId: id,
                points: [
                  { x: 0, y: index },
                  { x: 1, y: index },
                ],
              },
            ]
          }),
        ),
      },
    ],
    [
      'total point count above the limit',
      {
        ...validRouting,
        routes: Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => {
            const id = `dense-edge-${index}`
            return [
              id,
              {
                edgeId: id,
                points: Array.from({ length: MAX_ROUTE_POINTS_PER_EDGE }, (_, x) => ({ x, y: index })),
              },
            ]
          }),
        ),
      },
    ],
    [
      'single record key above the serialized bound',
      (() => {
        const id = 'e'.repeat(MAX_SERIALIZED_ROUTING_BYTES + 1)
        return {
          ...validRouting,
          routes: {
            [id]: {
              edgeId: id,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
              ],
            },
          },
        }
      })(),
    ],
    [
      'canonical routing payload above the serialized bound',
      (() => {
        const prefix = 'x'.repeat(Math.ceil(MAX_SERIALIZED_ROUTING_BYTES / 4))
        const routes = Object.fromEntries(
          Array.from({ length: 3 }, (_, index) => {
            const id = `${prefix}-${index}`
            return [
              id,
              {
                edgeId: id,
                points: [
                  { x: 0, y: index },
                  { x: 1, y: index },
                ],
              },
            ]
          }),
        )
        return { ...validRouting, routes }
      })(),
    ],
  ])('rejects a malformed %s', (_name, routing) => {
    expect(sanitizeScopeRouting(routing)).toBeUndefined()
  })

  it('rejects duplicate edge IDs even when the record keys differ', () => {
    expect(
      sanitizeScopeRouting({
        ...validRouting,
        routes: {
          first: {
            edgeId: 'first',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
          second: {
            edgeId: 'first',
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 1 },
            ],
          },
        },
      }),
    ).toBeUndefined()
  })

  it.each([
    ['escaped', '"'],
    ['multibyte', 'é'],
  ])('counts exact canonical UTF-8 bytes for %s route IDs after the preliminary string guard', (_name, character) => {
    const largeId = character.repeat(1_100_000)
    expect(largeId.length * 2 + ROUTING_ENGINE.length + validRouting.fingerprint.length).toBeLessThan(
      MAX_SERIALIZED_ROUTING_BYTES,
    )

    expect(
      sanitizeScopeRouting({
        ...validRouting,
        routes: {
          [largeId]: {
            edgeId: largeId,
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        },
      }),
    ).toBeUndefined()
  })

  it('accepts a canonical routing payload exactly at the 4 MiB byte limit', () => {
    const boundaryId = 'x'.repeat(2_097_046)
    const boundaryRouting = {
      ...validRouting,
      routes: {
        [boundaryId]: {
          edgeId: boundaryId,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
      },
    }
    expect(new TextEncoder().encode(canonicalizeJsonValue(boundaryRouting))).toHaveLength(MAX_SERIALIZED_ROUTING_BYTES)

    expect(sanitizeScopeRouting(boundaryRouting)).toEqual(boundaryRouting)
  })

  it('removes routing only when present and otherwise preserves scope identity', () => {
    const plain = emptyScopeLayout()
    const routed = { ...plain, routing: validRouting }

    expect(withoutRouting(plain)).toBe(plain)
    const cleared = withoutRouting(routed)
    expect(cleared).toEqual(plain)
    expect(cleared).not.toBe(routed)
  })
})
