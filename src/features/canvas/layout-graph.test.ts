import { describe, expect, it } from 'vitest'
import ELK from 'elkjs/lib/elk.bundled.js'
import packageJson from '../../../package.json'
import { arrangeWithElk, buildElkGraph, readElkResult } from './layout-graph'
import type { LayoutWorkerRequest } from '$src/workers/layout-worker-protocol'

const request: LayoutWorkerRequest = {
  type: 'layout',
  identity: {
    requestId: '1',
    workflowIdentity: 'w',
    pairGeneration: 1,
    scopeKey: 'root',
    graphFingerprint: `sha256:${'a'.repeat(64)}`,
    layoutRevision: 0,
  },
  nodes: [
    { id: 'z', order: 0, width: 240, height: 160 },
    { id: 'a', order: 1, width: 216, height: 104 },
  ],
  edges: [{ id: 'za', source: 'z', target: 'a', order: 0 }],
}
function result() {
  return {
    id: 'root',
    children: [
      { id: 'z', x: 32, y: 32, width: 240, height: 160 },
      { id: 'a', x: 408, y: 32, width: 216, height: 104 },
    ],
    edges: [
      {
        id: 'za',
        sources: ['z'],
        targets: ['a'],
        sections: [
          { id: 's2', startPoint: { x: 340, y: 84 }, endPoint: { x: 408, y: 84 }, incomingSections: ['s1'] },
          {
            id: 's1',
            startPoint: { x: 272, y: 84 },
            bendPoints: [{ x: 300, y: 84 }],
            endPoint: { x: 340, y: 84 },
            outgoingSections: ['s2'],
          },
        ],
      },
    ],
  }
}

