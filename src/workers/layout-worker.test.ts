import { describe, expect, it, vi } from 'vitest'
import { arrangeWithElk, type ElkLike } from '$src/features/canvas/layout-graph'
import { createLayoutWorkerProcessor, processLayoutWorkerRequest } from './layout-worker'
import type { LayoutWorkerRequest } from './layout-worker-protocol'

const request: LayoutWorkerRequest = {
  type: 'layout',
  identity: {
    requestId: 'request',
    workflowIdentity: 'workflow',
    pairGeneration: 2,
    scopeKey: 'root',
    graphFingerprint: `sha256:${'a'.repeat(64)}`,
    layoutRevision: 3,
  },
  nodes: [
    { id: 'a', order: 0, width: 216, height: 104 },
    { id: 'b', order: 1, width: 216, height: 104 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', order: 0 }],
}
describe('layout worker', () => {
  it('caches only the last accepted full layout identity and exact graph snapshot', async () => {
    const layout = async () => ({
      id: 'root',
      children: [
        { id: 'a', x: 32, y: 32, width: 216, height: 104 },
        { id: 'b', x: 384, y: 32, width: 216, height: 104 },
      ],
      edges: [
        {
          id: 'ab',
          sections: [{ id: 's', startPoint: { x: 248, y: 84 }, endPoint: { x: 384, y: 84 } }],
        },
      ],
    })
    const elk = { layout: vi.fn(layout) }
    const process = createLayoutWorkerProcessor(elk)
    const repeated = {
      ...request,
      identity: { ...request.identity, requestId: 'repeat', layoutRevision: 4 },
    }

    const first = await process(request)
    const second = await process(repeated)

    expect(first).toMatchObject({ type: 'layout-result', identity: request.identity })
    expect(second).toMatchObject({ type: 'layout-result', identity: repeated.identity })
    expect(elk.layout).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'workflow identity',
      (input: LayoutWorkerRequest) => ({ ...input, identity: { ...input.identity, workflowIdentity: 'other' } }),
    ],
    [
      'pair generation',
      (input: LayoutWorkerRequest) => ({ ...input, identity: { ...input.identity, pairGeneration: 3 } }),
    ],
    [
      'scope',
      (input: LayoutWorkerRequest) => ({
        ...input,
        identity: { ...input.identity, scopeKey: 'loop-group:a' as const },
      }),
    ],
    [
      'node size',
      (input: LayoutWorkerRequest) => ({
        ...input,
        nodes: input.nodes.map((node, index) => (index ? node : { ...node, width: 217 })),
      }),
    ],
    ['edge', (input: LayoutWorkerRequest) => ({ ...input, edges: [{ ...input.edges[0]!, id: 'renamed-edge' }] })],
  ])('misses the bounded worker cache after a %s change', async (_label, change) => {
    const layout = vi.fn(async (graph: Parameters<ElkLike['layout']>[0]) => ({
      ...graph,
      children: [
        { id: 'a', x: 32, y: 32, width: 216, height: 104 },
        { id: 'b', x: 384, y: 32, width: 216, height: 104 },
      ],
      edges: [
        {
          id: (graph.edges![0] as { id: string }).id,
          sections: [{ id: 's', startPoint: { x: 248, y: 84 }, endPoint: { x: 384, y: 84 } }],
        },
      ],
    }))
    const elk: ElkLike = { layout }
    const process = createLayoutWorkerProcessor(elk)
    await process(request)
    await process(change(request))
    expect(layout).toHaveBeenCalledTimes(2)
  })

  it('[RG8] returns bounded normalized geometry and exact identity without raw ELK data', async () => {
    const output = await processLayoutWorkerRequest(request, {
      layout: async () => ({
        id: 'root',
        privateState: 'do not expose',
        children: [
          { id: 'a', x: 32, y: 32, width: 216, height: 104 },
          { id: 'b', x: 384, y: 32, width: 216, height: 104 },
        ],
        edges: [
          {
            id: 'ab',
            sections: [
              { id: 's', startPoint: { x: 248, y: 84 }, bendPoints: [{ x: 300, y: 84 }], endPoint: { x: 384, y: 84 } },
            ],
          },
        ],
      }),
    })
    expect(output).toEqual({
      type: 'layout-result',
      identity: request.identity,
      spacingProfile: 'default',
      positions: { a: { x: 32, y: 32 }, b: { x: 384, y: 32 } },
      routes: {
        ab: {
          edgeId: 'ab',
          points: [
            { x: 248, y: 84 },
            { x: 384, y: 84 },
          ],
        },
      },
      bounds: { x: 32, y: 32, width: 568, height: 104 },
      durationMs: expect.any(Number),
    })
    if (output.type === 'layout-result') expect(output.durationMs).toBeGreaterThanOrEqual(0)
  })
  it('[RG8] maps ELK errors without exposing exception content', async () => {
    expect(
      await processLayoutWorkerRequest(request, {
        layout: async () => {
          throw new Error('private payload')
        },
      }),
    ).toEqual({
      type: 'layout-error',
      identity: request.identity,
      code: 'layout_failed',
      message: 'Graph arrangement failed.',
    })
  })
  it('[RG8] rejects malformed geometry inside the worker', async () => {
    expect(
      await processLayoutWorkerRequest(request, { layout: async () => ({ id: 'root', children: [], edges: [] }) }),
    ).toMatchObject({ type: 'layout-error', code: 'invalid_result', identity: request.identity })
  })
  it.each([
    ['null', null],
    ['missing identity', { type: 'layout', nodes: request.nodes, edges: request.edges }],
    ['null identity', { ...request, identity: null }],
    ['incomplete identity', { ...request, identity: { requestId: 'private' } }],
    ['invalid request id', { ...request, identity: { ...request.identity, requestId: '' } }],
    [
      'oversized workflow identity',
      { ...request, identity: { ...request.identity, workflowIdentity: 'x'.repeat(4097) } },
    ],
    ['invalid generation', { ...request, identity: { ...request.identity, pairGeneration: Infinity } }],
    ['invalid scope', { ...request, identity: { ...request.identity, scopeKey: 'unknown' } }],
    ['invalid fingerprint', { ...request, identity: { ...request.identity, graphFingerprint: 'private' } }],
    ['invalid revision', { ...request, identity: { ...request.identity, layoutRevision: -1 } }],
  ])('[RG8] returns a bounded invalid_request for %s without echoing unsafe identity', async (_, input) => {
    let calls = 0
    const elk = {
      layout: async () => {
        calls++
        return { id: 'root', children: [], edges: [] }
      },
    }
    const expected = {
      type: 'layout-error',
      identity: null,
      code: 'invalid_request',
      message: 'Graph arrangement request is invalid.',
    }
    await expect(arrangeWithElk(input, elk)).resolves.toEqual(expected)
    await expect(processLayoutWorkerRequest(input, elk)).resolves.toEqual(expected)
    expect(calls).toBe(0)
  })
  it('[RG8] strips undeclared identity fields from failure responses', async () => {
    const input = {
      ...request,
      identity: { ...request.identity, privateState: { yaml: 'private' }, callback: () => undefined },
      nodes: [],
    }
    expect(await processLayoutWorkerRequest(input, { layout: async () => null })).toEqual({
      type: 'layout-error',
      identity: request.identity,
      code: 'invalid_request',
      message: 'Graph arrangement request is invalid.',
    })
  })
})
