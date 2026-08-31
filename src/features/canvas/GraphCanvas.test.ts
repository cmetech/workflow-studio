import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { Position } from '@xyflow/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import {
  CommandDisabledError,
  commandRegistry,
  createCommandRegistry,
  listCommands,
  setCanvasCommandHandlers,
  type CanvasCommandHandlers,
  type CommandSurface,
} from '$src/lib/commands/registry'
import { $canvasPositions, $canvasSelection, clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import GraphCanvas from './GraphCanvas.svelte'
import GraphCanvasInspectorHarness from './GraphCanvasInspectorHarness.svelte'
import WorkflowEdge from './WorkflowEdge.svelte'
import { createCanvasActivationBarrier } from './canvas-activation-barrier'
import { NODE_KIND_DRAG_TYPE } from './node-kind-options'

function renderCanvas(props: Record<string, unknown>) {
  return render(GraphCanvas, { commandSurface: commandRegistry, ...props } as never)
}

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
    const { container } = renderCanvas({ projection, layout, onPersistLayout: persistLayout })
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

  it('applies every selected node in one drag payload, persists once, and restores both positions on reopen', async () => {
    vi.useFakeTimers()
    let persisted: LayoutRecordV1 | undefined
    const persistLayout = vi.fn(async (next: LayoutRecordV1) => {
      persisted = structuredClone(next)
    })
    let rendered = renderCanvas({ projection, layout, onPersistLayout: persistLayout })
    let canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const nodes = [
      { id: 'collect', position: { x: 140, y: 160 } },
      { id: 'review', position: { x: 460, y: 160 } },
    ]

    await fireEvent(canvas, new CustomEvent('workflowdragmove', { bubbles: true, detail: { nodes } }))
    expect($canvasPositions.get()).toEqual({ collect: { x: 140, y: 160 }, review: { x: 460, y: 160 } })
    expect(persistLayout).not.toHaveBeenCalled()

    await fireEvent(canvas, new CustomEvent('workflowdragstop', { bubbles: true, detail: { nodes } }))
    await vi.advanceTimersByTimeAsync(300)
    expect(persistLayout).toHaveBeenCalledOnce()
    expect(persisted?.nodePositions).toEqual({ collect: { x: 140, y: 160 }, review: { x: 460, y: 160 } })

    rendered.unmount()
    rendered = renderCanvas({ projection, layout: persisted!, onPersistLayout: persistLayout })
    canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    expect(canvas).toBeVisible()
    expect($canvasPositions.get()).toEqual({ collect: { x: 140, y: 160 }, review: { x: 460, y: 160 } })
  })

  it('accepts a validated node-kind HTML drop at exact flow coordinates', async () => {
    const onDropNodeKind = vi.fn()
    const { container } = renderCanvas({ projection, layout, onDropNodeKind })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const viewport = container.querySelector<HTMLElement>('[data-testid="workflow-canvas-viewport"]')!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
      toJSON: () => undefined,
    })
    const transfer = {
      types: [NODE_KIND_DRAG_TYPE],
      dropEffect: '',
      getData: (type: string) => (type === NODE_KIND_DRAG_TYPE ? 'command' : ''),
    }

    await fireEvent.drop(canvas, {
      clientX: 500,
      clientY: 350,
      dataTransfer: transfer,
    })
    expect(onDropNodeKind).not.toHaveBeenCalled()

    await fireEvent.dragOver(viewport, { dataTransfer: transfer })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(drop, {
      clientX: { value: 500 },
      clientY: { value: 350 },
      dataTransfer: { value: transfer },
    })
    await fireEvent(viewport, drop)

    expect(transfer.dropEffect).toBe('copy')
    expect(onDropNodeKind).toHaveBeenCalledOnce()
    expect(onDropNodeKind).toHaveBeenCalledWith('command', { x: 400, y: 300 })
  })

  it('fails closed for palette drops while read-only and for malformed drag payloads', async () => {
    const onDropNodeKind = vi.fn()
    const { container } = renderCanvas({ projection, layout, readOnly: true, onDropNodeKind })
    const viewport = container.querySelector<HTMLElement>('[data-testid="workflow-canvas-viewport"]')!

    await fireEvent.drop(viewport, {
      clientX: 100,
      clientY: 100,
      dataTransfer: { types: [NODE_KIND_DRAG_TYPE], getData: () => 'command' },
    })
    await fireEvent.drop(viewport, {
      clientX: 100,
      clientY: 100,
      dataTransfer: { types: ['text/plain'], getData: () => 'command' },
    })

    expect(onDropNodeKind).not.toHaveBeenCalled()
  })

  it('keeps canvas chrome outside the dedicated pointer and drop viewport', async () => {
    let requestEdge = (): void => undefined
    const commandSurface: CommandSurface = {
      listCommands,
      executeCommand: vi.fn(async (id: string) => {
        if (id === 'canvas.create-edge') requestEdge()
        return { commandPalette: 'close' as const }
      }),
    }
    const rendered = render(GraphCanvas, { commandSurface, projection, layout } as never)
    requestEdge = rendered.component.requestEdge
    const { container, rerender } = rendered
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    await fireEvent(canvas, new CustomEvent('workflowselectionchange', { bubbles: true, detail: { ids: ['collect'] } }))
    await tick()
    await fireEvent.click(screen.getByRole('button', { name: 'Create Edge' }))

    const tools = screen.getByLabelText('Canvas tools')
    const viewport = container.querySelector<HTMLElement>('[data-testid="workflow-canvas-viewport"]')
    expect(viewport).not.toBeNull()
    expect(viewport).not.toContainElement(tools)
    expect(viewport?.parentElement).toBe(tools.parentElement)
    expect(viewport?.querySelector('.svelte-flow__controls')).toBeNull()
    expect(viewport?.querySelector('.svelte-flow__minimap')).toBeNull()
    expect(screen.getByText(/create edge from collect/i).closest('[data-canvas-chrome]')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menuitem', { name: 'Zoom In' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Fit Graph' })).toBeVisible()
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Zoom In' }), { key: 'Escape' })
    for (const chrome of container.querySelectorAll<HTMLElement>('[data-canvas-chrome]')) {
      expect(viewport).not.toContainElement(chrome)
    }

    await rerender({ commandSurface, projection, layout, stale: true })
    expect(screen.getByText(/last valid graph.*read-only/i).closest('[data-canvas-chrome]')).not.toBeNull()
  })

  it('renders read-only stale affordances with viewport commands and explicit Arrange in normal-flow chrome', async () => {
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    renderCanvas({ projection, layout, stale: true, readOnly: true, onPersistLayout: persistLayout })

    expect(screen.getByText(/last valid graph.*read-only/i)).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Zoom In' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Zoom Out' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Actual Size' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Fit Graph' })).toBeEnabled()
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument()
  })

  it('labels a current invalid read-only projection without calling it the last valid graph', () => {
    renderCanvas({ projection, layout, stale: true, staleSource: 'current', readOnly: true })

    expect(screen.getByText(/current graph.*read-only/i)).toBeVisible()
    expect(screen.queryByText(/last valid graph/i)).not.toBeInTheDocument()
  })

  it('suppresses graph callbacks, palette drops, drag state, and layout persistence while stale', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    const onRequestAdd = vi.fn()
    const onDropNodeKind = vi.fn()
    const { component, container } = renderCanvas({
      projection,
      layout,
      stale: true,
      onPersistLayout: persistLayout,
      onConnect,
      onDisconnect,
      onRequestAdd,
      onDropNodeKind,
    })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const viewport = container.querySelector<HTMLElement>('[data-testid="workflow-canvas-viewport"]')!

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
    await fireEvent(
      canvas,
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'collect', target: 'review' } }),
    )
    await fireEvent(
      canvas,
      new CustomEvent('workflowdisconnect', { bubbles: true, detail: { source: 'collect', target: 'review' } }),
    )
    await fireEvent.drop(viewport, {
      clientX: 100,
      clientY: 100,
      dataTransfer: { types: [NODE_KIND_DRAG_TYPE], getData: () => 'command' },
    })
    component.requestAdd()
    component.arrange()
    await vi.advanceTimersByTimeAsync(300)

    expect($canvasPositions.get()).toEqual(layout.nodePositions)
    expect(onConnect).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(onRequestAdd).not.toHaveBeenCalled()
    expect(onDropNodeKind).not.toHaveBeenCalled()
    expect(persistLayout).not.toHaveBeenCalled()
  })

  it('suppresses synthetic drag, selection, and Arrange mutations while an activation transition is locked', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const { container } = renderCanvas({
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
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Arrange Graph' }))
    await vi.advanceTimersByTimeAsync(300)

    expect($canvasPositions.get().collect).toEqual({ x: 0, y: 0 })
    expect($canvasSelection.get()).toEqual(['review'])
    expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeDisabled()
    expect(persistLayout).not.toHaveBeenCalled()
  })

  it('publishes selection changes only while the authoring surface is active', async () => {
    const rendered = renderCanvas({ projection, layout, surfaceActive: false })
    const canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    setCanvasSelection(['review'])

    await fireEvent(canvas, new CustomEvent('workflowselectionchange', { bubbles: true, detail: { ids: [] } }))
    await tick()

    expect($canvasSelection.get()).toEqual(['review'])

    await rendered.rerender({ commandSurface: commandRegistry, projection, layout, surfaceActive: true })
    await fireEvent(canvas, new CustomEvent('workflowselectionchange', { bubbles: true, detail: { ids: [] } }))
    await tick()

    expect($canvasSelection.get()).toEqual(['review'])

    await fireEvent.pointerDown(canvas)
    await fireEvent(canvas, new CustomEvent('workflowselectionchange', { bubbles: true, detail: { ids: [] } }))
    await tick()

    expect($canvasSelection.get()).toEqual([])

    await fireEvent(canvas, new CustomEvent('workflowselectionchange', { bubbles: true, detail: { ids: ['collect'] } }))
    await tick()

    expect($canvasSelection.get()).toEqual(['collect'])
  })

  it('keeps the selected node authoritative when projection diagnostics refresh', async () => {
    const rendered = renderCanvas({ projection, layout })
    const selectedNode = rendered.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!

    await fireEvent.click(selectedNode)
    await tick()

    expect($canvasSelection.get()).toEqual(['review'])
    expect(selectedNode).toHaveClass('selected')
    expect(screen.getByRole('button', { name: 'Create Edge' })).toBeEnabled()

    const refreshedProjection: WorkflowProjection = {
      ...projection,
      nodes: projection.nodes.map((node) => ({ ...node })),
    }
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: refreshedProjection,
      layout,
      issues: [
        {
          code: 'schema_required',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Command is required.',
          document: 'definition',
          nodeId: 'collect',
        },
      ],
    })
    await tick()

    expect($canvasSelection.get()).toEqual(['review'])
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="review"]')).toHaveClass('selected')
    expect(screen.getByRole('button', { name: 'Create Edge' })).toBeEnabled()
  })

  it('prunes a selected node removed while the authoring surface is inactive', async () => {
    const onOpenInspector = vi.fn()
    const rendered = renderCanvas({ projection, layout, onOpenInspector })
    const canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const selectedNode = rendered.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!

    await fireEvent.click(selectedNode)
    await tick()
    expect($canvasSelection.get()).toEqual(['review'])

    await rendered.rerender({
      commandSurface: commandRegistry,
      projection,
      layout,
      surfaceActive: false,
      onOpenInspector,
    })
    const projectionWithoutReview: WorkflowProjection = {
      ...projection,
      nodes: projection.nodes.filter(({ id }) => id !== 'review'),
      edges: [],
    }
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: projectionWithoutReview,
      layout,
      surfaceActive: false,
      onOpenInspector,
    })
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: projectionWithoutReview,
      layout,
      surfaceActive: true,
      onOpenInspector,
    })
    await tick()

    expect($canvasSelection.get()).toEqual([])
    expect(rendered.container.querySelector('.svelte-flow__node.selected')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create Edge' })).toBeDisabled()

    const noOp = vi.fn()
    const handlers: CanvasCommandHandlers = {
      addNode: noOp,
      addAfterSelection: noOp,
      selectAll: noOp,
      copySelection: noOp,
      deleteSelection: noOp,
      duplicateSelection: noOp,
      pasteSelection: noOp,
      arrange: noOp,
      zoomIn: noOp,
      zoomOut: noOp,
      actualSize: noOp,
      fitGraph: noOp,
      fitSelection: noOp,
      nudge: noOp,
      openInspector: () => rendered.component.openInspector(),
      cancel: noOp,
      createEdge: noOp,
    }
    const unbind = setCanvasCommandHandlers(handlers)
    try {
      await expect(
        commandRegistry.executeCommand('canvas.open-inspector', {
          surface: 'canvas',
          canMutate: true,
          hasSelection: $canvasSelection.get().length > 0,
        }),
      ).rejects.toBeInstanceOf(CommandDisabledError)
      expect(onOpenInspector).not.toHaveBeenCalled()
    } finally {
      unbind()
    }

    await fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onOpenInspector).not.toHaveBeenCalled()
  })

  it('flushes a pending drag-stop persistence before the canvas closes', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const { component, container, unmount } = renderCanvas({
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
    const { container, rerender } = renderCanvas({
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
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeEnabled()
  })

  it('persists one pending A drag before an open-draft transition and one B drag under the new identity', async () => {
    vi.useFakeTimers()
    const persisted: LayoutRecordV1[] = []
    const persistLayout = vi.fn(async (next: LayoutRecordV1) => {
      persisted.push(structuredClone(next))
    })
    const { component, container, rerender } = renderCanvas({
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

  it('exposes stable node and truthful 32px dependency-port hooks for pointer and screen-reader users', async () => {
    const rendered = renderCanvas({ projection, layout })
    const { container } = rendered
    await tick()

    for (const node of projection.nodes) {
      const article = container.querySelector<HTMLElement>(`article[aria-label="${node.kind} node ${node.id}"]`)
      expect(article).toHaveAttribute('data-node-id', node.id)
      expect(Array.from(article!.querySelectorAll('[data-port]'), (port) => port.getAttribute('data-port'))).toEqual([
        'input',
        'output',
      ])
    }

    const incoming = screen.getByLabelText('Dependencies entering collect')
    expect(incoming).toHaveAttribute('data-port', 'input')
    expect(incoming).not.toHaveAttribute('role', 'button')
    expect(incoming).not.toHaveAttribute('tabindex', '0')
    expect(incoming).toHaveAttribute('title', 'Dependencies entering collect')
    expect(getComputedStyle(incoming).width).toBe('32px')
    expect(getComputedStyle(incoming).height).toBe('32px')

    const outgoing = screen.getByLabelText('Dependencies leaving collect')
    expect(outgoing).toHaveAttribute('data-port', 'output')
    expect(outgoing).not.toHaveAttribute('role', 'button')
    expect(outgoing).not.toHaveAttribute('tabindex', '0')
    expect(outgoing).toHaveAttribute('title', 'Dependencies leaving collect')

    await rendered.rerender({ commandSurface: commandRegistry, projection, layout, readOnly: true })
    expect(screen.getByLabelText('Dependencies entering collect')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Dependencies leaving collect')).not.toHaveAttribute('tabindex', '0')
  })

  it('retargets a collapsed node Inspector button before toggling that selected node closed', async () => {
    const rendered = render(GraphCanvasInspectorHarness, {
      props: { canvasProps: { commandSurface: commandRegistry, projection, layout } },
    })
    const canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    await fireEvent(canvas, new CustomEvent('workflowselectionchange', { bubbles: true, detail: { ids: ['collect'] } }))
    await tick()
    expect($canvasSelection.get()).toEqual(['collect'])

    const collect = rendered.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="collect"]')!
    expect(collect).toHaveAttribute('role', 'group')
    expect(collect).not.toHaveAttribute('aria-expanded')

    const inspectorTrigger = screen.getByRole('button', { name: /Inspector for collect$/ })
    const inspector = screen.getByLabelText('Test Inspector')
    expect(inspectorTrigger.tagName).toBe('BUTTON')
    expect(inspectorTrigger).toHaveAttribute('aria-controls', 'workflow-inspector')
    expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(inspector).toHaveAttribute('inert')
    expect(inspector).toHaveAttribute('aria-hidden', 'true')

    await fireEvent.click(inspectorTrigger)
    await tick()
    expect($canvasSelection.get()).toEqual(['collect'])
    expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(inspector).not.toHaveAttribute('inert')
    expect(inspector).not.toHaveAttribute('aria-hidden')

    const reviewTrigger = screen.getByRole('button', { name: /Inspector for review$/ })
    expect(reviewTrigger).toHaveAttribute('aria-expanded', 'false')
    reviewTrigger.focus()
    await fireEvent.click(reviewTrigger)
    await tick()
    expect($canvasSelection.get()).toEqual(['review'])
    expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(reviewTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(inspector).not.toHaveAttribute('inert')

    reviewTrigger.focus()
    await fireEvent.click(reviewTrigger)
    await tick()
    expect(reviewTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(inspector).toHaveAttribute('inert')
    expect(inspector).toHaveAttribute('aria-hidden', 'true')
    expect(reviewTrigger).toHaveFocus()
  })

  it('keeps required and error issue counts visible as text on the affected node', async () => {
    const { container } = renderCanvas({
      projection,
      layout,
      issues: [
        {
          code: 'schema_required',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Command is required.',
          document: 'definition',
          nodeId: 'collect',
        },
      ],
    })
    await tick()

    const collect = container.querySelector<HTMLElement>('[data-node-id="collect"]')!
    const issueText = within(collect).getByLabelText('Node issues')
    expect(issueText).toHaveTextContent('1 required')
    expect(issueText).toHaveTextContent('1 error')
  })

  it('routes semantic connection events without changing layout and announces one typed rejection politely', async () => {
    vi.useFakeTimers()
    const onConnect = vi.fn(async () => ({
      status: 'rejected' as const,
      code: 'cycle',
      message: 'Connecting review to collect would create a cycle.',
    }))
    const persistLayout = vi.fn()
    const { container } = renderCanvas({ projection, layout, onConnect, onPersistLayout: persistLayout })
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

  it('derives toolbar metadata, enablement, disabled reasons, and execution from its injected registry', async () => {
    const registry = createCommandRegistry()
    const runAdd = vi.fn()
    for (const command of listCommands()) {
      registry.registerCommand(
        command.id === 'canvas.add-node'
          ? { ...command, label: 'Registry Add', defaultBindings: ['A'], run: runAdd }
          : command.id === 'canvas.delete-selection'
            ? {
                ...command,
                label: 'Registry Remove',
                enabled: () => false,
                disabledReason: () => 'Registry selection required.',
              }
            : command,
      )
    }
    render(GraphCanvas, { commandSurface: registry, projection, layout } as never)
    setCanvasSelection(['review'])

    const add = screen.getByRole('button', { name: 'Registry Add' })
    expect(add).toHaveAttribute('title', expect.stringMatching(/registry add.*a/i))
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    const remove = screen.getByRole('menuitem', { name: 'Registry Remove' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('title', 'Registry selection required.')
    await fireEvent.click(add)
    expect(runAdd).toHaveBeenCalledOnce()
  })

  it('never disconnects incident edges while node deletion awaits resolution or confirmation', async () => {
    const onRequestDelete = vi.fn(async () => ({ status: 'resolution_required' as const }))
    const onDisconnect = vi.fn(async () => ({ status: 'committed' as const }))
    const { container } = renderCanvas({ projection, layout, onRequestDelete, onDisconnect })
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
    const { container } = renderCanvas({ projection, layout, onRequestDelete, onDisconnect })
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

describe('WorkflowEdge', () => {
  function renderEdge(selected = false, stale = false) {
    return render(WorkflowEdge, {
      id: 'dependency:collect->review',
      sourceX: 0,
      sourceY: 0,
      targetX: 320,
      targetY: 0,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      selected,
      data: { stale, readOnly: false },
    } as never)
  }

  it('retains a 32px transparent edge interaction path', () => {
    const { container } = renderEdge()

    expect(container.querySelector('.svelte-flow__edge-interaction')).toHaveAttribute('stroke-width', '32')
  })

  it('exposes selected and stale semantic classes on the visible edge path', () => {
    const { container } = renderEdge(true, true)
    const path = container.querySelector<SVGPathElement>('.svelte-flow__edge-path')!

    expect(path).toHaveClass('workflow-edge', 'selected', 'stale')
  })
})
