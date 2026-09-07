import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { emptyScopeLayout, type LayoutContentHashes, type LayoutRecordV1, type LayoutRecordV2 } from './types'
import { createLayoutStore, LayoutPersistenceController } from './layout-store'
import { ROUTING_ENGINE, type ScopeRoutingV1 } from './routing'

const hashes: LayoutContentHashes = {
  definition: 'a'.repeat(64),
  companion: 'b'.repeat(64),
}

const routeId = 'dependency:build->release'
const routing: ScopeRoutingV1 = {
  schemaVersion: 1,
  engine: ROUTING_ENGINE,
  fingerprint: `sha256:${'c'.repeat(64)}`,
  routes: {
    [routeId]: {
      edgeId: routeId,
      points: [
        { x: 216, y: 52 },
        { x: 320, y: 52 },
      ],
    },
  },
}

function legacyRecord(overrides: Partial<LayoutRecordV1> = {}): LayoutRecordV1 {
  return {
    schemaVersion: 1,
    workspaceId: 'workspace-1',
    workflowPath: 'flows/release.yaml',
    nodePositions: { build: { x: 0, y: 0 } },
    viewport: { x: 0, y: 0, zoom: 1 },
    panels: { left: 260, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-07-25T12:00:00.000Z',
    ...overrides,
  }
}

function record(overrides: Partial<LayoutRecordV1> = {}): LayoutRecordV2 {
  const { nodePositions, viewport, ...legacy } = legacyRecord(overrides)
  return {
    ...legacy,
    schemaVersion: 2,
    activeScopeKey: 'root',
    scopeLayouts: { root: { ...emptyScopeLayout(), nodePositions, viewport } },
    collapsedPanels: { left: false, right: false },
  }
}

function nativeWith(content: string | null = null) {
  let saved = content
  return {
    layoutLoad: vi.fn(async () => saved),
    layoutSave: vi.fn(async (next: string) => {
      saved = next
    }),
    read: () => saved,
  }
}

describe('layout app-data store', () => {
  it('[RG5] round-trips routed scopes byte-for-byte through save, load, and defensive cloning', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    const layout = record()
    layout.scopeLayouts.root.routing = routing

    await store.saveLayout(layout, hashes)
    const first = await store.loadLayout(layout)

    expect(JSON.stringify(first?.scopeLayouts.root.routing)).toBe(JSON.stringify(routing))
    expect(first?.scopeLayouts.root.routing).not.toBe(routing)
    ;(first!.scopeLayouts.root.routing!.routes[routeId]!.points as { x: number; y: number }[])[0]!.x = 999
    const second = await store.loadLayout(layout)
    expect(JSON.stringify(second?.scopeLayouts.root.routing)).toBe(JSON.stringify(routing))
  })

  it.each([
    ['schema', { ...routing, schemaVersion: 2 }],
    ['engine', { ...routing, engine: 'other-engine' }],
    ['digest', { ...routing, fingerprint: 'sha256:short' }],
    [
      'record key',
      {
        ...routing,
        routes: {
          '': {
            edgeId: '',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        },
      },
    ],
    ['edge ID', { ...routing, routes: { [routeId]: { ...routing.routes[routeId]!, edgeId: 'other' } } }],
    [
      'coordinate',
      {
        ...routing,
        routes: {
          [routeId]: {
            edgeId: routeId,
            points: [
              { x: 0, y: 0 },
              { x: 1_000_001, y: 0 },
            ],
          },
        },
      },
    ],
    [
      'point count',
      {
        ...routing,
        routes: { [routeId]: { edgeId: routeId, points: Array.from({ length: 65 }, (_, x) => ({ x, y: 0 })) } },
      },
    ],
    [
      'route count',
      {
        ...routing,
        routes: Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => {
            const id = `edge-${index}`
            return [
              id,
              {
                edgeId: id,
                points: [
                  { x: 0, y: index },
                  { x: 1, y: index },
                ],
              },
            ]
          }),
        ),
      },
    ],
  ])('drops only malformed routing from an otherwise valid v2 scope: %s', async (_name, malformed) => {
    const layout = record()
    layout.scopeLayouts.root = { ...layout.scopeLayouts.root, routing: malformed as ScopeRoutingV1 }
    const native = nativeWith(JSON.stringify([{ schemaVersion: 2, layout, savedHashes: hashes }]))

    const loaded = await createLayoutStore(native).loadLayout(layout)

    expect(loaded).not.toBeNull()
    expect(loaded?.scopeLayouts.root.routing).toBeUndefined()
    expect(loaded?.scopeLayouts.root.nodePositions).toEqual(layout.scopeLayouts.root.nodePositions)
    expect(loaded?.scopeLayouts.root.viewport).toEqual(layout.scopeLayouts.root.viewport)
  })

  it('round-trips valid collapsed panels without aliasing saved or loaded state', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    const collapsedPanels = { left: true, right: true }
    const layout = { ...record(), collapsedPanels }

    await store.saveLayout(layout, hashes)
    collapsedPanels.left = false

    const loaded = await store.loadLayout(layout)
    expect(loaded?.collapsedPanels).toEqual({ left: true, right: true })
    ;(loaded!.collapsedPanels as { left: boolean; right: boolean }).right = false
    await expect(store.loadLayout(layout)).resolves.toMatchObject({
      collapsedPanels: { left: true, right: true },
    })
  })

  it('defaults absent and malformed collapsed panels without rejecting compatible records', async () => {
    const oldLayout = { ...record(), collapsedPanels: undefined }
    const malformedLayout = {
      ...record({ workflowPath: 'flows/malformed.yaml' }),
      collapsedPanels: { left: true, right: 'false' },
    }
    const native = nativeWith(
      JSON.stringify([
        { schemaVersion: 2, layout: oldLayout, savedHashes: hashes },
        { schemaVersion: 2, layout: malformedLayout, savedHashes: hashes },
      ]),
    )
    const store = createLayoutStore(native)

    await expect(store.loadLayout(oldLayout)).resolves.toMatchObject({
      collapsedPanels: { left: false, right: false },
    })
    await expect(store.loadLayout(malformedLayout)).resolves.toMatchObject({
      collapsedPanels: { left: false, right: false },
    })
  })

  it('migrates the complete legacy envelope into root without writing until a save', async () => {
    const legacy = legacyRecord()
    const native = nativeWith(JSON.stringify([{ schemaVersion: 1, layout: legacy, savedHashes: hashes }]))
    const store = createLayoutStore(native)
    const loaded = await store.loadLayout({ workspaceId: legacy.workspaceId, workflowPath: legacy.workflowPath })
    expect(loaded).toEqual({
      schemaVersion: 2,
      workspaceId: legacy.workspaceId,
      workflowPath: legacy.workflowPath,
      panels: legacy.panels,
      collapsedPanels: { left: false, right: false },
      editorMode: legacy.editorMode,
      updatedAt: legacy.updatedAt,
      activeScopeKey: 'root',
      scopeLayouts: {
        root: {
          nodePositions: legacy.nodePositions,
          viewport: legacy.viewport,
          selectedNodeIds: [],
          inspector: { tab: 'General', scrollTop: 0 },
          canvasScroll: { left: 0, top: 0 },
          problemsScroll: 0,
          referencesScroll: 0,
        },
      },
    })
    expect(native.layoutSave).not.toHaveBeenCalled()
    await store.renameWorkflowPath(legacy.workspaceId, legacy.workflowPath, 'renamed.yaml')
    expect(JSON.parse(native.read()!)[0]).toMatchObject({ schemaVersion: 2, savedHashes: hashes })
  })

  it('defaults old and malformed auxiliary fields without marking a scope visited', async () => {
    const old = record()
    old.scopeLayouts['loop-group:first'] = { ...emptyScopeLayout() }
    const raw = JSON.parse(JSON.stringify(old))
    delete raw.scopeLayouts.root.referencesScroll
    raw.scopeLayouts['loop-group:first'].auxiliaryTab = 'unknown'
    raw.scopeLayouts['loop-group:first'].referencesScroll = -1
    const native = nativeWith(JSON.stringify([{ schemaVersion: 2, layout: raw, savedHashes: hashes }]))
    const loaded = await createLayoutStore(native).loadLayout(old)
    expect(loaded?.scopeLayouts.root.referencesScroll).toBe(0)
    expect(loaded?.scopeLayouts.root.auxiliaryTab).toBeUndefined()
    expect(loaded?.scopeLayouts['loop-group:first']?.referencesScroll).toBe(0)
    expect(loaded?.scopeLayouts['loop-group:first']?.auxiliaryTab).toBeUndefined()
  })

  it('round-trips all scope interaction fields through save, exact rename and hash reclaim', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    const layout = record()
    layout.activeScopeKey = 'loop-group:second'
    for (const [id, x] of [
      ['first', 100],
      ['second', 200],
    ] as const) {
      layout.scopeLayouts[`loop-group:${id}`] = {
        nodePositions: { child: { x, y: x + 1 } },
        viewport: { x, y: -x, zoom: 1.25 },
        selectedNodeIds: ['child'],
        focusTarget: { kind: 'node', nodeId: 'child' },
        inspector: { tab: 'Advanced', scrollTop: x + 2 },
        canvasScroll: { left: x + 3, top: x + 4 },
        problemsScroll: x + 5,
        auxiliaryTab: id === 'first' ? 'problems' : 'references',
        referencesScroll: x + 6,
      }
    }
    await store.saveLayout(layout, hashes)
    const reloaded = createLayoutStore(native)
    expect(await reloaded.loadLayout(layout)).toEqual(layout)
    await reloaded.renameWorkflowPath(layout.workspaceId, layout.workflowPath, 'renamed.yaml')
    expect(await reloaded.loadLayout({ ...layout, workflowPath: 'renamed.yaml' })).toEqual({
      ...layout,
      workflowPath: 'renamed.yaml',
    })
    expect(
      await reloaded.loadLayout({
        ...layout,
        workflowPath: 'moved.yaml',
        savedHashes: hashes,
        missingWorkflowPaths: ['renamed.yaml'],
      }),
    ).toEqual({ ...layout, workflowPath: 'moved.yaml' })
    expect(JSON.parse(native.read()!)[0].savedHashes).toEqual(hashes)
  })

  it('preserves corrupt and future records when another workflow is saved', async () => {
    const corrupt = { schemaVersion: 2, layout: { ...record(), scopeLayouts: {} }, savedHashes: hashes }
    const future = { schemaVersion: 3, opaque: { preserve: true } }
    const native = nativeWith(JSON.stringify([corrupt, future]))
    const store = createLayoutStore(native)
    expect(await store.loadLayout(record())).toBeNull()
    await store.saveLayout(record({ workflowPath: 'other.yaml' }))
    expect(JSON.parse(native.read()!).slice(0, 2)).toEqual([corrupt, future])
  })

  it('round-trips through the offline browser native bridge', async () => {
    const store = createLayoutStore(createBrowserBridge())
    await store.saveLayout(record(), hashes)

    await expect(store.loadLayout({ workspaceId: 'workspace-1', workflowPath: 'flows/release.yaml' })).resolves.toEqual(
      record(),
    )
  })

  it('round-trips prototype-shaped node IDs without treating them as object structure', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    const layout = record({ nodePositions: JSON.parse('{"__proto__":{"x":0,"y":0}}') })

    await store.saveLayout(layout, hashes)
    const loaded = await store.loadLayout({ workspaceId: 'workspace-1', workflowPath: 'flows/release.yaml' })

    expect(Object.hasOwn(loaded!.scopeLayouts.root.nodePositions, '__proto__')).toBe(true)
  })

  it('validates all loaded fields, drops invalid positions, and never interprets a future version', async () => {
    const valid = record({
      nodePositions: {
        build: { x: 0, y: 0 },
        nan: { x: null as unknown as number, y: 4 },
        huge: { x: Number.MAX_VALUE, y: 0 },
      },
    })
    const future = { schemaVersion: 3, opaque: { keep: true } }
    const native = nativeWith(JSON.stringify([future, { schemaVersion: 2, layout: valid, savedHashes: hashes }]))
    const store = createLayoutStore(native)

    await expect(store.loadLayout({ workspaceId: 'workspace-1', workflowPath: 'flows/release.yaml' })).resolves.toEqual(
      expect.objectContaining({
        scopeLayouts: { root: expect.objectContaining({ nodePositions: { build: { x: 0, y: 0 } } }) },
      }),
    )

    await store.saveLayout(record({ editorMode: 'yaml' }), hashes)
    expect(JSON.parse(native.read()!)[0]).toEqual(future)
  })

  it.each([
    ['viewport infinity', { viewport: { x: Number.POSITIVE_INFINITY, y: 0, zoom: 1 } }],
    ['zoom bound', { viewport: { x: 0, y: 0, zoom: 100 } }],
    ['panel bound', { panels: { left: -1, right: 320, problems: 180 } }],
    ['mode', { editorMode: 'graph' }],
    ['timestamp', { updatedAt: 'not-a-date' }],
  ])('rejects an invalid loaded record: %s', async (_label, override) => {
    const native = nativeWith(
      JSON.stringify([{ schemaVersion: 2, layout: record(override as Partial<LayoutRecordV1>), savedHashes: hashes }]),
    )

    await expect(
      createLayoutStore(native).loadLayout({ workspaceId: 'workspace-1', workflowPath: 'flows/release.yaml' }),
    ).resolves.toBeNull()
  })

  it('migrates an app-driven pair rename to the exact new workflow path', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    await store.saveLayout(record(), hashes)

    await store.renameWorkflowPath('workspace-1', 'flows/release.yaml', 'archive/release.yaml')

    const migrated = await store.loadLayout({ workspaceId: 'workspace-1', workflowPath: 'archive/release.yaml' })
    expect(migrated?.workflowPath).toBe('archive/release.yaml')
    await expect(
      store.loadLayout({ workspaceId: 'workspace-1', workflowPath: 'flows/release.yaml' }),
    ).resolves.toBeNull()
  })

  it('reclaims an externally moved unchanged pair only from one missing hash match', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    await store.saveLayout(record(), hashes)

    const reclaimed = await store.loadLayout({
      workspaceId: 'workspace-1',
      workflowPath: 'moved/release.yaml',
      savedHashes: hashes,
      missingWorkflowPaths: ['flows/release.yaml'],
    })

    expect(reclaimed).toEqual(expect.objectContaining({ workflowPath: 'moved/release.yaml' }))
    expect(reclaimed?.scopeLayouts.root.nodePositions.build).toEqual({ x: 0, y: 0 })
  })

  it('never guesses between ambiguous external hash matches', async () => {
    const native = nativeWith()
    const store = createLayoutStore(native)
    await store.saveLayout(record(), hashes)
    await store.saveLayout(record({ workflowPath: 'flows/copy.yaml' }), hashes)

    await expect(
      store.loadLayout({
        workspaceId: 'workspace-1',
        workflowPath: 'moved/release.yaml',
        savedHashes: hashes,
        missingWorkflowPaths: ['flows/release.yaml', 'flows/copy.yaml'],
      }),
    ).resolves.toBeNull()
  })
})

