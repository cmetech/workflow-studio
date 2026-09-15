import { tick } from 'svelte'
import { $canvasPositions, clearCanvasState } from '$src/stores/canvas'
import { createEditorMetricsCollector, installEditorMetrics } from '$src/lib/metrics/editor-metrics'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { commandRegistry } from '$src/lib/commands/registry'
import { CANVAS_PAN_INTERACTION } from '$src/lib/commands/canvas-interactions'
import type { ScopeLayoutV1 } from '$src/lib/layout/types'
import type { ProjectedGraph } from '$src/lib/projection/types'
import { VISUAL_NODE_CAPACITY } from '$src/lib/projection/types'

const transientBoundary = vi.hoisted(() => {
  const original = vi.fn()
  return {
    original,
    store: {
      domNode: null as ParentNode | null,
      updateNodePositions: original,
    },
  }
})

vi.mock('@xyflow/svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/svelte')>()
  const [{ default: SvelteFlow }, { default: Background }] = await Promise.all([
    import('./SvelteFlowBoundaryProbe.svelte'),
    import('./SvelteFlowBoundaryNoop.svelte'),
  ])
  return {
    ...actual,
    SvelteFlow,
    Background,
    useSvelteFlow: () => ({ fitView: async () => true, getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }),
    useStore: () => transientBoundary.store,
  }
})

import GraphCanvas from './GraphCanvas.svelte'

const projection: ProjectedGraph = Object.freeze({
  scope: Object.freeze({
    key: 'root',
    kind: 'root',
    workflow: Object.freeze({ name: 'Boundary', profile: 'hermes-legacy' }),
  }),
  editorNodePrefix: '',
  sourcePath: Object.freeze(['nodes']),
  sourceRange: Object.freeze({ start: 0, end: 0 }),
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  definitionOrder: Object.freeze([]),
  outerInputs: Object.freeze([]),
  issues: Object.freeze([]),
  capacity: Object.freeze({ status: 'visual', nodeCount: 0, edgeCount: 0 }),
})

