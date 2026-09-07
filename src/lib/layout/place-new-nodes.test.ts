import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import type { GraphScopeKey, WorkflowProjection } from '$src/lib/projection/types'
import type { LayoutProjection, LayoutRecordV2, ScopeLayoutV1 } from './types'
import {
  migrateManualYamlNodeRename,
  migrateVisualNodeRename,
  reconcileLayout,
  reconcileWorkflowLayout,
} from './place-new-nodes'
import { ROUTING_ENGINE, type ScopeRoutingV1 } from './routing'

const routing: ScopeRoutingV1 = {
  schemaVersion: 1,
  engine: ROUTING_ENGINE,
  fingerprint: `sha256:${'d'.repeat(64)}`,
  routes: {
    'dependency:build->removed': {
      edgeId: 'dependency:build->removed',
      points: [
        { x: 536, y: 52 },
        { x: 640, y: 52 },
      ],
    },
  },
}

const baseLayout: ScopeLayoutV1 = {
  selectedNodeIds: [],
  inspector: { tab: 'General', scrollTop: 0 },
  canvasScroll: { left: 0, top: 0 },
  nodePositions: {
    build: { x: 320, y: 0 },
    removed: { x: 640, y: 0 },
  },
  viewport: { x: 12, y: -4, zoom: 1.25 },
  routing,
}

function projection(nodes: readonly Partial<LayoutProjection['nodes'][number]>[]): LayoutProjection {
  return {
    nodes: nodes.map((node) => ({
      id: node.id ?? '',
      kind: node.kind ?? 'shell',
      value: node.value ?? 'echo ok',
      dependsOn: node.dependsOn ?? [],
      options: node.options ?? {},
    })),
  }
}

function workflow(
  scopes: readonly {
    key: GraphScopeKey
    groupId?: string
    nodes: readonly Partial<LayoutProjection['nodes'][number]>[]
  }[],
): WorkflowProjection {
  return {
    name: 'release',
    profile: 'hermes-legacy',
    definition: {},
    graphs: scopes.map(({ key, groupId, nodes }) => ({
      scope: {
        key,
        kind: key === 'root' ? 'root' : 'loop-group',
        workflow: { name: 'release', profile: 'hermes-legacy' },
        ...(groupId ? { groupId } : {}),
      },
      editorNodePrefix: key === 'root' ? 'nodes' : `${key}.nodes`,
      sourcePath: [],
      sourceRange: { start: 0, end: 0 },
      nodes: projection(nodes).nodes.map((node) => ({ ...node, source: { path: '', start: 0, end: 0 } })),
      edges: [],
      definitionOrder: nodes.map((node) => node.id ?? ''),
      outerInputs: [],
      issues: [],
      capacity: { status: 'visual', nodeCount: nodes.length, edgeCount: 0 },
    })),
  }
}

function workflowLayout(scopeLayouts: LayoutRecordV2['scopeLayouts']): LayoutRecordV2 {
  return {
    schemaVersion: 2,
    workspaceId: 'workspace',
    workflowPath: 'release.yaml',
    activeScopeKey: 'root',
    scopeLayouts,
    panels: { left: 260, right: 320, problems: 180 },
    collapsedPanels: { left: false, right: false },
    editorMode: 'visual',
    updatedAt: '2026-09-07T12:00:00.000Z',
  }
}

