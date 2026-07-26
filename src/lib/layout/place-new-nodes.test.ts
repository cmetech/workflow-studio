import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import type { LayoutProjection, LayoutRecordV1 } from './types'
import { migrateManualYamlNodeRename, migrateVisualNodeRename, reconcileLayout } from './place-new-nodes'

const baseLayout: LayoutRecordV1 = {
  schemaVersion: 1,
  workspaceId: 'workspace-1',
  workflowPath: 'flows/release.yaml',
  nodePositions: {
    build: { x: 320, y: 0 },
    removed: { x: 640, y: 0 },
  },
  viewport: { x: 12, y: -4, zoom: 1.25 },
  panels: { left: 260, right: 320, problems: 180 },
  editorMode: 'split',
  updatedAt: '2026-07-25T12:00:00.000Z',
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

describe('layout reconciliation', () => {
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
})