const layout: ScopeLayoutV1 = {
  selectedNodeIds: [],
  inspector: { tab: 'General', scrollTop: 0 },
  canvasScroll: { left: 0, top: 0 },

  nodePositions: {},
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('GraphCanvas Svelte Flow boundary', () => {
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
    transientBoundary.store.domNode = null
    transientBoundary.store.updateNodePositions = transientBoundary.original
    transientBoundary.original.mockClear()
  })

  it('restores transient DOM before delayed Svelte Flow callbacks when authorability is lost', async () => {
    const node = {
      id: 'first',
      kind: 'prompt',
      value: 'First',
      dependsOn: [],
      options: {},
      source: { path: '/nodes/0', start: 0, end: 1 },
    }
    const graph: ProjectedGraph = {
      ...projection,
      nodes: [node],
      definitionOrder: ['first'],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    }
    const saved = { ...layout, nodePositions: { first: { x: 0, y: 0 } } }
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="svelte-flow__node selected" data-id="first" style="transform: translate(7px, 8px)"></div>'
    transientBoundary.store.domNode = root
    const onPersistLayout = vi.fn()
    const props = {
      commandSurface: commandRegistry,
      projection: graph,
      layout: saved,
      onPersistLayout,
    }
    const rendered = render(GraphCanvas, props)
    try {
      await tick()
      const canvas = screen.getByTestId('workflow-canvas')
      const element = root.querySelector<HTMLElement>('[data-id="first"]')!
      const firstMove = new Map([['first', { internals: { positionAbsolute: { x: 75, y: 90 } } }]])

      await fireEvent(canvas, new CustomEvent('workflowdragstart'))
      transientBoundary.store.updateNodePositions(firstMove, true)
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragmove', { detail: { id: 'first', position: { x: 75, y: 90 } } }),
      )
      expect(element.style.transform).toBe('translate(75px, 90px)')
      expect(element).toHaveClass('dragging')

      await rendered.rerender({ ...props, readOnly: true })
      await tick()

      expect(element.style.transform).toBe('translate(7px, 8px)')
      expect(element).not.toHaveClass('dragging')
      transientBoundary.store.updateNodePositions(
        new Map([['first', { internals: { positionAbsolute: { x: 175, y: 190 } } }]]),
        true,
      )
      transientBoundary.store.updateNodePositions(firstMove, false)
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', { detail: { id: 'first', position: { x: 175, y: 190 } } }),
      )
      await rendered.component.flushPersistence()

      expect(element.style.transform).toBe('translate(7px, 8px)')
      expect(element).not.toHaveClass('dragging')
      expect(transientBoundary.original).not.toHaveBeenCalled()
      expect($canvasPositions.get()).toEqual(saved.nodePositions)
      expect(onPersistLayout).not.toHaveBeenCalled()

      await rendered.rerender({ ...props, readOnly: false })
      await fireEvent(canvas, new CustomEvent('workflowdragstart'))
      const secondMove = new Map([['first', { internals: { positionAbsolute: { x: 125, y: 150 } } }]])
      transientBoundary.store.updateNodePositions(secondMove, true)
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragmove', { detail: { id: 'first', position: { x: 125, y: 150 } } }),
      )
      transientBoundary.store.updateNodePositions(secondMove, false)
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', { detail: { id: 'first', position: { x: 125, y: 150 } } }),
      )
      await rendered.component.flushPersistence()

      expect(transientBoundary.original).toHaveBeenCalledOnce()
      expect(transientBoundary.original).toHaveBeenCalledWith(secondMove, false)
      expect($canvasPositions.get()).toEqual({ first: { x: 125, y: 150 } })
      expect(onPersistLayout).toHaveBeenCalledOnce()
    } finally {
      rendered.unmount()
    }
  })

  it('[RG6] defers auto-pan layout work throughout a held node drag and saves its final viewport once', async () => {
    vi.useFakeTimers()
    const node = {
      id: 'first',
      kind: 'prompt',
      value: 'First',
      dependsOn: [],
      options: {},
      source: { path: '/nodes/0', start: 0, end: 1 },
    }
    const graph: ProjectedGraph = {
      ...projection,
      nodes: [node],
      definitionOrder: ['first'],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    }
    const saved = { ...layout, nodePositions: { first: { x: 0, y: 0 } } }
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    const client = { arrange: vi.fn(), cancel: vi.fn(), destroy: vi.fn() }
    const metrics = createEditorMetricsCollector()
    const restoreMetrics = installEditorMetrics(metrics)
    const rendered = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: graph,
      layout: saved,
      onLayoutChange,
      onPersistLayout,
      layoutClient: client,
    })
    try {
      await tick()
      const canvas = screen.getByTestId('workflow-canvas')
      const flow = screen.getByTestId('svelte-flow-boundary-probe')
      await fireEvent(canvas, new CustomEvent('workflowdragstart'))
      onLayoutChange.mockClear()
      metrics.reset()
      for (let frame = 1; frame <= 20; frame++) {
        await fireEvent(
          canvas,
          new CustomEvent('workflowdragmove', { detail: { id: 'first', position: { x: frame * 10, y: frame * 5 } } }),
        )
        await fireEvent(flow, new CustomEvent('flowboundarypan', { detail: { x: -frame * 4, y: frame * 2, zoom: 1 } }))
        await vi.advanceTimersByTimeAsync(20)
      }
      // The pointer is still held past the persistence debounce.
      await vi.advanceTimersByTimeAsync(500)
      expect(onLayoutChange).not.toHaveBeenCalled()
      expect(onPersistLayout).not.toHaveBeenCalled()
      expect(client.arrange).not.toHaveBeenCalled()
      expect(metrics.snapshot()).toEqual({
        pointerMoves: 20,
        dragCompletions: 0,
        layoutSaves: 0,
        layouts: 0,
        parseRequests: 0,
        validationPasses: 0,
        yamlTransactions: 0,
        gitCalls: 0,
        nativeCalls: 0,
      })
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', { detail: { id: 'first', position: { x: 200, y: 100 } } }),
      )
      expect(onLayoutChange).toHaveBeenCalledOnce()
      expect(onLayoutChange.mock.calls[0]![0]).toMatchObject({
        nodePositions: { first: { x: 200, y: 100 } },
        viewport: { x: -80, y: 40, zoom: 1 },
        routing: undefined,
      })
      await vi.advanceTimersByTimeAsync(299)
      expect(onPersistLayout).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onPersistLayout).toHaveBeenCalledOnce()
      expect(onPersistLayout.mock.calls[0]![0]).toMatchObject({
        nodePositions: { first: { x: 200, y: 100 } },
        viewport: { x: -80, y: 40, zoom: 1 },
      })
      expect(onPersistLayout.mock.calls[0]![0].routing).toBeUndefined()
      expect(metrics.snapshot()).toMatchObject({ dragCompletions: 1, layoutSaves: 1 })
    } finally {
      rendered.unmount()
      restoreMetrics()
    }
  })

  it('persists ordinary viewport panning without a node drag', async () => {
    vi.useFakeTimers()
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    const rendered = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection,
      layout,
      onLayoutChange,
      onPersistLayout,
    })
    try {
      await tick()
      await fireEvent(
        screen.getByTestId('svelte-flow-boundary-probe'),
        new CustomEvent('flowboundarypan', { detail: { x: -40, y: 50, zoom: 0.8 } }),
      )
      expect(onLayoutChange).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(300)
      expect(onPersistLayout).toHaveBeenCalledOnce()
      expect(onPersistLayout.mock.calls[0]![0]).toMatchObject({
        nodePositions: {},
        viewport: { x: -40, y: 50, zoom: 0.8 },
      })
    } finally {
      rendered.unmount()
    }
  })

  it('passes the browser Space key and drag setting to the Svelte Flow component boundary', () => {
    render(GraphCanvas, { commandSurface: commandRegistry, projection, layout } as never)

    expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute('data-received-pan-activation-key', ' ')
    expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute(
      'data-received-pan-on-drag',
      String(CANVAS_PAN_INTERACTION.panOnDrag),
    )
  })

  it('mounts a newly admitted small draft while retaining visible-only rendering at the capacity boundary', () => {
    const projectionWithCount = (nodeCount: number): ProjectedGraph => {
      const nodes = Array.from({ length: nodeCount }, (_, index) => ({
        id: `node-${index}`,
        kind: 'prompt',
        value: `Node ${index}`,
        dependsOn: [],
        options: {},
        source: { path: `/nodes/${index}`, start: index, end: index + 1 },
      }))
      return {
        ...projection,
        nodes,
        definitionOrder: nodes.map(({ id }) => id),
        capacity: { status: 'visual', nodeCount, edgeCount: 0 },
      }
    }

    const small = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: projectionWithCount(1),
      layout,
    } as never)
    expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute('data-received-visible-only', 'false')
    small.unmount()

    for (const nodeCount of [2, VISUAL_NODE_CAPACITY - 1, VISUAL_NODE_CAPACITY]) {
      const virtualized = render(GraphCanvas, {
        commandSurface: commandRegistry,
        projection: projectionWithCount(nodeCount),
        layout,
      } as never)
      expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute('data-received-visible-only', 'true')
      virtualized.unmount()
    }
  })
})
