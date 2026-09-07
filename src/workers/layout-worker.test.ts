import { describe, expect, it } from 'vitest'
import { processLayoutWorkerRequest } from './layout-worker'
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
})
