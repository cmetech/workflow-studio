import { describe, expect, it, vi } from 'vitest'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { ProjectedGraph } from '$src/lib/projection/types'
import { layoutGraph } from './layout-graph'
import { projectCanvas } from './project-canvas'

const projection: ProjectedGraph = deepFreeze({
  scope: { key: 'root', kind: 'root', workflow: { name: 'Release', profile: 'hermes-legacy' } },
  editorNodePrefix: '',
  sourcePath: ['nodes'],
  sourceRange: { start: 0, end: 50 },
  nodes: [
    {
      id: 'collect',
      kind: 'command',
      value: 'Gather release context\n' + 'x'.repeat(200),
      dependsOn: [],
      options: {},
      source: { path: '/nodes/0', start: 0, end: 20 },
    },
    {
      id: 'review',
      kind: 'prompt',
      value: 'Review the release findings',
      dependsOn: ['collect'],
      options: { retries: 2 },
      source: { path: '/nodes/1', start: 21, end: 50 },
    },
  ],
  edges: [{ id: 'dependency:collect->review', source: 'collect', target: 'review' }],
  definitionOrder: ['collect', 'review'],
  outerInputs: [],
  issues: [],
  capacity: { status: 'visual', nodeCount: 2, edgeCount: 1 },
})

const savedLayout: LayoutRecordV1 = {
  schemaVersion: 1,
  workspaceId: 'workspace',
  workflowPath: 'release.yaml',
  nodePositions: { collect: { x: 40, y: 80 } },
  viewport: { x: 10, y: 20, zoom: 0.9 },
  panels: { left: 280, right: 320, problems: 180 },
  editorMode: 'visual',
  updatedAt: '2026-07-25T00:00:00.000Z',
}

describe('projectCanvas', () => {
  it('derives stable canvas identities, saved positions, and bounded node summaries without mutating YAML projection', () => {
    const before = structuredClone(projection)
    const canvas = projectCanvas(projection, savedLayout, {
      issues: [
        {
          code: 'required',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'A required field is missing.',
          document: 'definition',
          nodeId: 'review',
        },
      ],
    })

    expect(canvas.nodes.map(({ id }) => id)).toEqual(['collect', 'review'])
    expect(canvas.edges).toEqual([
      expect.objectContaining({ id: 'dependency:collect->review', source: 'collect', target: 'review' }),
    ])
    expect(canvas.positions.collect).toEqual({ x: 40, y: 80 })
    expect(canvas.positions.review!.x).toBeGreaterThan(40)
    expect(canvas.nodes[0]!.data.summary).not.toContain('\n')
    expect(canvas.nodes[0]!.data.summary.length).toBeLessThanOrEqual(72)
    expect(canvas.nodes[0]!.data).not.toHaveProperty('value')
    expect(canvas.nodes[1]!.data.requiredIssueCount).toBe(1)
    expect(canvas.capacity).toEqual({ status: 'visual', nodeCount: 2, edgeCount: 1 })
    expect(projection).toEqual(before)
  })

  it('marks the complete render projection stale and read-only', () => {
    const canvas = projectCanvas(projection, savedLayout, { stale: true, readOnly: true })

    expect(canvas).toMatchObject({ stale: true, readOnly: true })
    expect(canvas.nodes.every(({ draggable, data }) => draggable === false && data.stale && data.readOnly)).toBe(true)
    expect(canvas.edges.every(({ data }) => data?.stale && data.readOnly)).toBe(true)
  })

  it('never invokes Dagre when reopening saved layout and invokes it exactly once for Arrange', () => {
    const dagre = vi.fn(layoutGraph)

    const reopened = projectCanvas(projection, savedLayout, { layoutGraph: dagre })
    expect(dagre).not.toHaveBeenCalled()
    expect(reopened.positions.collect).toEqual({ x: 40, y: 80 })

    const arranged = projectCanvas(projection, savedLayout, { arrange: true, layoutGraph: dagre })
    expect(dagre).toHaveBeenCalledTimes(1)
    expect(arranged.positions).not.toEqual(savedLayout.nodePositions)
  })

  it('returns every node and edge unchanged when a graph is YAML-only', () => {
    const nodes = Array.from({ length: 251 }, (_, index) => ({
      id: `node-${index}`,
      kind: 'command',
      value: `work ${index}`,
      dependsOn: [],
      options: {},
      source: { path: `/nodes/${index}`, start: index * 10, end: index * 10 + 9 },
    }))
    const edges = Array.from({ length: 501 }, (_, index) => ({
      id: `dependency:node-0->edge-${index}`,
      source: 'node-0',
      target: `edge-${index}`,
    }))
    const yamlOnly: ProjectedGraph = {
      ...projection,
      nodes,
      edges,
      definitionOrder: nodes.map(({ id }) => id),
      capacity: { status: 'yaml-only', nodeCount: nodes.length, edgeCount: edges.length },
    }

    const canvas = projectCanvas(yamlOnly, savedLayout)

    expect(canvas.capacity).toEqual({ status: 'yaml-only', nodeCount: 251, edgeCount: 501 })
    expect(canvas.nodes.map(({ id }) => id)).toEqual(nodes.map(({ id }) => id))
    expect(canvas.edges.map(({ id }) => id)).toEqual(edges.map(({ id }) => id))
  })
})

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
