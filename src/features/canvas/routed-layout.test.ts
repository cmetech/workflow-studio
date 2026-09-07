import type { ProjectedGraph } from '$src/lib/projection/types'
import { describe, expect, it, vi } from 'vitest'
import {
  countOrthogonalCrossings,
  resolveCurrentRouting,
  graphFingerprint,
  routingFingerprint,
  validateRoutedLayout,
  type RoutedLayoutInput,
  type RoutedLayoutValidation,
} from './routed-layout'
import {
  ROUTING_ENGINE,
  type ScopeRoutingV1,
  MAX_ROUTE_POINTS_PER_EDGE,
  MAX_SERIALIZED_ROUTING_BYTES,
  MAX_TOTAL_ROUTE_POINTS,
  type EdgeRoutePointV1,
  type EdgeRouteV1,
  type RoutingFingerprintEdge,
  type RoutingFingerprintNode,
} from '$src/lib/layout/routing'

const baseNodes: readonly RoutingFingerprintNode[] = [
  { id: 'source', order: 0, width: 100, height: 60 },
  { id: 'target', order: 1, width: 100, height: 60 },
]
const baseEdges: readonly RoutingFingerprintEdge[] = [
  { id: 'dependency:source->target', source: 'source', target: 'target', order: 0 },
]
const basePositions = {
  source: { x: 0, y: 0 },
  target: { x: 200, y: 0 },
}
const baseRoutes = {
  'dependency:source->target': {
    edgeId: 'dependency:source->target',
    points: [
      { x: 100, y: 30 },
      { x: 200, y: 30 },
    ],
  },
}

function input(overrides: Partial<RoutedLayoutInput> = {}): RoutedLayoutInput {
  return {
    nodes: baseNodes,
    edges: baseEdges,
    positions: basePositions,
    routes: baseRoutes,
    ...overrides,
  }
}

function failureCode(result: RoutedLayoutValidation): string | undefined {
  return result.ok ? undefined : result.code
}

