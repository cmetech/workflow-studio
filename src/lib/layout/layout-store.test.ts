import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import type { LayoutContentHashes, LayoutRecordV1 } from './types'
import { createLayoutStore, LayoutPersistenceController } from './layout-store'

const hashes: LayoutContentHashes = {
  definition: 'a'.repeat(64),
  companion: 'b'.repeat(64),
}

function record(overrides: Partial<LayoutRecordV1> = {}): LayoutRecordV1 {
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

    expect(Object.hasOwn(loaded!.nodePositions, '__proto__')).toBe(true)
  })

  it('validates all loaded fields, drops invalid positions, and never interprets a future version', async () => {
    const valid = record({
      nodePositions: {
        build: { x: 0, y: 0 },
        nan: { x: null as unknown as number, y: 4 },
        huge: { x: Number.MAX_VALUE, y: 0 },
      },
    })
    const future = { schemaVersion: 2, opaque: { keep: true } }
    const native = nativeWith(JSON.stringify([future, { schemaVersion: 1, layout: valid, savedHashes: hashes }]))
    const store = createLayoutStore(native)

    await expect(store.loadLayout({ workspaceId: 'workspace-1', workflowPath: 'flows/release.yaml' })).resolves.toEqual(
      expect.objectContaining({ nodePositions: { build: { x: 0, y: 0 } } }),
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
      JSON.stringify([{ schemaVersion: 1, layout: record(override as Partial<LayoutRecordV1>), savedHashes: hashes }]),
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
    expect(reclaimed?.nodePositions.build).toEqual({ x: 0, y: 0 })
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
      .fn<(layout: LayoutRecordV1) => Promise<void>>()
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
    const save = vi.fn<(layout: LayoutRecordV1, sequence: number) => Promise<void>>(async () => undefined)
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
      .fn<(layout: LayoutRecordV1) => Promise<void>>()
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
    const save = vi.fn<(layout: LayoutRecordV1, sequence: number) => Promise<void>>(async () => undefined)
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
      .fn<(layout: LayoutRecordV1) => Promise<void>>()
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
      .fn<(layout: LayoutRecordV1) => Promise<void>>()
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
      .fn<(layout: LayoutRecordV1) => Promise<void>>()
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