describe('layout persistence scheduling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never persists pointer movement and waits 300ms after drag completion', async () => {
    const save = vi.fn(async () => undefined)
    const controller = new LayoutPersistenceController(save)
    const moved = record({ nodePositions: { build: { x: 44, y: 55 } } })

    controller.pointerMoved(moved)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(save).not.toHaveBeenCalled()

    controller.dragCompleted(moved)
    await vi.advanceTimersByTimeAsync(299)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledWith(moved, 1)
  })

  it('waits 500ms for viewport/panels and close flushes the latest pending record after queued writes', async () => {
    let finishFirst: (() => void) | undefined
    const save = vi
      .fn<(layout: LayoutRecordV2) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(undefined)
    const controller = new LayoutPersistenceController(save)
    const first = record({ viewport: { x: 10, y: 0, zoom: 1 } })
    const latest = record({ viewport: { x: 20, y: 0, zoom: 1 } })

    controller.viewportOrPanelsChanged(first)
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledWith(first, 1)
    controller.viewportOrPanelsChanged(latest)
    const closing = controller.close()
    expect(save).toHaveBeenCalledTimes(1)
    finishFirst?.()
    await closing

    expect(save).toHaveBeenNthCalledWith(2, latest, 2)
  })

  it('flushes for a close attempt without disabling later layout persistence', async () => {
    const save = vi.fn<(layout: LayoutRecordV2, sequence: number) => Promise<void>>(async () => undefined)
    const controller = new LayoutPersistenceController(save)
    const first = record({ editorMode: 'split' })
    const second = record({ editorMode: 'yaml' })
    controller.viewportOrPanelsChanged(first)
    const flush = Reflect.get(controller, 'flush')
    expect(typeof flush).toBe('function')
    if (typeof flush !== 'function') return

    await flush.call(controller)
    controller.viewportOrPanelsChanged(second)
    await vi.advanceTimersByTimeAsync(500)

    expect(save.mock.calls.map(([layout]) => layout.editorMode)).toEqual(['split', 'yaml'])
  })

  it('clears an earlier queued persistence failure after flushing a later close record', async () => {
    const save = vi
      .fn<(layout: LayoutRecordV2) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue(undefined)
    const controller = new LayoutPersistenceController(save)

    controller.dragCompleted(record())
    await vi.advanceTimersByTimeAsync(300)
    controller.viewportOrPanelsChanged(record({ editorMode: 'split' }))

    await expect(controller.close()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('globally coalesces reversed drag and panel timers to the newest full snapshot', async () => {
    const save = vi.fn<(layout: LayoutRecordV2, sequence: number) => Promise<void>>(async () => undefined)
    const controller = new LayoutPersistenceController(save)

    controller.dragCompleted(record({ editorMode: 'visual' }))
    await vi.advanceTimersByTimeAsync(100)
    controller.viewportOrPanelsChanged(record({ editorMode: 'yaml' }))
    await vi.advanceTimersByTimeAsync(300)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0].editorMode).toBe('yaml')
  })

  it('includes a newer event that arrives while close is flushing an older snapshot', async () => {
    let finishFirst: (() => void) | undefined
    const save = vi
      .fn<(layout: LayoutRecordV2) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(undefined)
    const controller = new LayoutPersistenceController(save)
    controller.dragCompleted(record({ editorMode: 'visual' }))

    const closing = controller.close()
    await vi.advanceTimersByTimeAsync(0)
    controller.viewportOrPanelsChanged(record({ editorMode: 'yaml' }))
    finishFirst?.()
    await closing

    expect(save.mock.calls.map(([layout]) => layout.editorMode)).toEqual(['visual', 'yaml'])
  })

  it('retains the newest failed payload and retries it on close without an unhandled rejection', async () => {
    const save = vi
      .fn<(layout: LayoutRecordV2) => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue(undefined)
    const controller = new LayoutPersistenceController(save)
    const latest = record({ editorMode: 'split' })

    controller.dragCompleted(latest)
    await vi.advanceTimersByTimeAsync(300)
    await controller.close()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.map(([layout]) => layout.editorMode)).toEqual(['split', 'split'])
  })

  it('clears an older failure only after a newer full snapshot succeeds', async () => {
    const save = vi
      .fn<(layout: LayoutRecordV2) => Promise<void>>()
      .mockRejectedValueOnce(new Error('old failed'))
      .mockResolvedValue(undefined)
    const controller = new LayoutPersistenceController(save)

    controller.dragCompleted(record({ editorMode: 'visual' }))
    await vi.advanceTimersByTimeAsync(300)
    controller.viewportOrPanelsChanged(record({ editorMode: 'yaml' }))
    await vi.advanceTimersByTimeAsync(500)

    await expect(controller.close()).resolves.toBeUndefined()
    expect(save.mock.calls.map(([layout]) => layout.editorMode)).toEqual(['visual', 'yaml'])
  })
})