describe('ELK adapter', () => {
  it('[RG13] pins the offline engine dependency', () => {
    expect(packageJson.dependencies).toHaveProperty('elkjs', '0.12.0')
  })

  it('[RG1] supplies stable measured YAML order and the versioned routing options', () => {
    const before = structuredClone(request)
    const graph = buildElkGraph(request)!
    expect(graph.children?.map(({ id, width, height }) => ({ id, width, height }))).toEqual([
      { id: 'z', width: 240, height: 160 },
      { id: 'a', width: 216, height: 104 },
    ])
    expect(graph.layoutOptions).toMatchObject({
      'org.eclipse.elk.algorithm': 'org.eclipse.elk.layered',
      'org.eclipse.elk.direction': 'RIGHT',
      'org.eclipse.elk.edgeRouting': 'ORTHOGONAL',
      'org.eclipse.elk.randomSeed': '1',
      'org.eclipse.elk.padding': '[top=32,left=32,bottom=32,right=32]',
      'org.eclipse.elk.spacing.nodeNode': '64',
      'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '136',
      'org.eclipse.elk.spacing.edgeNode': '24',
      'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'org.eclipse.elk.spacing.edgeEdge': '14',
      'org.eclipse.elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'org.eclipse.elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    })
    expect(buildElkGraph({ ...request, nodes: [...request.nodes].reverse() })).toEqual(graph)
    expect(request).toEqual(before)
  })
  it('[RG3] owns distinct fixed-order east/west ports in dependency order then ID', () => {
    const graph = buildElkGraph({
      ...request,
      nodes: [
        ...request.nodes,
        { id: 'b', order: 2, width: 216, height: 104 },
        { id: 'c', order: 3, width: 216, height: 104 },
      ],
      edges: [
        { id: 'last', source: 'z', target: 'a', order: 2 },
        { id: 'second', source: 'z', target: 'b', order: 1 },
        { id: 'first', source: 'z', target: 'c', order: 1 },
      ],
    })!
    expect(graph.edges?.map(({ id }) => id)).toEqual(['first', 'second', 'last'])
    const ports = graph.children!.flatMap((node) => node.ports!)
    expect(new Set(ports.map(({ id }) => id)).size).toBe(6)
    for (const node of graph.children!) {
      expect(node.layoutOptions).toHaveProperty('org.eclipse.elk.portConstraints', 'FIXED_ORDER')
      for (const port of node.ports!) {
        expect(port.layoutOptions).toHaveProperty('org.eclipse.elk.port.side', node.id === 'z' ? 'EAST' : 'WEST')
      }
    }
    expect(graph.children![0]!.ports!.map(({ id }) => id)).toEqual(graph.edges!.map((edge) => edge.sources[0]))
    expect(graph.edges!.every((edge) => ports.some((port) => port.id === edge.targets[0]))).toBe(true)
  })
  it('[RG1] concatenates all sections in source-to-target order and normalizes them', () => {
    const output = readElkResult(request, result())
    expect(output).toMatchObject({
      ok: true,
      layout: {
        positions: { z: { x: 32, y: 32 }, a: { x: 408, y: 32 } },
        routes: {
          za: {
            edgeId: 'za',
            points: [
              { x: 272, y: 84 },
              { x: 408, y: 84 },
            ],
          },
        },
      },
    })
  })
  it.each([
    ['unknown endpoint', { ...request, edges: [{ ...request.edges[0]!, target: 'missing' }] }],
    ['edge id matching node', { ...request, edges: [{ ...request.edges[0]!, id: 'z' }] }],
    ['duplicate node', { ...request, nodes: [...request.nodes, request.nodes[0]!] }],
    ['duplicate dependency', { ...request, edges: [...request.edges, { ...request.edges[0]!, id: 'copy' }] }],
    ['duplicate edge id', { ...request, edges: [...request.edges, request.edges[0]!] }],
    ['self edge', { ...request, edges: [{ ...request.edges[0]!, target: 'z' }] }],
    ['cycle', { ...request, edges: [...request.edges, { id: 'back', source: 'a', target: 'z', order: 1 }] }],
    [
      'node capacity',
      {
        ...request,
        nodes: Array.from({ length: 251 }, (_, order) => ({ id: `${order}`, order, width: 216, height: 104 })),
      },
    ],
    [
      'edge capacity',
      {
        ...request,
        edges: Array.from({ length: 501 }, (_, order) => ({ ...request.edges[0]!, id: `${order}`, order })),
      },
    ],
    ['unmeasured height', { ...request, nodes: [{ ...request.nodes[0]!, height: 103 }, request.nodes[1]!] }],
    ['infinite width', { ...request, nodes: [{ ...request.nodes[0]!, width: Infinity }, request.nodes[1]!] }],
    ['invalid order', { ...request, edges: [{ ...request.edges[0]!, order: NaN }] }],
  ])('[RG8] rejects %s before invoking ELK', async (_, input) => {
    expect(buildElkGraph(input)).toBeNull()
    let calls = 0
    const output = await arrangeWithElk(input, {
      layout: async () => {
        calls++
        return result()
      },
    })
    expect(output).toMatchObject({ type: 'layout-error', code: 'invalid_request', identity: request.identity })
    expect(calls).toBe(0)
  })
  it.each([
    ['unknown root', () => ({ ...result(), id: 'unrecognized' })],
    ['unknown source', () => ({ ...result(), edges: [{ ...result().edges[0], sources: ['unknown'] }] })],
    [
      'unknown section shape',
      () => ({
        ...result(),
        edges: [
          {
            ...result().edges[0],
            sections: result().edges[0]!.sections.map((section) => ({ ...section, incomingShape: 'unknown' })),
          },
        ],
      }),
    ],
    ['null', () => null],
    [
      'null bend array',
      () => ({
        ...result(),
        edges: [
          {
            ...result().edges[0],
            sections: result().edges[0]!.sections.map((section) => ({ ...section, bendPoints: null })),
          },
        ],
      }),
    ],
    [
      'null section references',
      () => ({
        ...result(),
        edges: [
          {
            ...result().edges[0],
            sections: result().edges[0]!.sections.map((section) => ({ ...section, incomingSections: null })),
          },
        ],
      }),
    ],
    ['missing sections', () => ({ ...result(), edges: [{ id: 'za' }] })],
    ['unknown node', () => ({ ...result(), children: [...result().children, { id: 'extra', x: 0, y: 0 }] })],
    ['unknown edge', () => ({ ...result(), edges: [{ ...result().edges[0], id: 'extra' }] })],
    ['duplicate child', () => ({ ...result(), children: [result().children[0], result().children[0]] })],
    ['NaN position', () => ({ ...result(), children: [{ ...result().children[0], x: NaN }, result().children[1]] })],
    [
      'infinite bend',
      () => ({
        ...result(),
        edges: [
          {
            ...result().edges[0],
            sections: [
              {
                id: 's',
                startPoint: { x: 272, y: 84 },
                bendPoints: [{ x: Infinity, y: 84 }],
                endPoint: { x: 408, y: 84 },
              },
            ],
          },
        ],
      }),
    ],
    [
      'disconnected section',
      () => ({ ...result(), edges: [{ ...result().edges[0], sections: [result().edges[0]!.sections[0]] }] }),
    ],
    [
      'too many raw points',
      () => ({
        ...result(),
        edges: [
          {
            ...result().edges[0],
            sections: [
              {
                id: 's',
                startPoint: { x: 272, y: 84 },
                bendPoints: Array.from({ length: 32001 }, () => ({ x: 300, y: 84 })),
                endPoint: { x: 408, y: 84 },
              },
            ],
          },
        ],
      }),
    ],
  ])('[RG8] rejects %s output without retry', async (_, makeResult) => {
    let calls = 0
    const output = await arrangeWithElk(request, {
      layout: async () => {
        calls++
        return makeResult()
      },
    })
    expect(output).toMatchObject({ type: 'layout-error', code: 'invalid_result' })
    expect(calls).toBe(1)
  })
  it('[RG2] does not retry node overlap', async () => {
    const input = { ...request, nodes: [...request.nodes, { id: 'blocker', order: 2, width: 216, height: 104 }] }
    const graphs: ReturnType<typeof buildElkGraph>[] = []
    const output = await arrangeWithElk(input, {
      layout: async (graph) => {
        graphs.push(graph)
        return {
          ...result(),
          children: [
            ...result().children,
            { id: 'blocker', x: 290, y: graphs.length === 1 ? 120 : 300, width: 216, height: 104 },
          ],
        }
      },
    })
    // The blocker above overlaps a node on first pass, which is deliberately NOT retryable.
    expect(output).toMatchObject({ type: 'layout-error', code: 'invalid_result' })
    expect(graphs).toHaveLength(1)
  })
  it('[RG2] retries only route clearance failures and never makes a third attempt', async () => {
    const input = { ...request, nodes: [...request.nodes, { id: 'blocker', order: 2, width: 216, height: 104 }] }
    const bad = {
      ...result(),
      children: [...result().children, { id: 'blocker', x: 290, y: -40, width: 216, height: 104 }],
    }
    // Route y=84 enters the blocker's 24px clearance without overlapping either endpoint node.
    bad.children[0] = { ...bad.children[0]!, y: 70 }
    bad.children[1] = { ...bad.children[1]!, y: 70 }
    let calls = 0
    const output = await arrangeWithElk(input, {
      layout: async () => {
        calls++
        return bad
      },
    })
    expect(output).toMatchObject({ type: 'layout-error', code: 'invalid_result' })
    expect(calls).toBe(2)
  })
  it('[RG2] accepts an expanded retry for route clearance with larger internal spacing', async () => {
    const input = { ...request, nodes: [...request.nodes, { id: 'blocker', order: 2, width: 216, height: 104 }] }
    const graphs: NonNullable<ReturnType<typeof buildElkGraph>>[] = []
    const output = await arrangeWithElk(input, {
      layout: async (graph) => {
        graphs.push(graph)
        const output = result()
        output.children[0]!.y = 70
        output.children[1]!.y = 70
        return {
          ...output,
          children: [
            ...output.children,
            { id: 'blocker', x: 290, y: graphs.length === 1 ? -40 : -300, width: 216, height: 104 },
          ],
        }
      },
    })
    expect(output).toMatchObject({ type: 'layout-result', spacingProfile: 'expanded' })
    expect(graphs).toHaveLength(2)
    expect(Number(graphs[1]!.layoutOptions!['org.eclipse.elk.spacing.nodeNode'])).toBeGreaterThan(64)
    expect(Number(graphs[1]!.layoutOptions!['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers'])).toBeGreaterThan(
      136,
    )
  })
  it('[RG2] retries coincident segments once', async () => {
    const input = {
      ...request,
      nodes: ['s1', 's2', 't1', 't2'].map((id, order) => ({ id, order, width: 216, height: 104 })),
      edges: [
        { id: 'e1', source: 's1', target: 't1', order: 0 },
        { id: 'e2', source: 's2', target: 't2', order: 1 },
      ],
    }
    let calls = 0
    const output = await arrangeWithElk(input, {
      layout: async () => {
        calls++
        return {
          id: 'root',
          children: [
            { id: 's1', x: 0, y: 0 },
            { id: 's2', x: 0, y: 200 },
            { id: 't1', x: 700, y: 0 },
            { id: 't2', x: 700, y: 200 },
          ].map((node) => ({ ...node, width: 216, height: 104 })),
          edges: [0, 1].map((i) => ({
            id: `e${i + 1}`,
            sections: [
              {
                id: `section${i}`,
                startPoint: { x: 216, y: 52 + i * 200 },
                bendPoints: [
                  { x: 300, y: 52 + i * 200 },
                  { x: 300, y: 152 },
                  { x: 600, y: 152 },
                  { x: 600, y: 52 + i * 200 },
                ],
                endPoint: { x: 700, y: 52 + i * 200 },
              },
            ],
          })),
        }
      },
    })
    expect(output).toMatchObject({ type: 'layout-error', code: 'invalid_result' })
    expect(calls).toBe(2)
  })
  it('[RG1] runs the bundled engine deterministically with complete fan-out/fan-in routes', async () => {
    const elk = new ELK({ algorithms: ['layered'] })
    const input = {
      ...request,
      nodes: ['start', 'left', 'right', 'finish'].map((id, order) => ({
        id,
        order,
        width: 216 + order * 2,
        height: 104 + order * 30,
      })),
      edges: [
        ['start', 'left'],
        ['start', 'right'],
        ['left', 'finish'],
        ['right', 'finish'],
      ].map(([source, target], order) => ({ id: `${source}-${target}`, source: source!, target: target!, order })),
    }
    const before = structuredClone(input)
    const first = await arrangeWithElk(input, elk)
    const second = await arrangeWithElk(
      { ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() },
      elk,
    )
    expect(first.type).toBe('layout-result')
    expect(second.type).toBe('layout-result')
    if (first.type !== 'layout-result' || second.type !== 'layout-result') return
    expect(first.positions).toEqual(second.positions)
    expect(first.routes).toEqual(second.routes)
    expect(Object.keys(first.routes).sort()).toEqual(['left-finish', 'right-finish', 'start-left', 'start-right'])
    expect(first.routes['start-left']!.points[0]).not.toEqual(first.routes['start-right']!.points[0])
    expect(input).toEqual(before)
  })
})
