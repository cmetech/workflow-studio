import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { $canvasPositions, $canvasSelection, clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import GraphCanvas from './GraphCanvas.svelte'
import { createCanvasActivationBarrier } from './canvas-activation-barrier'

const projection: WorkflowProjection = Object.freeze({
  name: 'Release',
  description: 'Release workflow',
  profile: 'hermes-legacy',
  nodes: Object.freeze([
    Object.freeze({
      id: 'collect',
      kind: 'command',
      value: 'Gather release context',
      dependsOn: Object.freeze([]),
      options: Object.freeze({}),
      source: Object.freeze({ path: '/nodes/0', start: 0, end: 20 }),
    }),
    Object.freeze({
      id: 'review',
      kind: 'prompt',
      value: 'Review release findings',
      dependsOn: Object.freeze(['collect']),
      options: Object.freeze({}),
      source: Object.freeze({ path: '/nodes/1', start: 21, end: 50 }),
    }),
  ]),
  edges: Object.freeze([Object.freeze({ id: 'dependency:collect->review', source: 'collect', target: 'review' })]),
  definition: Object.freeze({ name: 'Release' }),
  companion: null,
})

const layout: LayoutRecordV1 = {
  schemaVersion: 1,
  workspaceId: 'workspace',
  workflowPath: 'release.yaml',
  nodePositions: { collect: { x: 0, y: 0 }, review: { x: 320, y: 0 } },
  viewport: { x: 0, y: 0, zoom: 1 },
  panels: { left: 280, right: 320, problems: 180 },
  editorMode: 'visual',
  updatedAt: '2026-07-25T00:00:00.000Z',
}

describe('GraphCanvas', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    clearCanvasState()
  })

  it('isolates 100 drag moves to position state and persists one layout only after drag-stop debounce', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const before = structuredClone(projection)
    const { container } = render(GraphCanvas, { projection, layout, onPersistLayout: persistLayout })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!

    for (let move = 1; move <= 100; move += 1) {
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragmove', {
          bubbles: true,
          detail: { id: 'collect', position: { x: move, y: move * 2 } },
        }),
      )
    }

    expect($canvasPositions.get().collect).toEqual({ x: 100, y: 200 })
    expect(persistLayout).not.toHaveBeenCalled()
    expect(projection).toEqual(before)

    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 100, y: 200 } },
      }),
    )
    await vi.advanceTimersByTimeAsync(299)
    expect(persistLayout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(persistLayout).toHaveBeenCalledTimes(1)
    expect(persistLayout).toHaveBeenCalledWith(
      expect.objectContaining({ nodePositions: { collect: { x: 100, y: 200 }, review: { x: 320, y: 0 } } }),
    )
  })

  it('renders read-only stale affordances, canvas controls, minimap toggle, and explicit Arrange', async () => {
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    render(GraphCanvas, { projection, layout, stale: true, readOnly: true, onPersistLayout: persistLayout })

    expect(screen.getByText(/last valid graph.*read-only/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Arrange graph' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show minimap' })).toBeEnabled()

    await fireEvent.click(screen.getByRole('button', { name: 'Show minimap' }))
    await tick()
    expect(screen.getByRole('button', { name: 'Hide minimap' })).toBeVisible()
  })

  it('suppresses synthetic drag, selection, and Arrange mutations while an activation transition is locked', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const { container } = render(GraphCanvas, {
      projection,
      layout,
      transitionLocked: true,
      onPersistLayout: persistLayout,
    })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    setCanvasSelection(['review'])

    await fireEvent(
      canvas,
      new CustomEvent('workflowdragmove', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 100, y: 200 } },
      }),
    )
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 100, y: 200 } },
      }),
    )
    await fireEvent.click(screen.getAllByLabelText('command node collect')[0]!)
    await fireEvent.click(screen.getByRole('button', { name: 'Arrange graph' }))
    await vi.advanceTimersByTimeAsync(300)

    expect($canvasPositions.get().collect).toEqual({ x: 0, y: 0 })
    expect($canvasSelection.get()).toEqual(['review'])
    expect(screen.getByRole('button', { name: 'Arrange graph' })).toBeDisabled()
    expect(persistLayout).not.toHaveBeenCalled()
  })

  it('flushes a pending drag-stop persistence before the canvas closes', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const { component, container, unmount } = render(GraphCanvas, {
      projection,
      layout,
      onPersistLayout: persistLayout,
    })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 88, y: 99 } },
      }),
    )

    await component.flushPersistence()

    expect(persistLayout).toHaveBeenCalledTimes(1)
    expect(persistLayout).toHaveBeenCalledWith(
      expect.objectContaining({ nodePositions: expect.objectContaining({ collect: { x: 88, y: 99 } }) }),
    )
    unmount()
    await vi.advanceTimersByTimeAsync(300)
    expect(persistLayout).toHaveBeenCalledTimes(1)
  })

  it('restores the saved viewport when switching between workflow identities without arranging', async () => {
    const firstLayout: LayoutRecordV1 = {
      ...layout,
      viewport: { x: 12, y: 34, zoom: 0.8 },
    }
    const secondLayout: LayoutRecordV1 = {
      ...layout,
      workspaceId: 'other-workspace',
      workflowPath: 'deploy.yaml',
      viewport: { x: 210, y: 120, zoom: 1.4 },
    }
    const { container, rerender } = render(GraphCanvas, {
      projection,
      layout: firstLayout,
      workflowIdentity: 'workspace\0workflow:workspace:release.yaml',
    })
    await tick()

    const viewport = container.querySelector<HTMLElement>('.svelte-flow__viewport')!
    expect(viewport.style.transform).toContain('translate(12px, 34px) scale(0.8)')

    await rerender({
      projection,
      layout: secondLayout,
      workflowIdentity: 'other-workspace\0workflow:other-workspace:deploy.yaml',
    })
    await tick()

    expect(viewport.style.transform).toContain('translate(210px, 120px) scale(1.4)')
    expect(screen.getByRole('button', { name: 'Arrange graph' })).toBeEnabled()
  })

  it('persists one pending A drag before an open-draft transition and one B drag under the new identity', async () => {
    vi.useFakeTimers()
    const persisted: LayoutRecordV1[] = []
    const persistLayout = vi.fn(async (next: LayoutRecordV1) => {
      persisted.push(structuredClone(next))
    })
    const { component, container, rerender } = render(GraphCanvas, {
      projection,
      layout,
      workflowIdentity: 'workspace\0workflow:workspace:release.yaml',
      onPersistLayout: persistLayout,
    })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!

    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 88, y: 99 } },
      }),
    )
    const secondLayout: LayoutRecordV1 = {
      ...layout,
      workspaceId: 'workspace-b',
      workflowPath: 'deploy.yaml',
      nodePositions: { collect: { x: 5, y: 6 }, review: { x: 320, y: 0 } },
    }
    const barrier = createCanvasActivationBarrier({
      getCanvas: () => component,
      setLocked: () => undefined,
      settle: async () => undefined,
      onPersistenceError: () => undefined,
    })
    await barrier.run(() =>
      rerender({
        projection,
        layout: secondLayout,
        workflowIdentity: 'workspace-b\0workflow:workspace-b:deploy.yaml',
        onPersistLayout: persistLayout,
      }),
    )
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 44, y: 55 } },
      }),
    )
    await vi.advanceTimersByTimeAsync(300)

    expect(persisted).toHaveLength(2)
    expect(
      persisted.map(({ workspaceId, workflowPath, nodePositions }) => ({
        workspaceId,
        workflowPath,
        collect: nodePositions.collect,
      })),
    ).toEqual([
      { workspaceId: 'workspace', workflowPath: 'release.yaml', collect: { x: 88, y: 99 } },
      { workspaceId: 'workspace-b', workflowPath: 'deploy.yaml', collect: { x: 44, y: 55 } },
    ])
  })

  it('exposes focusable 32px dependency ports for keyboard and touch users', async () => {
    render(GraphCanvas, { projection, layout })
    await tick()

    const incoming = screen.getByRole('button', { name: 'Dependencies entering collect' })
    expect(incoming).toHaveAttribute('tabindex', '0')
    expect(getComputedStyle(incoming).width).toBe('32px')
    expect(getComputedStyle(incoming).height).toBe('32px')
  })

  it('routes semantic connection events without changing layout and announces one typed rejection politely', async () => {
    vi.useFakeTimers()
    const onConnect = vi.fn(async () => ({
      status: 'rejected' as const,
      code: 'cycle',
      message: 'Connecting review to collect would create a cycle.',
    }))
    const persistLayout = vi.fn()
    const { container } = render(GraphCanvas, { projection, layout, onConnect, onPersistLayout: persistLayout })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const before = structuredClone($canvasPositions.get())

    await fireEvent(
      canvas,
      new CustomEvent('workflowconnect', {
        bubbles: true,
        detail: { source: 'review', target: 'collect' },
      }),
    )
    await vi.runAllTimersAsync()

    expect(onConnect).toHaveBeenCalledOnce()
    expect(onConnect).toHaveBeenCalledWith('review', 'collect')
    expect(screen.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveTextContent(/create a cycle/i)
    expect(screen.getAllByRole('status', { name: 'Canvas authoring feedback' })).toHaveLength(1)
    expect($canvasPositions.get()).toEqual(before)
    expect(persistLayout).not.toHaveBeenCalled()
  })

  it('requests descriptor picking, duplication, and precise deletion for the current selection', async () => {
    const onRequestAdd = vi.fn()
    const onDuplicate = vi.fn()
    const onRequestDelete = vi.fn()
    render(GraphCanvas, { projection, layout, onRequestAdd, onDuplicate, onRequestDelete })
    setCanvasSelection(['review'])
    await fireEvent.click(screen.getByRole('button', { name: 'Add node' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))

    expect(onRequestAdd).toHaveBeenCalledWith({ viewportCenter: { x: 400, y: 300 } })
    expect(onDuplicate).toHaveBeenCalledWith(['review'])
    expect(onRequestDelete).toHaveBeenCalledWith(['review'])
  })

  it('never disconnects incident edges while node deletion awaits resolution or confirmation', async () => {
    const onRequestDelete = vi.fn(async () => ({ status: 'resolution_required' as const }))
    const onDisconnect = vi.fn(async () => ({ status: 'committed' as const }))
    const { container } = render(GraphCanvas, { projection, layout, onRequestDelete, onDisconnect })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!

    await fireEvent(
      canvas,
      new CustomEvent('workflowbeforedelete', {
        bubbles: true,
        detail: {
          nodes: [{ id: 'review' }],
          edges: [{ id: 'dependency:collect->review', source: 'collect', target: 'review' }],
        },
      }),
    )

    expect(onRequestDelete).toHaveBeenCalledWith(['review'])
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('disconnects only an edge-only delete gesture', async () => {
    const onRequestDelete = vi.fn()
    const onDisconnect = vi.fn(async () => ({ status: 'committed' as const }))
    const { container } = render(GraphCanvas, { projection, layout, onRequestDelete, onDisconnect })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!

    await fireEvent(
      canvas,
      new CustomEvent('workflowbeforedelete', {
        bubbles: true,
        detail: {
          nodes: [],
          edges: [{ id: 'dependency:collect->review', source: 'collect', target: 'review' }],
        },
      }),
    )

    expect(onRequestDelete).not.toHaveBeenCalled()
    expect(onDisconnect).toHaveBeenCalledWith('collect', 'review')
  })
})