describe('layout reconciliation', () => {
  it('[RG7] preserves routing and scope identity when node membership and positions are unchanged', () => {
    const reconciled = reconcileLayout(projection([{ id: 'build' }, { id: 'removed' }]), baseLayout)

    expect(reconciled).toBe(baseLayout)
    expect(reconciled.routing).toBe(routing)
  })

  it('preserves routing while reconciling selection and focus state', () => {
    const saved: ScopeLayoutV1 = {
      ...baseLayout,
      selectedNodeIds: ['build', 'missing'],
      focusTarget: { kind: 'node', nodeId: 'missing' },
    }

    const reconciled = reconcileLayout(projection([{ id: 'build' }, { id: 'removed' }]), saved)

    expect(reconciled).not.toBe(saved)
    expect(reconciled.selectedNodeIds).toEqual(['build'])
    expect(reconciled.focusTarget).toBeUndefined()
    expect(reconciled.routing).toBe(routing)
  })

  it.each([
    ['adds and automatically places a node', [{ id: 'build' }, { id: 'removed' }, { id: 'added' }]],
    ['removes a node', [{ id: 'build' }]],
  ])('invalidates routing when reconciliation %s', (_name, nodes) => {
    expect(reconcileLayout(projection(nodes), baseLayout).routing).toBeUndefined()
  })

  it('invalidates routing when a formerly invalid saved position is automatically replaced', () => {
    const saved = {
      ...baseLayout,
      nodePositions: { ...baseLayout.nodePositions, removed: { x: Number.NaN, y: 0 } },
    }

    expect(reconcileLayout(projection([{ id: 'build' }, { id: 'removed' }]), saved).routing).toBeUndefined()
  })

  it('retains existing node positions, prunes removed nodes, and places roots in the first free column', () => {
    const reconciled = reconcileLayout(projection([{ id: 'build' }, { id: 'lint' }, { id: 'test' }]), baseLayout)

    expect(reconciled.nodePositions.build).toEqual({ x: 320, y: 0 })
    expect(reconciled.nodePositions.removed).toBeUndefined()
    expect(reconciled.nodePositions.lint?.x).toBe(0)
    expect(reconciled.nodePositions.test?.x).toBe(0)
    expect(new Set(Object.values(reconciled.nodePositions).map(({ x, y }) => `${x}:${y}`)).size).toBe(3)
  })

  it('places a new dependent to the right of its deepest positioned dependency without moving existing nodes', () => {
    const reconciled = reconcileLayout(
      projection([{ id: 'build' }, { id: 'package', dependsOn: ['build'] }, { id: 'publish', dependsOn: ['package'] }]),
      baseLayout,
    )

    expect(reconciled.nodePositions.build).toEqual({ x: 320, y: 0 })
    expect(reconciled.nodePositions.package!.x).toBeGreaterThan(320)
    expect(reconciled.nodePositions.publish!.x).toBeGreaterThan(reconciled.nodePositions.package!.x)
  })

  it('uses a stable dependency ID tie-break independent of dependency list order', () => {
    const saved = {
      ...baseLayout,
      nodePositions: { alpha: { x: 640, y: 320 }, zeta: { x: 640, y: 0 } },
    }
    const forward = reconcileLayout(
      projection([{ id: 'alpha' }, { id: 'zeta' }, { id: 'joined', dependsOn: ['zeta', 'alpha'] }]),
      saved,
    )
    const reversed = reconcileLayout(
      projection([{ id: 'alpha' }, { id: 'zeta' }, { id: 'joined', dependsOn: ['alpha', 'zeta'] }]),
      saved,
    )

    expect(forward.nodePositions.joined).toEqual(reversed.nodePositions.joined)
    expect(forward.nodePositions.joined).toEqual({ x: 960, y: 320 })
  })

  it('accepts finite negative, non-grid, and prior-boundary positions and always places a child strictly right', () => {
    for (const x of [-123.5, 42.25, 1_000_000, 2_000_000]) {
      const saved = { ...baseLayout, nodePositions: { parent: { x, y: -77.25 } } }
      const reconciled = reconcileLayout(projection([{ id: 'parent' }, { id: 'child', dependsOn: ['parent'] }]), saved)

      expect(reconciled.nodePositions.parent).toEqual({ x, y: -77.25 })
      expect(Number.isFinite(reconciled.nodePositions.child!.x)).toBe(true)
      expect(reconciled.nodePositions.child!.x).toBeGreaterThan(x)
    }
  })

  it('ignores non-finite and out-of-bounds saved positions before deterministic placement', () => {
    const saved = structuredClone(baseLayout)
    saved.nodePositions.build = { x: Number.NaN, y: 1 }
    saved.nodePositions.lint = { x: Number.POSITIVE_INFINITY, y: 0 }

    const reconciled = reconcileLayout(projection([{ id: 'build' }, { id: 'lint' }]), saved)

    expect(reconciled.nodePositions).toEqual({
      build: { x: 0, y: 0 },
      lint: { x: 0, y: 160 },
    })
  })

  it('migrates an exact visual rename but never leaves the old position key', () => {
    const migrated = migrateVisualNodeRename(baseLayout, 'build', 'compile')

    expect(migrated.nodePositions.compile).toEqual({ x: 320, y: 0 })
    expect(migrated.nodePositions.build).toBeUndefined()
    expect(migrated.routing).toBeUndefined()
  })

  it('migrates one unambiguous manual YAML rename by semantic shape after ID substitution', () => {
    const before = projection([
      { id: 'build', kind: 'shell', value: 'make', options: { cwd: 'src' } },
      { id: 'publish', kind: 'shell', value: 'ship', dependsOn: ['build'] },
    ])
    const after = projection([
      { id: 'compile', kind: 'shell', value: 'make', options: { cwd: 'src' } },
      { id: 'publish', kind: 'shell', value: 'ship', dependsOn: ['compile'] },
    ])

    const migrated = migrateManualYamlNodeRename(baseLayout, before, after)

    expect(migrated.nodePositions.compile).toEqual({ x: 320, y: 0 })
    expect(migrated.nodePositions.build).toBeUndefined()
    expect(migrated.routing).toBeUndefined()
  })

  it('invalidates routing for a dependency-topology change with unchanged IDs and positions', () => {
    const before = projection([{ id: 'build' }, { id: 'removed', dependsOn: ['build'] }])
    const after = projection([{ id: 'build', dependsOn: ['removed'] }, { id: 'removed' }])

    const migrated = migrateManualYamlNodeRename(baseLayout, before, after)

    expect(migrated.nodePositions).toBe(baseLayout.nodePositions)
    expect(migrated.routing).toBeUndefined()
  })

  it('preserves routing when dependency order changes without changing topology', () => {
    const saved = {
      ...baseLayout,
      nodePositions: { ...baseLayout.nodePositions, other: { x: 0, y: 160 } },
    }
    const before = projection([{ id: 'build' }, { id: 'removed' }, { id: 'other', dependsOn: ['build', 'removed'] }])
    const after = projection([{ id: 'build' }, { id: 'removed' }, { id: 'other', dependsOn: ['removed', 'build'] }])

    expect(migrateManualYamlNodeRename(saved, before, after).routing).toBe(routing)
  })

  it('invalidates changed root and loop-body routing while retaining an unaffected sibling scope by identity', () => {
    const root = { ...baseLayout }
    const first = {
      ...baseLayout,
      nodePositions: { child: { x: 0, y: 0 }, next: { x: 320, y: 0 } },
    }
    const sibling = { ...baseLayout, nodePositions: { sibling: { x: 0, y: 0 } } }
    const saved = workflowLayout({
      root,
      'loop-group:first': first,
      'loop-group:sibling': sibling,
    })
    const before = workflow([
      { key: 'root', nodes: [{ id: 'build' }, { id: 'removed', dependsOn: ['build'] }] },
      { key: 'loop-group:first', groupId: 'removed', nodes: [{ id: 'child' }, { id: 'next', dependsOn: ['child'] }] },
      { key: 'loop-group:sibling', groupId: 'build', nodes: [{ id: 'sibling' }] },
    ])
    const after = workflow([
      { key: 'root', nodes: [{ id: 'build', dependsOn: ['removed'] }, { id: 'removed' }] },
      { key: 'loop-group:first', groupId: 'removed', nodes: [{ id: 'child', dependsOn: ['next'] }, { id: 'next' }] },
      { key: 'loop-group:sibling', groupId: 'build', nodes: [{ id: 'sibling' }] },
    ])

    const reconciled = reconcileWorkflowLayout(after, saved, before)

    expect(reconciled.scopeLayouts.root.routing).toBeUndefined()
    expect(reconciled.scopeLayouts['loop-group:first']?.routing).toBeUndefined()
    expect(reconciled.scopeLayouts['loop-group:sibling']).toBe(sibling)
    expect(reconciled.scopeLayouts['loop-group:sibling']?.routing).toBe(routing)
  })

  it('invalidates root and migrated body routing when a loop owner is renamed', () => {
    const body = { ...baseLayout, nodePositions: { child: { x: 0, y: 0 } } }
    const saved = workflowLayout({ root: baseLayout, 'loop-group:removed': body })
    const before = workflow([
      { key: 'root', nodes: [{ id: 'build' }, { id: 'removed', kind: 'loop', value: 'repeat' }] },
      { key: 'loop-group:removed', groupId: 'removed', nodes: [{ id: 'child' }] },
    ])
    const after = workflow([
      { key: 'root', nodes: [{ id: 'build' }, { id: 'renamed', kind: 'loop', value: 'repeat' }] },
      { key: 'loop-group:renamed', groupId: 'renamed', nodes: [{ id: 'child' }] },
    ])

    const reconciled = reconcileWorkflowLayout(after, saved, before)

    expect(reconciled.scopeLayouts.root.routing).toBeUndefined()
    expect(reconciled.scopeLayouts['loop-group:removed']).toBeUndefined()
    expect(reconciled.scopeLayouts['loop-group:renamed']?.nodePositions).toEqual(body.nodePositions)
    expect(reconciled.scopeLayouts['loop-group:renamed']?.routing).toBeUndefined()
  })

  it('does not guess an ambiguous manual YAML rename and uses ordinary new-node placement', () => {
    const saved = { ...baseLayout, nodePositions: { first: { x: 0, y: 0 }, second: { x: 320, y: 0 } } }
    const before = projection([
      { id: 'first', kind: 'shell', value: 'same' },
      { id: 'second', kind: 'shell', value: 'same' },
    ])
    const after = projection([
      { id: 'alpha', kind: 'shell', value: 'same' },
      { id: 'beta', kind: 'shell', value: 'same' },
    ])

    const migrated = migrateManualYamlNodeRename(saved, before, after)

    expect(migrated.nodePositions.alpha).toEqual({ x: 0, y: 0 })
    expect(migrated.nodePositions.beta).toEqual({ x: 0, y: 160 })
  })

  it('requires exactly one removed and one added node before inferring a manual rename', () => {
    const saved = {
      ...baseLayout,
      nodePositions: { build: { x: 320, y: 0 }, obsolete: { x: 640, y: 0 } },
    }
    const before = projection([
      { id: 'build', kind: 'shell', value: 'make' },
      { id: 'obsolete', kind: 'wait', value: 10 },
    ])
    const after = projection([
      { id: 'compile', kind: 'shell', value: 'make' },
      { id: 'replacement', kind: 'notify', value: 'done' },
    ])

    const migrated = migrateManualYamlNodeRename(saved, before, after)

    expect(migrated.nodePositions.compile).toEqual({ x: 0, y: 0 })
    expect(migrated.nodePositions.replacement).toEqual({ x: 0, y: 160 })
  })

  it('retains prototype-shaped node IDs as ordinary position keys', () => {
    const saved = { ...baseLayout, nodePositions: JSON.parse('{"__proto__":{"x":80,"y":80}}') }

    const reconciled = reconcileLayout(projection([{ id: '__proto__' }, { id: 'constructor' }]), saved)

    expect(Object.hasOwn(reconciled.nodePositions, '__proto__')).toBe(true)
    expect(Object.hasOwn(reconciled.nodePositions, 'constructor')).toBe(true)
    expect(Object.getPrototypeOf(reconciled.nodePositions)).toBe(Object.prototype)
  })

  it('cannot put layout metadata into serialized workflow YAML', () => {
    const yaml = 'name: release\nnodes:\n  - id: build\n    run: make\n'
    const semanticBefore = parse(yaml)

    reconcileLayout(projection([{ id: 'build', value: 'make' }]), baseLayout)

    expect(yaml).toBe('name: release\nnodes:\n  - id: build\n    run: make\n')
    expect(parse(yaml)).toEqual(semanticBefore)
    expect(yaml).not.toMatch(/nodePositions|viewport|panels|editorMode|layout/i)
  })

  it('retains the complete saved layout identity when all 250 projected positions are unchanged', () => {
    const nodes = Array.from({ length: 250 }, (_, index) => ({ id: `node-${index.toString().padStart(3, '0')}` }))
    const saved: ScopeLayoutV1 = {
      ...baseLayout,
      nodePositions: Object.fromEntries(
        nodes.map(({ id }, index) => [id, { x: (index % 25) * 320, y: Math.floor(index / 25) * 160 }]),
      ),
    }

    const reconciled = reconcileLayout(projection(nodes), saved)

    expect(reconciled).toBe(saved)
    expect(reconciled.nodePositions).toBe(saved.nodePositions)
  })
})
