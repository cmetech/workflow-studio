import { describe, expect, it, vi } from 'vitest'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { layoutGraph } from './layout-graph'
import { projectCanvas } from './project-canvas'

const projection: WorkflowProjection = deepFreeze({
  name: 'Release',
  description: 'Release workflow',
  profile: 'hermes-legacy',
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
  definition: { name: 'Release' },
  companion: null,
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
})

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