describe('validateRoutedLayout', () => {
  it('[RG2] returns one complete normalized clone for safe geometry without mutating caller data', () => {
    const candidate = input({
      routes: {
        'dependency:source->target': {
          edgeId: 'dependency:source->target',
          points: [
            { x: 100, y: 30 },
            { x: 150, y: 30 },
            { x: 150, y: 30 },
            { x: 200, y: 30 },
          ],
        },
      },
    })
    const before = structuredClone(candidate)

    const result = validateRoutedLayout(candidate)

    expect(result).toEqual({
      ok: true,
      crossingCount: 0,
      layout: {
        positions: basePositions,
        routes: baseRoutes,
      },
    })
    expect(candidate).toEqual(before)
    if (result.ok) {
      expect(result.layout.positions).not.toBe(candidate.positions)
      expect(result.layout.routes).not.toBe(candidate.routes)
    }
  })

  it('preserves own __proto__ node and edge IDs in successful output records', () => {
    const nodes = [
      { id: '__proto__', order: 0, width: 100, height: 60 },
      { id: 'target', order: 1, width: 100, height: 60 },
    ]
    const edges = [{ id: '__proto__', source: '__proto__', target: 'target', order: 0 }]
    const positions = Object.fromEntries([
      ['__proto__', { x: 0, y: 0 }],
      ['target', { x: 200, y: 0 }],
    ])
    const routes = Object.fromEntries([
      [
        '__proto__',
        {
          edgeId: '__proto__',
          points: [
            { x: 100, y: 30 },
            { x: 200, y: 30 },
          ],
        },
      ],
    ])

    const result = validateRoutedLayout({ nodes, edges, positions, routes })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.hasOwn(result.layout.positions, '__proto__')).toBe(true)
    expect(Object.hasOwn(result.layout.routes, '__proto__')).toBe(true)
    expect(result.layout.positions.__proto__).toEqual({ x: 0, y: 0 })
    expect(result.layout.routes.__proto__?.edgeId).toBe('__proto__')
  })

  it.each([
    {
      name: 'missing node position',
      candidate: input({ positions: { source: basePositions.source } }),
      code: 'node_membership_mismatch',
    },
    {
      name: 'unknown node position',
      candidate: input({ positions: { ...basePositions, unknown: { x: 0, y: 200 } } }),
      code: 'node_membership_mismatch',
    },
    {
      name: 'missing edge route',
      candidate: input({ routes: {} }),
      code: 'edge_membership_mismatch',
    },
    {
      name: 'unknown edge route',
      candidate: input({
        routes: {
          ...baseRoutes,
          unknown: { edgeId: 'unknown', points: baseRoutes['dependency:source->target'].points },
        },
      }),
      code: 'edge_membership_mismatch',
    },
    {
      name: 'route key and edge ID mismatch',
      candidate: input({
        routes: {
          'dependency:source->target': { ...baseRoutes['dependency:source->target'], edgeId: 'different' },
        },
      }),
      code: 'edge_membership_mismatch',
    },
  ])('rejects $name without retaining a partial layout', ({ candidate, code }) => {
    const result = validateRoutedLayout(candidate)
    expect(result).toEqual({ ok: false, code })
    expect('layout' in result).toBe(false)
  })

  it('returns a failure result rather than throwing for malformed route points at the worker boundary', () => {
    const malformed = input({
      routes: {
        'dependency:source->target': {
          edgeId: 'dependency:source->target',
          points: undefined,
        },
      } as unknown as RoutedLayoutInput['routes'],
    })

    expect(validateRoutedLayout(malformed)).toEqual({ ok: false, code: 'route_point_count' })
  })

  it.each([
    {
      name: 'a NaN node coordinate',
      candidate: input({ positions: { ...basePositions, source: { x: Number.NaN, y: 0 } } }),
    },
    {
      name: 'an infinite route coordinate',
      candidate: input({
        routes: {
          'dependency:source->target': {
            edgeId: 'dependency:source->target',
            points: [
              { x: 100, y: 30 },
              { x: Number.POSITIVE_INFINITY, y: 30 },
            ],
          },
        },
      }),
    },
    {
      name: 'a route coordinate outside the layout bound',
      candidate: input({
        routes: {
          'dependency:source->target': {
            edgeId: 'dependency:source->target',
            points: [
              { x: 100, y: 30 },
              { x: 1_000_000.01, y: 30 },
            ],
          },
        },
      }),
    },
    {
      name: 'a node rectangle extending outside the layout bound',
      candidate: input({ positions: { ...basePositions, target: { x: 999_950, y: 0 } } }),
    },
  ])('rejects $name', ({ candidate }) => {
    expect(failureCode(validateRoutedLayout(candidate))).toBe('coordinate_out_of_bounds')
  })

  it('accepts a node and route on the inclusive coordinate bound', () => {
    const nodes = [
      { id: 'source', order: 0, width: 100, height: 60 },
      { id: 'target', order: 1, width: 100, height: 60 },
    ]
    expect(
      validateRoutedLayout({
        nodes,
        edges: baseEdges,
        positions: { source: { x: 999_700, y: 0 }, target: { x: 999_900, y: 0 } },
        routes: {
          'dependency:source->target': {
            edgeId: 'dependency:source->target',
            points: [
              { x: 999_800, y: 30 },
              { x: 999_900, y: 30 },
            ],
          },
        },
      }).ok,
    ).toBe(true)
  })

  it.each([
    {
      name: 'fewer than two normalized points',
      points: [{ x: 100, y: 30 }],
    },
    {
      name: 'more than 64 normalized points',
      points: staircasePoints(MAX_ROUTE_POINTS_PER_EDGE + 1, 100, 200, 30, 50),
    },
  ])('rejects $name', ({ points }) => {
    const candidate = input({
      routes: { 'dependency:source->target': { edgeId: 'dependency:source->target', points } },
    })
    expect(failureCode(validateRoutedLayout(candidate))).toBe('route_point_count')
  })

  it('accepts exactly 64 normalized points', () => {
    const positions = { source: { x: 0, y: 0 }, target: { x: 2_000, y: 0 } }
    const nodes = baseNodes.map((node) => ({ ...node, height: 100 }))
    const points = staircasePoints(MAX_ROUTE_POINTS_PER_EDGE, 100, 2_000, 30, 50)
    expect(
      validateRoutedLayout({
        nodes,
        edges: baseEdges,
        positions,
        routes: { 'dependency:source->target': { edgeId: 'dependency:source->target', points } },
      }).ok,
    ).toBe(true)
  })

  it('enforces the 32,000-point aggregate boundary after normalization', () => {
    const atLimit = aggregateInput(MAX_TOTAL_ROUTE_POINTS / MAX_ROUTE_POINTS_PER_EDGE)
    const overLimit = aggregateInput(MAX_TOTAL_ROUTE_POINTS / MAX_ROUTE_POINTS_PER_EDGE + 1)

    expect(validateRoutedLayout(atLimit).ok).toBe(true)
    expect(failureCode(validateRoutedLayout(overLimit))).toBe('total_route_point_count')
  })

  it('rejects an oversized raw point aggregate before normalization allocates from it', () => {
    const points = Array.from({ length: MAX_TOTAL_ROUTE_POINTS + 1 }, () => ({ x: 100, y: 30 }))
    const routes = {
      'dependency:source->target': { edgeId: 'dependency:source->target', points },
    }

    expect(failureCode(validateRoutedLayout(input({ routes })))).toBe('total_route_point_count')
  })

  it('accepts exactly 4MiB of canonical routing and rejects the next complete identifier', () => {
    // The route JSON contributes 80 fixed bytes and contains the identifier twice.
    const exactId = 'x'.repeat((MAX_SERIALIZED_ROUTING_BYTES - 80) / 2)
    const candidate = (id: string): RoutedLayoutInput => ({
      ...input(),
      edges: [{ id, source: 'source', target: 'target', order: 0 }],
      routes: {
        [id]: {
          edgeId: id,
          points: [
            { x: 100, y: 30 },
            { x: 100, y: 31 },
            { x: 200, y: 31 },
          ],
        },
      },
    })

    expect(validateRoutedLayout(candidate(exactId)).ok).toBe(true)
    expect(failureCode(validateRoutedLayout(candidate(`${exactId}x`)))).toBe('serialized_routing_too_large')
  })

  it('rejects oversized identifiers without materializing a canonical payload above the byte cap', () => {
    const oversizedId = `dependency:${'x'.repeat(Math.ceil(MAX_SERIALIZED_ROUTING_BYTES / 2))}`
    const edges = [{ id: oversizedId, source: 'source', target: 'target', order: 0 }]
    const routes = {
      [oversizedId]: { edgeId: oversizedId, points: baseRoutes['dependency:source->target'].points },
    }
    const encode = TextEncoder.prototype.encode
    const encoding = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (
      this: TextEncoder,
      value = '',
    ) {
      if (value.length > MAX_SERIALIZED_ROUTING_BYTES) throw new RangeError('oversized allocation')
      return encode.call(this, value)
    })

    try {
      expect(validateRoutedLayout(input({ edges, routes }))).toEqual({
        ok: false,
        code: 'serialized_routing_too_large',
      })
    } finally {
      encoding.mockRestore()
    }
  })

  it('rejects a segment that is diagonal beyond the geometry tolerance', () => {
    const routes = {
      'dependency:source->target': {
        edgeId: 'dependency:source->target',
        points: [
          { x: 100, y: 30 },
          { x: 150, y: 30.5001 },
          { x: 200, y: 30 },
        ],
      },
    }
    expect(failureCode(validateRoutedLayout(input({ routes })))).toBe('route_not_orthogonal')
  })

  it.each([
    {
      name: 'source endpoint',
      points: [
        { x: 100.5001, y: 30 },
        { x: 200, y: 30 },
      ],
    },
    {
      name: 'target endpoint',
      points: [
        { x: 100, y: 30 },
        { x: 199.4999, y: 30 },
      ],
    },
    {
      name: 'source side',
      points: [
        { x: 50, y: 0 },
        { x: 50, y: -20 },
        { x: 200, y: -20 },
        { x: 200, y: 30 },
      ],
    },
    {
      name: 'target side',
      points: [
        { x: 100, y: 30 },
        { x: 150, y: 30 },
        { x: 150, y: 0 },
        { x: 250, y: 0 },
      ],
    },
  ])('rejects an incorrect $name', ({ points }) => {
    const routes = { 'dependency:source->target': { edgeId: 'dependency:source->target', points } }
    expect(failureCode(validateRoutedLayout(input({ routes })))).toBe('route_endpoint_mismatch')
  })

  it('accepts source and target endpoints at the 0.5px boundary tolerance', () => {
    const routes = {
      'dependency:source->target': {
        edgeId: 'dependency:source->target',
        points: [
          { x: 100.5, y: 30 },
          { x: 199.5, y: 30 },
        ],
      },
    }
    expect(validateRoutedLayout(input({ routes })).ok).toBe(true)
  })

  it('rejects node overlap beyond 0.5px and accepts overlap at the tolerance', () => {
    const nodes = [baseNodes[0]!, { ...baseNodes[1]!, id: 'other' }]
    const edges: readonly RoutingFingerprintEdge[] = []

    expect(
      validateRoutedLayout({
        nodes,
        edges,
        positions: { source: { x: 0, y: 0 }, other: { x: 99.5, y: 0 } },
        routes: {},
      }).ok,
    ).toBe(true)
    expect(
      failureCode(
        validateRoutedLayout({
          nodes,
          edges,
          positions: { source: { x: 0, y: 0 }, other: { x: 99.49, y: 0 } },
          routes: {},
        }),
      ),
    ).toBe('node_overlap')
  })

  it('allows 24px unrelated-node clearance within tolerance and rejects a segment that enters farther', () => {
    const nodes = [...baseNodes, { id: 'nearby', order: 2, width: 50, height: 40 }]
    const positionsAtTolerance = { ...basePositions, nearby: { x: 120, y: 53.5 } }
    const positionsBeyondTolerance = { ...basePositions, nearby: { x: 120, y: 53.49 } }

    expect(validateRoutedLayout(input({ nodes, positions: positionsAtTolerance })).ok).toBe(true)
    expect(failureCode(validateRoutedLayout(input({ nodes, positions: positionsBeyondTolerance })))).toBe(
      'route_intersects_node',
    )
  })

  it('allows a 24px shared-endpoint fan zone and rejects a longer coincident route segment', () => {
    const nodes = [
      { id: 'source', order: 0, width: 100, height: 100 },
      { id: 'upper', order: 1, width: 100, height: 60 },
      { id: 'lower', order: 2, width: 100, height: 60 },
    ]
    const positions = {
      source: { x: 0, y: 0 },
      upper: { x: 250, y: 0 },
      lower: { x: 250, y: 140 },
    }
    const edges = [
      { id: 'to-upper', source: 'source', target: 'upper', order: 0 },
      { id: 'to-lower', source: 'source', target: 'lower', order: 1 },
    ]
    const route = (fanLength: number): Readonly<Record<string, EdgeRouteV1>> => ({
      'to-upper': {
        edgeId: 'to-upper',
        points: [
          { x: 100, y: 50 },
          { x: 100 + fanLength, y: 50 },
          { x: 100 + fanLength, y: 30 },
          { x: 250, y: 30 },
        ],
      },
      'to-lower': {
        edgeId: 'to-lower',
        points: [
          { x: 100, y: 50 },
          { x: 100 + fanLength, y: 50 },
          { x: 100 + fanLength, y: 170 },
          { x: 250, y: 170 },
        ],
      },
    })

    expect(validateRoutedLayout({ nodes, edges, positions, routes: route(24) }).ok).toBe(true)
    expect(failureCode(validateRoutedLayout({ nodes, edges, positions, routes: route(24.5001) }))).toBe(
      'coincident_route_segment',
    )
  })
})

