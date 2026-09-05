import { describe, expect, it, vi } from 'vitest'
import type { ScopeLayoutV1 } from '$src/lib/layout/types'
import type { ProjectedGraph } from '$src/lib/projection/types'
import { layoutGraph } from './layout-graph'
import { loopGroupSummariesForProjection, projectCanvas } from './project-canvas'
import type { WorkflowProjection } from '$src/lib/projection/types'

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

const savedLayout: ScopeLayoutV1 = {
  selectedNodeIds: [],
  inspector: { tab: 'General', scrollTop: 0 },
  canvasScroll: { left: 0, top: 0 },

  nodePositions: { collect: { x: 40, y: 80 } },
  viewport: { x: 10, y: 20, zoom: 0.9 },
}

describe('projectCanvas', () => {
  it('derives compound summaries from the owning node and body projection without canvas-position input', () => {
    const group = { ...projection.nodes[0]!, id: 'repeat', kind: 'loop_group', value: { max_iterations: 4, nodes: [] } }
    const root: ProjectedGraph = {
      ...projection,
      nodes: [group],
      edges: [],
      definitionOrder: ['repeat'],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    }
    const body: ProjectedGraph = {
      ...projection,
      scope: {
        key: 'loop-group:repeat',
        kind: 'loop-group',
        groupId: 'repeat',
        workflow: projection.scope.workflow,
      },
      nodes: [projection.nodes[1]!, projection.nodes[0]!],
      edges: [],
      definitionOrder: ['review', 'collect'],
      primarySinkId: 'review',
      capacity: { status: 'visual', nodeCount: 2, edgeCount: 0 },
    }
    const workflow: WorkflowProjection = {
      name: 'Release',
      profile: 'hermes-legacy',
      graphs: [root, body],
      definition: {},
    }

    expect(
      loopGroupSummariesForProjection(workflow, [
        {
          code: 'schema_required',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Until is required.',
          document: 'definition',
          scopeKey: 'loop-group:repeat',
          groupId: 'repeat',
          nodeId: 'repeat',
        },
      ]),
    ).toEqual({
      repeat: {
        bodyNodeCount: 2,
        maxIterations: 4,
        primarySinkId: 'review',
        errorCount: 1,
        requiredIssueCount: 1,
      },
    })
  })

  it('projects a root loop group as a scoped compound node with definition-order output and scoped issues', () => {
    const groupProjection: ProjectedGraph = {
      ...projection,
      nodes: [
        {
          ...projection.nodes[0]!,
          id: 'repeat',
          kind: 'loop_group',
          value: { nodes: [], max_iterations: 7 },
        },
      ],
      edges: [],
      definitionOrder: ['repeat'],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    }

    const canvas = projectCanvas(groupProjection, savedLayout, {
      groupSummaries: {
        repeat: {
          bodyNodeCount: 2,
          maxIterations: 7,
          primarySinkId: 'publish',
          errorCount: 2,
          requiredIssueCount: 1,
        },
      },
      issues: [
        {
          code: 'unrelated',
          layer: 'semantic',
          severity: 'error',
          blocking: true,
          message: 'A same-named child in another group is invalid.',
          document: 'definition',
          scopeKey: 'loop-group:other',
          groupId: 'other',
          nodeId: 'repeat',
        },
      ],
    })

    expect(canvas.nodes[0]).toMatchObject({
      ariaLabel: 'loop group repeat, 2 body nodes, primary output publish, 2 errors, 1 required issue',
      data: {
        id: 'repeat',
        kind: 'loop_group',
        compound: {
          bodyNodeCount: 2,
          maxIterations: 7,
          primarySinkId: 'publish',
          errorCount: 2,
          requiredIssueCount: 1,
        },
      },
    })
  })

  it('qualifies body node names and diagnostic counts by their loop group', () => {
    const body: ProjectedGraph = {
      ...projection,
      scope: {
        key: 'loop-group:repeat',
        kind: 'loop-group',
        groupId: 'repeat',
        workflow: projection.scope.workflow,
      },
      nodes: [{ ...projection.nodes[0]!, id: 'child' }],
      edges: [],
      definitionOrder: ['child'],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    }
    const canvas = projectCanvas(
      body,
      { ...savedLayout, nodePositions: { child: { x: 0, y: 0 } } },
      {
        issues: [
          {
            code: 'body_error',
            layer: 'semantic',
            severity: 'error',
            blocking: true,
            message: 'Child is invalid.',
            document: 'definition',
            scopeKey: 'loop-group:repeat',
            groupId: 'repeat',
            nodeId: 'child',
          },
          {
            code: 'other_error',
            layer: 'semantic',
            severity: 'error',
            blocking: true,
            message: 'Same child id elsewhere.',
            document: 'definition',
            scopeKey: 'loop-group:other',
            groupId: 'other',
            nodeId: 'child',
          },
        ],
      },
    )

    expect(canvas.nodes[0]).toMatchObject({ ariaLabel: 'command node child in loop group repeat, 1 errors' })
    expect(canvas.nodes[0]!.data.errorCount).toBe(1)
  })

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
