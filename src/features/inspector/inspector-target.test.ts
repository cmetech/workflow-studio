import { describe, expect, it } from 'vitest'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { resolveInspectorTarget, type InspectorTarget } from './inspector-target'

const projection: WorkflowProjection = {
  name: 'Scoped',
  profile: 'archon-2026-07',
  definition: {},
  graphs: [
    {
      scope: { key: 'root', kind: 'root', workflow: { name: 'Scoped', profile: 'archon-2026-07' } },
      editorNodePrefix: '',
      sourcePath: ['nodes'],
      sourceRange: { start: 0, end: 1 },
      nodes: [
        {
          id: 'repeat',
          kind: 'loop_group',
          value: {},
          dependsOn: [],
          options: {},
          source: { path: '/nodes/0', start: 0, end: 1 },
        },
      ],
      edges: [],
      definitionOrder: ['repeat'],
      outerInputs: [],
      issues: [],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    },
    {
      scope: {
        key: 'loop-group:repeat',
        kind: 'loop-group',
        groupId: 'repeat',
        workflow: { name: 'Scoped', profile: 'archon-2026-07' },
      },
      editorNodePrefix: 'repeat/',
      sourcePath: ['nodes', 0, 'loop_group', 'nodes'],
      sourceRange: { start: 0, end: 1 },
      nodes: [
        {
          id: 'child',
          kind: 'command',
          value: 'work',
          dependsOn: [],
          options: {},
          source: { path: '/nodes/0/loop_group/nodes/0', start: 0, end: 1 },
        },
      ],
      edges: [],
      definitionOrder: ['child'],
      primarySinkId: 'child',
      outerInputs: [],
      issues: [],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    },
  ],
}

describe('Inspector target', () => {
  it('resolves owning group settings from root while preserving the body selection outside the target', () => {
    const target: InspectorTarget = { kind: 'group', bodyScopeKey: 'loop-group:repeat', groupId: 'repeat' }
    const selection = ['child']
    expect(resolveInspectorTarget(projection, target)).toMatchObject({
      node: { id: 'repeat' },
      graph: { scope: { key: 'root' } },
    })
    expect(selection).toEqual(['child'])
  })

  it('resolves repeated local node ids only within their qualified scope', () => {
    expect(
      resolveInspectorTarget(projection, { kind: 'node', scopeKey: 'loop-group:repeat', nodeId: 'child' }),
    ).toMatchObject({
      node: { id: 'child' },
      graph: { scope: { key: 'loop-group:repeat' } },
    })
  })
})