describe('countOrthogonalCrossings', () => {
  it.each([
    {
      name: 'straight chain',
      routes: routeRecord([
        [
          'first',
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        ],
        [
          'second',
          [
            { x: 100, y: 0 },
            { x: 200, y: 0 },
          ],
        ],
      ]),
      expected: 0,
    },
    {
      name: 'diamond',
      routes: routeRecord([
        [
          'upper-out',
          [
            { x: 0, y: 50 },
            { x: 40, y: 50 },
            { x: 40, y: 0 },
            { x: 80, y: 0 },
          ],
        ],
        [
          'lower-out',
          [
            { x: 0, y: 50 },
            { x: 20, y: 50 },
            { x: 20, y: 100 },
            { x: 80, y: 100 },
          ],
        ],
        [
          'upper-in',
          [
            { x: 80, y: 0 },
            { x: 120, y: 0 },
            { x: 120, y: 50 },
            { x: 160, y: 50 },
          ],
        ],
        [
          'lower-in',
          [
            { x: 80, y: 100 },
            { x: 140, y: 100 },
            { x: 140, y: 50 },
            { x: 160, y: 50 },
          ],
        ],
      ]),
      expected: 0,
    },
    {
      name: 'fan-out and fan-in',
      routes: routeRecord([
        [
          'upper',
          [
            { x: 0, y: 50 },
            { x: 20, y: 50 },
            { x: 20, y: 0 },
            { x: 80, y: 0 },
            { x: 80, y: 50 },
            { x: 100, y: 50 },
          ],
        ],
        [
          'middle',
          [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
          ],
        ],
        [
          'lower',
          [
            { x: 0, y: 50 },
            { x: 20, y: 50 },
            { x: 20, y: 100 },
            { x: 80, y: 100 },
            { x: 80, y: 50 },
            { x: 100, y: 50 },
          ],
        ],
      ]),
      expected: 0,
    },
    {
      name: 'one unavoidable crossing',
      routes: routeRecord([
        [
          'horizontal',
          [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
          ],
        ],
        [
          'vertical',
          [
            { x: 50, y: 0 },
            { x: 50, y: 100 },
          ],
        ],
      ]),
      expected: 1,
    },
  ])('[RG4] counts $name crossings', ({ routes, expected }) => {
    expect(countOrthogonalCrossings(routes)).toBe(expected)
  })
})

