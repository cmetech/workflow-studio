import { describe, expect, it } from 'vitest'
import type { WorkflowProjection } from '$src/lib/projection/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import { problemFocusRoute, runProblemFocusCoordinator } from './problem-focus-coordinator'
import type { DocumentRevision } from '$src/lib/documents/types'
import { vi } from 'vitest'

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
          id: 'first',
          kind: 'loop_group',
          value: {},
          dependsOn: [],
          options: {},
          source: { path: '/nodes/0', start: 0, end: 1 },
        },
        {
          id: 'second',
          kind: 'loop_group',
          value: {},
          dependsOn: [],
          options: {},
          source: { path: '/nodes/1', start: 0, end: 1 },
        },
      ],
      edges: [],
      definitionOrder: ['first', 'second'],
      outerInputs: [],
      issues: [],
      capacity: { status: 'visual', nodeCount: 2, edgeCount: 0 },
    },
    ...['first', 'second'].map((groupId, index) => ({
      scope: {
        key: `loop-group:${groupId}` as const,
        kind: 'loop-group' as const,
        groupId,
        workflow: { name: 'Scoped', profile: 'archon-2026-07' as const },
      },
      editorNodePrefix: `${groupId}/`,
      sourcePath: ['nodes', index, 'loop_group', 'nodes'],
      sourceRange: { start: 0, end: 1 },
      nodes: [
        {
          id: 'child',
          kind: 'prompt',
          value: '',
          dependsOn: [],
          options: {},
          source: { path: `/nodes/${index}/loop_group/nodes/0`, start: 0, end: 1 },
        },
      ],
      edges: [],
      definitionOrder: ['child'],
      outerInputs: [],
      issues: [],
      capacity: { status: 'visual' as const, nodeCount: 1, edgeCount: 0 },
    })),
  ],
}
const issue = (overrides: Partial<ValidationIssue>): ValidationIssue => ({
  code: 'problem',
  layer: 'semantic',
  severity: 'error',
  blocking: true,
  message: 'Problem',
  document: 'definition',
  ...overrides,
})

describe('problem focus coordinator', () => {
  it('routes repeated child IDs to their exact graph and field', () => {
    expect(
      problemFocusRoute(
        projection,
        issue({
          scopeKey: 'loop-group:second',
          groupId: 'second',
          nodeId: 'child',
          field: 'prompt',
          path: '/nodes/1/loop_group/nodes/0/prompt',
        }),
      ),
    ).toEqual({
      kind: 'node-field',
      scopeKey: 'loop-group:second',
      nodeId: 'child',
      path: '/nodes/1/loop_group/nodes/0/prompt',
    })
  })
  it('routes group controls to the owner and syntax/non-form findings to YAML', () => {
    expect(
      problemFocusRoute(
        projection,
        issue({
          scopeKey: 'loop-group:first',
          groupId: 'first',
          nodeId: 'first',
          field: 'until',
          path: '/nodes/0/loop_group/until',
        }),
      ),
    ).toEqual({
      kind: 'group-field',
      scopeKey: 'loop-group:first',
      groupId: 'first',
      path: '/nodes/0/loop_group/until',
    })
    expect(problemFocusRoute(projection, issue({ layer: 'syntax', line: 4, column: 2 }))).toEqual({ kind: 'yaml' })
  })

  it('rechecks the captured revision after awaited scope entry before focusing', async () => {
    const revision: DocumentRevision = {
      workflowId: 'workflow',
      pairGeneration: 1,
      definitionPath: 'flow.yaml',
      companionPath: null,
      definitionRevision: 2,
      companionRevision: null,
      contractDigest: `sha256:${'a'.repeat(64)}`,
    }
    let activeRevision = revision
    let release!: () => void
    const entered = new Promise<void>((resolve) => (release = resolve))
    const focusNode = vi.fn(async () => true)
    const acknowledge = vi.fn()
    const request = {
      issue: issue({ scopeKey: 'loop-group:second', groupId: 'second', nodeId: 'child', field: 'prompt' }),
      targetRevision: revision,
      requested: true,
      requestRevision: 4,
    }
    const work = runProblemFocusCoordinator(4, {
      getRequest: () => request,
      getRevision: () => activeRevision,
      getProjection: () => projection,
      enterScope: async () => {
        await entered
        return true
      },
      focusNode,
      focusGroup: vi.fn(async () => true),
      focusYaml: vi.fn(async () => true),
      acknowledge,
    })
    activeRevision = { ...revision, definitionRevision: 3 }
    release()
    await work
    expect(focusNode).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(4)
  })
})