function staircasePoints(
  count: number,
  sourceX: number,
  targetX: number,
  sourceY: number,
  targetY: number,
): readonly EdgeRoutePointV1[] {
  if (count < 2) return [{ x: sourceX, y: sourceY }]
  const points: EdgeRoutePointV1[] = [{ x: sourceX, y: sourceY }]
  let x = sourceX
  let y = sourceY
  for (let index = 1; index < count - 1; index += 1) {
    if (index % 2 === 1) y = y === sourceY ? targetY : sourceY
    else x += (targetX - sourceX) / Math.floor((count - 1) / 2)
    points.push({ x, y })
  }
  const finalY = count % 2 === 0 ? (y === sourceY ? targetY : sourceY) : y
  points.push({ x: targetX, y: finalY })
  return points
}

function aggregateInput(edgeCount: number): RoutedLayoutInput {
  const height = edgeCount * 1_000 + 100
  const nodes = [
    { id: 'source', order: 0, width: 10, height },
    { id: 'target', order: 1, width: 10, height },
  ]
  const positions = { source: { x: 0, y: 0 }, target: { x: 2_000, y: 0 } }
  const edges: RoutingFingerprintEdge[] = []
  const routes: Record<string, EdgeRouteV1> = {}
  for (let index = 0; index < edgeCount; index += 1) {
    const id = `edge-${index}`
    const y = index * 1_000 + 20
    edges.push({ id, source: 'source', target: 'target', order: index })
    routes[id] = {
      edgeId: id,
      points: staircasePoints(MAX_ROUTE_POINTS_PER_EDGE, 10, 2_000, y, y + 10),
    }
  }
  return { nodes, edges, positions, routes }
}

function routeRecord(
  entries: readonly (readonly [string, readonly EdgeRoutePointV1[]])[],
): Readonly<Record<string, EdgeRouteV1>> {
  return Object.fromEntries(entries.map(([edgeId, points]) => [edgeId, { edgeId, points }]))
}

// A cache must match the whole graph, exact measurements and positions before rendering.
describe('resolveCurrentRouting', () => {
  const nodes = baseNodes.map((node) => ({ ...node, width: 216, height: 104 }))
  const positions = { source: { x: 0, y: 0 }, target: { x: 400, y: 0 } }
  const graph = {
    scope: { key: 'root', kind: 'root', workflow: { name: 'Release', profile: 'hermes-legacy' } },
    nodes: nodes.map(({ id }) => ({
      id,
      kind: 'command',
      value: 'Run',
      dependsOn: id === 'target' ? ['source'] : [],
      options: {},
      source: { path: '', start: 0, end: 0 },
    })),
    edges: baseEdges,
    editorNodePrefix: '',
    sourcePath: ['nodes'],
    sourceRange: { start: 0, end: 0 },
    definitionOrder: ['source', 'target'],
    outerInputs: [],
    issues: [],
    capacity: { status: 'visual', nodeCount: 2, edgeCount: 1 },
  } satisfies ProjectedGraph
  async function cache(): Promise<ScopeRoutingV1> {
    return {
      schemaVersion: 1,
      engine: ROUTING_ENGINE,
      fingerprint: await routingFingerprint({
        graphFingerprint: await graphFingerprint({ engine: ROUTING_ENGINE, scopeKey: 'root', nodes, edges: baseEdges }),
        positions,
      }),
      routes: {
        'dependency:source->target': {
          edgeId: 'dependency:source->target',
          points: [
            { x: 216, y: 52 },
            { x: 400, y: 52 },
          ],
        },
      },
    }
  }

  it('[RG5] accepts a complete current cache and preserves its exact routes', async () => {
    const routing = await cache()
    expect(await resolveCurrentRouting(graph, positions, nodes, routing)).toEqual(routing)
  })

  it.each(['position', 'dimension', 'unmeasured', 'order', 'edge', 'scope', 'partial', 'geometry', 'engine'])(
    '[RG7] rejects the complete cache for %s mismatch',
    async (change) => {
      const routing = await cache()
      const currentPositions = change === 'position' ? { ...positions, source: { x: 1, y: 0 } } : positions
      const measured =
        change === 'unmeasured'
          ? undefined
          : nodes.map((node, order) => ({
              ...node,
              ...(change === 'dimension' ? { height: 180 } : {}),
              ...(change === 'order' ? { order: 1 - order } : {}),
            }))
      const currentGraph =
        change === 'scope'
          ? { ...graph, scope: { ...graph.scope, key: 'loop-group:body' as const } }
          : change === 'edge'
            ? { ...graph, edges: [] }
            : graph
      if (change === 'partial') (routing as { routes: object }).routes = {}
      if (change === 'geometry') (routing.routes['dependency:source->target']!.points[0] as { x: number }).x = 0
      if (change === 'engine') (routing as { engine: string }).engine = 'old-engine'
      expect(await resolveCurrentRouting(currentGraph, currentPositions, measured, routing)).toBeUndefined()
    },
  )

  it('[RG7] retains content-only changes to the same geometry', async () => {
    const routing = await cache()
    const edited = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, value: 'Edited text' })) }
    expect(await resolveCurrentRouting(edited, positions, nodes, routing)).toEqual(routing)
  })
})
