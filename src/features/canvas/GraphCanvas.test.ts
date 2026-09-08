import { createLargeWorkflowFixture } from '../../../tests/performance/large-workflow'
import { emptyIdentityChanges } from './canvas-actions'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import { $activeLayout, activeScopeLayout, clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import * as canvasScope from '$src/stores/canvas-scope'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { Position } from '@xyflow/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LayoutRecordV2, ScopeLayoutV1 } from '$src/lib/layout/types'
import type { ProjectedGraph, WorkflowProjection } from '$src/lib/projection/types'
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
import { createEditorMetricsCollector, installEditorMetrics } from '$src/lib/metrics/editor-metrics'
import { ROUTING_ENGINE, type ScopeRoutingV1 } from '$src/lib/layout/routing'
import * as routedLayout from './routed-layout'
import { graphFingerprint, routingFingerprint } from './routed-layout'
import type { LayoutWorkerRequest, LayoutWorkerResult, LayoutWorkerSuccess } from '$src/workers/layout-worker-protocol'
import { NODE_KIND_DRAG_TYPE } from './node-kind-options'

function renderCanvas(props: Record<string, unknown>) {
  return render(GraphCanvas, { commandSurface: commandRegistry, ...props } as never)
}

const projection: ProjectedGraph = Object.freeze({
  scope: Object.freeze({
    key: 'root',
    kind: 'root',
    workflow: Object.freeze({ name: 'Release', profile: 'hermes-legacy' }),
  }),
  editorNodePrefix: '',
  sourcePath: Object.freeze(['nodes']),
  sourceRange: Object.freeze({ start: 0, end: 50 }),
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
  definitionOrder: Object.freeze(['collect', 'review']),
  outerInputs: Object.freeze([]),
  issues: Object.freeze([]),
  capacity: Object.freeze({ status: 'visual', nodeCount: 2, edgeCount: 1 }),
})

const layout: ScopeLayoutV1 = {
  selectedNodeIds: [],
  inspector: { tab: 'General', scrollTop: 0 },
  canvasScroll: { left: 0, top: 0 },

  nodePositions: { collect: { x: 0, y: 0 }, review: { x: 320, y: 0 } },
  viewport: { x: 0, y: 0, zoom: 1 },
}

const denseProjection: ProjectedGraph = {
  ...projection,
  nodes: [
    ...projection.nodes,
    {
      id: 'publish',
      kind: 'command',
      value: 'Publish release',
      dependsOn: ['collect'],
      options: {},
      source: { path: '/nodes/2', start: 51, end: 70 },
    },
  ],
  edges: [...projection.edges, { id: 'dependency:collect->publish', source: 'collect', target: 'publish' }],
  definitionOrder: ['collect', 'review', 'publish'],
  capacity: { status: 'visual', nodeCount: 3, edgeCount: 2 },
}

const denseLayout: ScopeLayoutV1 = {
  ...layout,
  nodePositions: { ...layout.nodePositions, publish: { x: 320, y: 180 } },
}

class DeferredLayoutClient {
  requests: LayoutWorkerRequest[] = []
  resolve!: (result: LayoutWorkerResult) => void
  reject!: (reason: Error) => void
  arrange(request: LayoutWorkerRequest): Promise<LayoutWorkerResult> {
    this.requests.push(request)
    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
  cancel = vi.fn(() => this.reject?.(new Error('cancelled')))
  destroy = vi.fn(() => this.cancel())
}

function successfulArrangement(request: LayoutWorkerRequest): LayoutWorkerSuccess {
  const positions = Object.fromEntries(request.nodes.map(({ id }, index) => [id, { x: 32 + index * 400, y: 32 }]))
  return {
    type: 'layout-result',
    identity: request.identity,
    spacingProfile: 'default',
    durationMs: 5,
    positions,
    routes: Object.fromEntries(
      request.edges.map(({ id, source, target }) => [
        id,
        {
          edgeId: id,
          points: [
            { x: positions[source]!.x + request.nodes.find(({ id }) => id === source)!.width, y: 84 },
            { x: positions[target]!.x, y: 84 },
          ],
        },
      ]),
    ),
    bounds: {
      x: 32,
      y: 32,
      width: (request.nodes.length - 1) * 400 + request.nodes.at(-1)!.width,
      height: Math.max(...request.nodes.map(({ height }) => height)),
    },
  }
}

// Publish real Svelte Flow measurements through its ResizeObserver boundary.
function canvasMeasurements(
  sizes: Record<string, { width: number; height: number }> = {
    collect: { width: 240, height: 104 },
    review: { width: 240, height: 168 },
  },
) {
  const previousObserver = globalThis.ResizeObserver
  const previousMatrix = window.DOMMatrixReadOnly
  const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = []
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return sizes[this.dataset.id ?? '']?.width ?? 800
  })
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return sizes[this.dataset.id ?? '']?.height ?? 600
  })
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets: Element[] = []
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, targets: this.targets })
      }
      observe(target: Element) {
        this.targets.push(target)
      }
      unobserve() {}
      disconnect() {}
    },
  )
  return {
    async publish() {
      await tick()
      for (const observer of observers)
        observer.callback(
          observer.targets.map(
            (target) => ({ target, contentRect: new DOMRect(0, 0, 800, 600) }) as ResizeObserverEntry,
          ),
          {} as ResizeObserver,
        )
      await tick()
    },
    restore() {
      width.mockRestore()
      height.mockRestore()
      vi.stubGlobal('ResizeObserver', previousObserver)
      vi.stubGlobal('DOMMatrixReadOnly', previousMatrix)
    },
  }
}

async function savedRouting(graph = projection): Promise<ScopeRoutingV1> {
  return {
    schemaVersion: 1,
    engine: ROUTING_ENGINE,
    fingerprint: await routingFingerprint({
      graphFingerprint: await graphFingerprint({
        engine: ROUTING_ENGINE,
        scopeKey: graph.scope.key,
        nodes: graph.nodes.map(({ id }, order) => ({ id, order, width: 240, height: id === 'review' ? 168 : 104 })),
        edges: graph.edges.map((edge, order) => ({ ...edge, order })),
      }),
      positions: layout.nodePositions,
    }),
    routes: {
      'dependency:collect->review': {
        edgeId: 'dependency:collect->review',
        points: [
          { x: 240, y: 40 },
          { x: 320, y: 40 },
        ],
      },
    },
  }
}

const arrangeFailure = 'Arrange Graph could not produce a safe routed layout. Your current layout was preserved.'

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

  it('emphasizes a hovered or focused dependency and both endpoints while keeping other connections visible', async () => {
    const measurements = canvasMeasurements({
      collect: { width: 216, height: 104 },
      review: { width: 216, height: 104 },
      publish: { width: 216, height: 104 },
    })
    const onLayoutChange = vi.fn()
    const onPersistLayout = vi.fn()
    const { container } = renderCanvas({
      projection: denseProjection,
      layout: denseLayout,
      onLayoutChange,
      onPersistLayout,
    })
    await measurements.publish()
    const edges = [...container.querySelectorAll<SVGGElement>('.svelte-flow__edge')]
    const active = edges.find((edge) => edge.dataset.id === 'dependency:collect->review')!
    const other = edges.find((edge) => edge.dataset.id === 'dependency:collect->publish')!
    const node = (id: string) =>
      container.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${id}"] .workflow-node`)!

    await fireEvent.pointerEnter(active)
    expect(active.querySelector('.workflow-edge')).toHaveClass('emphasized')
    expect(other.querySelector('.workflow-edge')).toHaveClass('deemphasized')
    expect(other.querySelector('.workflow-edge')).toBeVisible()
    expect(node('collect')).toHaveClass('edge-emphasized')
    expect(node('review')).toHaveClass('edge-emphasized')
    expect(node('publish')).toHaveClass('edges-deemphasized')

    await fireEvent.pointerLeave(active)
    expect(container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()
    expect(container.querySelector('.workflow-node.edge-emphasized')).not.toBeInTheDocument()

    active.focus()
    await tick()
    expect(active.querySelector('.workflow-edge')).toHaveClass('emphasized')
    expect(node('collect')).toHaveClass('edge-emphasized')
    expect(node('review')).toHaveClass('edge-emphasized')

    await fireEvent.pointerEnter(other)
    expect(other.querySelector('.workflow-edge')).toHaveClass('emphasized')
    expect(active.querySelector('.workflow-edge')).toHaveClass('deemphasized')
    await fireEvent.pointerLeave(other)
    expect(active.querySelector('.workflow-edge')).toHaveClass('emphasized')

    active.blur()
    await tick()
    expect(container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()
    expect(onLayoutChange).not.toHaveBeenCalled()
    expect(onPersistLayout).not.toHaveBeenCalled()
    measurements.restore()
  })

  it('keeps selected-edge emphasis until Escape or deletion and clears it across scope identity changes', async () => {
    const measurements = canvasMeasurements({
      collect: { width: 216, height: 104 },
      review: { width: 216, height: 104 },
      publish: { width: 216, height: 104 },
    })
    const onDisconnect = vi.fn(async () => ({ status: 'committed' as const }))
    const onLayoutChange = vi.fn()
    const onPersistLayout = vi.fn()
    const rendered = renderCanvas({
      projection: denseProjection,
      layout: denseLayout,
      workflowIdentity: 'root-a',
      onDisconnect,
      onLayoutChange,
      onPersistLayout,
    })
    await measurements.publish()
    const edge = rendered.container.querySelector<SVGGElement>(
      '.svelte-flow__edge[data-id="dependency:collect->review"]',
    )!

    await fireEvent.click(edge)
    await tick()
    expect(edge.querySelector('.workflow-edge')).toHaveClass('selected', 'emphasized')
    expect(rendered.container.querySelectorAll('.workflow-node.edge-emphasized')).toHaveLength(2)

    edge.focus()
    await fireEvent.keyDown(edge, { key: 'Escape' })
    await tick()
    expect(rendered.container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()
    expect(rendered.container.querySelector('.workflow-node.edge-emphasized')).not.toBeInTheDocument()

    await fireEvent.click(
      rendered.container.querySelector<SVGGElement>('.svelte-flow__edge[data-id="dependency:collect->review"]')!,
    )
    await tick()
    expect(
      rendered.container.querySelector('.svelte-flow__edge[data-id="dependency:collect->review"] .workflow-edge'),
    ).toHaveClass('emphasized')
    await fireEvent(
      rendered.container.querySelector('[data-testid="workflow-canvas"]')!,
      new CustomEvent('workflowbeforedelete', {
        bubbles: true,
        detail: { nodes: [], edges: [{ source: 'collect', target: 'review' }] },
      }),
    )
    await tick()
    expect(onDisconnect).toHaveBeenCalledWith('collect', 'review')
    expect(rendered.container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()

    const edgeBeforeScopeChange = rendered.container.querySelector<SVGGElement>(
      '.svelte-flow__edge[data-id="dependency:collect->review"]',
    )!
    await fireEvent.click(edgeBeforeScopeChange)
    await tick()
    expect(edgeBeforeScopeChange.querySelector('.workflow-edge')).toHaveClass('emphasized')
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: {
        ...denseProjection,
        scope: { ...denseProjection.scope, key: 'loop-group:ship', kind: 'loop-group', groupId: 'ship' },
      },
      layout: denseLayout,
      workflowIdentity: 'loop-ship',
      onDisconnect,
      onLayoutChange,
      onPersistLayout,
    } as never)
    await tick()
    expect(rendered.container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()
    expect(onPersistLayout).not.toHaveBeenCalled()
    measurements.restore()
  })

  it('raises a hovered edge above a different selected edge', async () => {
    const measurements = canvasMeasurements({
      collect: { width: 216, height: 104 },
      review: { width: 216, height: 104 },
      publish: { width: 216, height: 104 },
    })
    const { container } = renderCanvas({ projection: denseProjection, layout: denseLayout })
    await measurements.publish()
    const selected = container.querySelector<SVGGElement>('.svelte-flow__edge[data-id="dependency:collect->review"]')!
    const hovered = container.querySelector<SVGGElement>('.svelte-flow__edge[data-id="dependency:collect->publish"]')!

    await fireEvent.click(selected)
    await fireEvent.pointerEnter(hovered)
    await tick()

    expect(selected.querySelector('.workflow-edge')).toHaveClass('selected', 'deemphasized')
    expect(hovered.querySelector('.workflow-edge')).toHaveClass('emphasized')
    expect(Number(getComputedStyle(hovered.closest('svg')!).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(selected.closest('svg')!).zIndex),
    )
    measurements.restore()
  })

  it('clears pointer emphasis through canvas cancellation when keyboard focus is on a node', async () => {
    const measurements = canvasMeasurements({
      collect: { width: 216, height: 104 },
      review: { width: 216, height: 104 },
      publish: { width: 216, height: 104 },
    })
    const { container, component } = renderCanvas({ projection: denseProjection, layout: denseLayout })
    await measurements.publish()
    const edge = container.querySelector<SVGGElement>('.svelte-flow__edge[data-id="dependency:collect->review"]')!
    const node = container.querySelector<HTMLElement>('.svelte-flow__node[data-id="publish"]')!
    await fireEvent.pointerEnter(edge)
    node.focus()
    await tick()
    expect(edge.querySelector('.workflow-edge')).toHaveClass('emphasized')

    expect(component.cancel()).toBe(true)
    await tick()

    expect(container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()
    expect(node).toHaveFocus()
    measurements.restore()
  })

  it('clears incident edge emphasis as soon as a node deletion begins', async () => {
    const measurements = canvasMeasurements({
      collect: { width: 216, height: 104 },
      review: { width: 216, height: 104 },
      publish: { width: 216, height: 104 },
    })
    const onRequestDelete = vi.fn()
    const { container } = renderCanvas({
      projection: denseProjection,
      layout: denseLayout,
      onRequestDelete,
    })
    await measurements.publish()
    const edge = container.querySelector<SVGGElement>('.svelte-flow__edge[data-id="dependency:collect->review"]')!
    await fireEvent.click(edge)
    await tick()
    expect(edge.querySelector('.workflow-edge')).toHaveClass('emphasized')

    await fireEvent(
      container.querySelector('[data-testid="workflow-canvas"]')!,
      new CustomEvent('workflowbeforedelete', {
        bubbles: true,
        detail: {
          nodes: [{ id: 'review' }],
          edges: [{ source: 'collect', target: 'review' }],
        },
      }),
    )
    await tick()

    expect(onRequestDelete).toHaveBeenCalledWith(['review'])
    expect(container.querySelector('.workflow-edge.emphasized')).not.toBeInTheDocument()
    measurements.restore()
  })

  it('[RG5] restores exact persisted routes only after measurements and preserves a persistence echo', async () => {
    const measurements = canvasMeasurements()
    const routing = await savedRouting()
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    const client = new DeferredLayoutClient()
    const props = {
      commandSurface: commandRegistry,
      projection,
      layout: { ...layout, routing },
      layoutClient: client,
      onLayoutChange,
      onPersistLayout,
    }
    const rendered = renderCanvas(props)
    try {
      await tick()
      expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).not.toBe('M 240 40 L 320 40')
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      const edge = rendered.container.querySelector('.workflow-edge')
      await rendered.rerender({ ...props, layout: structuredClone(props.layout) })
      expect(rendered.container.querySelector('.workflow-edge')).toBe(edge)
      expect(edge?.getAttribute('d')).toBe('M 240 40 L 320 40')
      expect(client.requests).toHaveLength(0)
      expect(onLayoutChange).not.toHaveBeenCalled()
      expect(onPersistLayout).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('[RG6] clears routing at drag start and does no expensive work during 1,000 moves', async () => {
    const measurements = canvasMeasurements()
    const routing = await savedRouting()
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    const client = new DeferredLayoutClient()
    const hashing = vi.spyOn(crypto.subtle, 'digest')
    const resolving = vi.spyOn(routedLayout, 'resolveCurrentRouting')
    const metrics = createEditorMetricsCollector()
    const restoreMetrics = installEditorMetrics(metrics)
    const rendered = renderCanvas({
      projection,
      layout: { ...layout, routing },
      layoutClient: client,
      onLayoutChange,
      onPersistLayout,
    })
    try {
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      const canvas = screen.getByTestId('workflow-canvas')
      await fireEvent(canvas, new CustomEvent('workflowdragstart', { bubbles: true }))
      expect(onLayoutChange).toHaveBeenCalledWith(expect.objectContaining({ routing: undefined }), expect.any(String))
      expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).not.toBe('M 240 40 L 320 40')
      metrics.reset()
      hashing.mockClear()
      resolving.mockClear()
      onLayoutChange.mockClear()
      vi.useFakeTimers()
      for (let move = 1; move <= 1_000; move++) {
        canvas.dispatchEvent(
          new CustomEvent('workflowdragmove', {
            bubbles: true,
            detail: { id: 'collect', position: { x: move, y: move * 2 } },
          }),
        )
        await tick()
      }
      await vi.advanceTimersByTimeAsync(500)
      expect(metrics.snapshot()).toEqual({
        parseRequests: 0,
        validationPasses: 0,
        layouts: 0,
        yamlTransactions: 0,
        nativeCalls: 0,
        gitCalls: 0,
        pointerMoves: 1_000,
        dragCompletions: 0,
        layoutSaves: 0,
      })
      expect(client.requests).toHaveLength(0)
      expect(hashing).not.toHaveBeenCalled()
      expect(resolving).not.toHaveBeenCalled()
      expect(onLayoutChange).not.toHaveBeenCalled()
      expect(onPersistLayout).not.toHaveBeenCalled()
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', {
          bubbles: true,
          detail: { id: 'collect', position: { x: 1_000, y: 2_000 } },
        }),
      )
      await vi.advanceTimersByTimeAsync(300)
      expect(onPersistLayout).toHaveBeenCalledOnce()
      expect(onPersistLayout.mock.calls[0]![0].routing).toBeUndefined()
      expect(onPersistLayout.mock.calls[0]![0].nodePositions.collect).toEqual({ x: 1_000, y: 2_000 })
    } finally {
      rendered.unmount()
      measurements.restore()
      restoreMetrics()
      hashing.mockRestore()
      resolving.mockRestore()
    }
  })

  it.each(['dimensions', 'invalid dimensions', 'engine', 'sanitizer', 'fingerprint'])(
    '[RG7] removes the whole cache after %s mismatch',
    async (change) => {
      const sizes = { collect: { width: 240, height: 104 }, review: { width: 240, height: 168 } }
      const measurements = canvasMeasurements(sizes)
      const routing = await savedRouting()
      if (change === 'engine') (routing as { engine: string }).engine = 'old-engine'
      if (change === 'sanitizer') (routing.routes['dependency:collect->review']!.points[0] as { x: number }).x = NaN
      if (change === 'fingerprint') (routing as { fingerprint: string }).fingerprint = `sha256:${'a'.repeat(64)}`
      const onLayoutChange = vi.fn(),
        onPersistLayout = vi.fn()
      const rendered = renderCanvas({ projection, layout: { ...layout, routing }, onLayoutChange, onPersistLayout })
      try {
        await measurements.publish()
        if (change === 'dimensions' || change === 'invalid dimensions') {
          await waitFor(() =>
            expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
          )
          sizes.review.height = change === 'invalid dimensions' ? 100 : 180
          await measurements.publish()
        }
        await waitFor(() =>
          expect(onLayoutChange).toHaveBeenCalledWith(
            expect.objectContaining({ routing: undefined }),
            expect.any(String),
          ),
        )
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).not.toBe('M 240 40 L 320 40')
        await rendered.component.flushPersistence()
        expect(onPersistLayout.mock.calls.at(-1)![0].routing).toBeUndefined()
        expect(onPersistLayout.mock.calls.at(-1)![0].nodePositions).toEqual(layout.nodePositions)
      } finally {
        rendered.unmount()
        measurements.restore()
      }
    },
  )

  it('[RG6] keeps a cloned stale routing echo invalidated after a drag with unchanged positions', async () => {
    const measurements = canvasMeasurements()
    const routing = await savedRouting()
    const props = { commandSurface: commandRegistry, projection, layout: { ...layout, routing } }
    const rendered = renderCanvas(props)
    try {
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      const canvas = screen.getByTestId('workflow-canvas')
      await fireEvent(canvas, new CustomEvent('workflowdragstart'))
      await rendered.rerender({ ...props, layout: structuredClone(props.layout) })
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', { detail: { id: 'collect', position: { x: 0, y: 0 } } }),
      )
      await measurements.publish()
      const resolver = vi.spyOn(routedLayout, 'resolveCurrentRouting')
      try {
        await rendered.rerender({ ...props, layout: structuredClone(props.layout) })
        await tick()
        expect(resolver).not.toHaveBeenCalled()
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).not.toBe('M 240 40 L 320 40')
      } finally {
        resolver.mockRestore()
      }
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('[RG6] keeps a delayed drag-start layout echo from resetting live pointer positions', async () => {
    const measurements = canvasMeasurements()
    const routing = await savedRouting()
    const props = { commandSurface: commandRegistry, projection, layout: { ...layout, routing } }
    const rendered = renderCanvas(props)
    try {
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      const canvas = screen.getByTestId('workflow-canvas')
      await fireEvent(canvas, new CustomEvent('workflowdragstart'))
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragmove', { detail: { id: 'collect', position: { x: 60, y: 80 } } }),
      )
      await rendered.rerender({ ...props, layout: { ...layout } })
      expect($canvasPositions.get().collect).toEqual({ x: 60, y: 80 })
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it.each(['workflow', 'generation', 'scope', 'positions', 'cache removal', 'drag', 'destroy'])(
    '[RG8] discards cache activation superseded by %s',
    async (replacement) => {
      const measurements = canvasMeasurements()
      const routing = await savedRouting()
      let release!: (routing: ScopeRoutingV1) => void
      const resolving = vi.spyOn(routedLayout, 'resolveCurrentRouting').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      const onLayoutChange = vi.fn(),
        onPersistLayout = vi.fn()
      const props = {
        commandSurface: commandRegistry,
        projection,
        workflowIdentity: 'active',
        pairGeneration: 1,
        layout: { ...layout, routing },
        onLayoutChange,
        onPersistLayout,
      }
      const rendered = renderCanvas(props)
      try {
        await measurements.publish()
        await waitFor(() => expect(resolving).toHaveBeenCalledOnce())
        if (replacement === 'destroy') rendered.unmount()
        else if (replacement === 'drag')
          await fireEvent(screen.getByTestId('workflow-canvas'), new CustomEvent('workflowdragstart'))
        else
          await rendered.rerender({
            ...props,
            layout: {
              ...layout,
              ...(replacement === 'positions'
                ? { nodePositions: { ...layout.nodePositions, collect: { x: 50, y: 50 } } }
                : {}),
            },
            ...(replacement === 'workflow' ? { workflowIdentity: 'other' } : {}),
            ...(replacement === 'generation' ? { pairGeneration: 2 } : {}),
            ...(replacement === 'scope'
              ? { projection: { ...projection, scope: { ...projection.scope, key: 'loop-group:other' } } }
              : {}),
          } as never)
        const before = $canvasPositions.get()
        onLayoutChange.mockClear()
        release(routing)
        await tick()
        await Promise.resolve()
        await tick()
        expect($canvasPositions.get()).toBe(before)
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).not.toBe('M 240 40 L 320 40')
        expect(onLayoutChange).not.toHaveBeenCalled()
        expect(onPersistLayout).not.toHaveBeenCalled()
      } finally {
        if (replacement !== 'destroy') rendered.unmount()
        measurements.restore()
        resolving.mockRestore()
      }
    },
  )

  it('[RG7] preserves matching routes across content, selection, viewport, panels and navigation', async () => {
    const measurements = canvasMeasurements()
    const routing = await savedRouting()
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    const props = {
      commandSurface: commandRegistry,
      projection,
      layout: { ...layout, routing },
      onLayoutChange,
      onPersistLayout,
    }
    const rendered = renderCanvas(props)
    try {
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      const edited = { ...projection, nodes: projection.nodes.map((node) => ({ ...node, value: 'Updated content' })) }
      await rendered.rerender({
        ...props,
        projection: edited,
        layout: {
          ...props.layout,
          selectedNodeIds: ['review'],
          focusTarget: { nodeId: 'review' },
          viewport: { x: 20, y: 40, zoom: 0.8 },
          inspector: { tab: 'Advanced', scrollTop: 20 },
          auxiliaryTab: 'yaml',
        },
      } as never)
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      await rendered.rerender({ ...props, projection: edited, surfaceActive: false })
      await rendered.rerender({ ...props, projection: edited, surfaceActive: true })
      await measurements.publish()
      await waitFor(() =>
        expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 240 40 L 320 40'),
      )
      expect(onLayoutChange).not.toHaveBeenCalled()
      expect(onPersistLayout).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('[RG11] restores independently arranged root and two body scopes without new worker work', async () => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const scopes = ['root', 'loop-group:first', 'loop-group:second'] as const
    const graphs = scopes.map((key) => ({ ...projection, scope: { ...projection.scope, key } }))
    const saved = new Map<string, ScopeLayoutV1>()
    const paths = new Map<string, string | null>()
    const onLayoutChange = (next: Partial<ScopeLayoutV1>, identity: string) =>
      saved.set(identity, { ...(saved.get(identity) ?? layout), ...next })
    const props = {
      commandSurface: commandRegistry,
      projection,
      workflowIdentity: 'root',
      layout,
      layoutClient: client,
      onLayoutChange,
    }
    const rendered = renderCanvas(props)
    try {
      for (const graph of graphs) {
        await rendered.rerender({ ...props, projection: graph, workflowIdentity: graph.scope.key })
        await measurements.publish()
        const arranging = rendered.component.arrange()
        await waitFor(() => expect(client.requests.at(-1)?.identity.scopeKey).toBe(graph.scope.key))
        client.resolve(successfulArrangement(client.requests.at(-1)!))
        await arranging
        await rendered.component.flushPersistence()
        paths.set(graph.scope.key, rendered.container.querySelector('.workflow-edge')!.getAttribute('d'))
      }
      for (const graph of [graphs[0]!, graphs[2]!, graphs[1]!, graphs[0]!]) {
        await rendered.rerender({
          ...props,
          projection: graph,
          workflowIdentity: graph.scope.key,
          layout: saved.get(graph.scope.key)!,
        })
        await measurements.publish()
        await waitFor(() =>
          expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe(
            paths.get(graph.scope.key),
          ),
        )
      }
      expect(client.requests).toHaveLength(3)
      expect(new Set([...saved.values()].map(({ routing }) => routing?.fingerprint)).size).toBe(3)
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('RG5 RG8 waits for a rendered frame, posts exact measurements once, and publishes routes and positions together', async () => {
    const measurements = canvasMeasurements()
    const metrics = createEditorMetricsCollector()
    const restoreMetrics = installEditorMetrics(metrics)
    const client = new DeferredLayoutClient()
    const onLayoutChange = vi.fn()
    const onPersistLayout = vi.fn()
    const onArrangeBusyChange = vi.fn()
    setCanvasSelection(['review'])
    const rendered = renderCanvas({
      projection,
      layout,
      layoutClient: client,
      workflowIdentity: 'active',
      pairGeneration: 7,
      onLayoutChange,
      onPersistLayout,
      onArrangeBusyChange,
    })
    try {
      await measurements.publish()
      const focus = screen.getByRole('button', { name: 'More canvas actions' })
      focus.focus()
      const before = $canvasPositions.get()
      const arranging = rendered.component.arrange()
      expect(client.requests).toHaveLength(0)
      await tick()
      expect(screen.getByText('Arranging graph…')).toHaveAttribute('aria-live', 'polite')
      expect(screen.getByTestId('workflow-canvas')).toHaveAttribute('aria-busy', 'true')
      expect($canvasPositions.get()).toEqual(before)
      expect(focus).toHaveFocus()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      const request = client.requests[0]!
      expect(request.nodes).toEqual([
        { id: 'collect', order: 0, width: 240, height: 104 },
        { id: 'review', order: 1, width: 240, height: 168 },
      ])
      expect(request.edges).toEqual([{ ...projection.edges[0], order: 0 }])
      expect(request.identity).toMatchObject({
        workflowIdentity: 'active',
        pairGeneration: 7,
        scopeKey: 'root',
        graphFingerprint: await graphFingerprint({
          engine: ROUTING_ENGINE,
          scopeKey: 'root',
          nodes: request.nodes,
          edges: request.edges,
        }),
      })
      expect(Object.isFrozen(request)).toBe(true)
      expect(Object.isFrozen(request.nodes[0])).toBe(true)
      expect(metrics.snapshot().layouts).toBe(1)
      const success = successfulArrangement(request)
      onLayoutChange.mockClear()
      client.resolve(success)
      await arranging
      await tick()
      expect($canvasPositions.get()).toEqual(success.positions)
      expect($canvasSelection.get()).toEqual(['review'])
      expect(onLayoutChange).toHaveBeenCalledTimes(2)
      expect(Object.keys(onLayoutChange.mock.calls[1]![0])).toEqual(['viewport'])
      expect(onLayoutChange.mock.calls[0]![0]).toMatchObject({
        nodePositions: success.positions,
        routing: {
          schemaVersion: 1,
          engine: ROUTING_ENGINE,
          routes: success.routes,
          fingerprint: await routingFingerprint({
            graphFingerprint: request.identity.graphFingerprint,
            positions: success.positions,
          }),
        },
      })
      expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe('M 272 84 L 432 84')
      expect(screen.getByText('Graph arranged: 2 nodes and 1 dependencies.')).toBeVisible()
      expect(focus).toHaveFocus()
      expect(onArrangeBusyChange.mock.calls).toEqual([
        [true, 'active'],
        [false, 'active'],
      ])
      await rendered.component.flushPersistence()
      expect(onPersistLayout).toHaveBeenCalledTimes(1)
      expect(onPersistLayout.mock.calls[0]![0].routing).toEqual(onLayoutChange.mock.calls[0]![0].routing)
    } finally {
      rendered.unmount()
      measurements.restore()
      restoreMetrics()
    }
  })

  it.each([
    undefined,
    { width: 215, height: 104 },
    { width: 216, height: 103 },
    { width: NaN, height: 104 },
    { width: 216, height: Infinity },
  ])('RG8 preserves layout without a request when a node measurement is invalid: %j', async (size) => {
    const measurements = canvasMeasurements({
      collect: size ?? { width: 240, height: 104 },
      review: { width: 240, height: 104 },
    })
    const client = new DeferredLayoutClient()
    const metrics = createEditorMetricsCollector()
    const restoreMetrics = installEditorMetrics(metrics)
    const onLayoutChange = vi.fn()
    const rendered = renderCanvas({ projection, layout, layoutClient: client, onLayoutChange })
    try {
      if (size) await measurements.publish()
      const before = $canvasPositions.get()
      await rendered.component.arrange()
      expect(client.requests).toHaveLength(0)
      expect(metrics.snapshot().layouts).toBe(0)
      expect($canvasPositions.get()).toEqual(before)
      expect(onLayoutChange).not.toHaveBeenCalled()
      expect(screen.getByText(arrangeFailure)).toBeVisible()
    } finally {
      rendered.unmount()
      measurements.restore()
      restoreMetrics()
    }
  })

  it('locks topology and dragging while keeping zoom, selection, and Cancel available during rapid Arrange attempts', async () => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const onRequestAdd = vi.fn(),
      onRequestDelete = vi.fn(),
      onConnect = vi.fn(),
      onDisconnect = vi.fn(),
      onDropNodeKind = vi.fn()
    const rendered = renderCanvas({
      projection,
      layout,
      layoutClient: client,
      onRequestAdd,
      onRequestDelete,
      onConnect,
      onDisconnect,
      onDropNodeKind,
    })
    try {
      await measurements.publish()
      const first = rendered.component.arrange()
      const second = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
      expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Add Node' })).toBeDisabled()
      expect(screen.getByRole('menuitem', { name: 'Zoom In' })).toBeEnabled()
      expect(rendered.container.querySelector('.svelte-flow__node')).not.toHaveClass('draggable')
      const before = $canvasPositions.get()
      const canvas = screen.getByTestId('workflow-canvas')
      for (const type of ['workflowdragmove', 'workflowdragstop'])
        await fireEvent(canvas, new CustomEvent(type, { detail: { id: 'collect', position: { x: 999, y: 999 } } }))
      for (const type of ['workflowconnect', 'workflowdisconnect'])
        await fireEvent(canvas, new CustomEvent(type, { detail: { source: 'collect', target: 'review' } }))
      await fireEvent(
        canvas,
        new CustomEvent('workflowbeforedelete', { detail: { nodes: [{ id: 'collect' }], edges: [] } }),
      )
      rendered.component.requestAdd()
      rendered.component.selectAll()
      rendered.component.nudge(false, 'right')
      expect($canvasSelection.get()).toEqual(['collect', 'review'])
      expect($canvasPositions.get()).toEqual(before)
      for (const callback of [onRequestAdd, onRequestDelete, onConnect, onDisconnect, onDropNodeKind])
        expect(callback).not.toHaveBeenCalled()
      expect(rendered.component.cancel()).toBe(true)
      await Promise.all([first, second])
      expect(client.cancel).toHaveBeenCalledOnce()
      expect($canvasSelection.get()).toEqual(['collect', 'review'])
      expect($canvasPositions.get()).toEqual(before)
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it.each([
    'rejection',
    'worker-error',
    'malformed-routes',
    'mismatched-identity',
    'invalid-bounds',
    'inconsistent-bounds',
  ])('RG8 preserves the complete current layout and reports safe copy for %s', async (failure) => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    setCanvasSelection(['review'])
    const rendered = renderCanvas({ projection, layout, layoutClient: client, onLayoutChange, onPersistLayout })
    try {
      await measurements.publish()
      const before = $canvasPositions.get()
      const path = rendered.container.querySelector('.workflow-edge')?.getAttribute('d')
      const viewport = rendered.container.querySelector('.svelte-flow__viewport')?.getAttribute('style')
      const arranging = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      const result = successfulArrangement(client.requests[0]!)
      if (failure === 'rejection') client.reject(new Error('PRIVATE WORKER DETAILS'))
      else if (failure === 'worker-error')
        client.resolve({
          type: 'layout-error',
          identity: result.identity,
          code: 'worker_timeout',
          message: 'PRIVATE WORKER DETAILS',
        })
      else
        client.resolve(
          failure === 'malformed-routes'
            ? { ...result, routes: {} }
            : failure === 'mismatched-identity'
              ? { ...result, identity: { ...result.identity, pairGeneration: 99 } }
              : { ...result, bounds: { ...result.bounds, width: failure === 'inconsistent-bounds' ? 1 : NaN } },
        )
      await arranging
      await tick()
      expect($canvasPositions.get()).toEqual(before)
      expect($canvasSelection.get()).toEqual(['review'])
      expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe(path)
      expect(rendered.container.querySelector('.svelte-flow__viewport')?.getAttribute('style')).toBe(viewport)
      expect(onLayoutChange).not.toHaveBeenCalled()
      await rendered.component.flushPersistence()
      expect(onPersistLayout).not.toHaveBeenCalled()
      expect(screen.getByText(arrangeFailure)).toBeVisible()
      expect(screen.queryByText('PRIVATE WORKER DETAILS')).not.toBeInTheDocument()
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it.each(['projection', 'workflow', 'generation', 'scope', 'layout', 'destroy'])(
    'RG8 rejects a success made obsolete by %s replacement',
    async (replacement) => {
      const measurements = canvasMeasurements()
      const client = new DeferredLayoutClient()
      const onLayoutChange = vi.fn(),
        onPersistLayout = vi.fn()
      const props = {
        commandSurface: commandRegistry,
        projection,
        layout,
        layoutClient: client,
        workflowIdentity: 'active',
        pairGeneration: 1,
        onLayoutChange,
        onPersistLayout,
      }
      const rendered = renderCanvas(props)
      try {
        await measurements.publish()
        const arranging = rendered.component.arrange()
        await waitFor(() => expect(client.requests).toHaveLength(1))
        const success = successfulArrangement(client.requests[0]!)
        if (replacement === 'destroy') rendered.unmount()
        else
          await rendered.rerender({
            ...props,
            ...(replacement === 'projection' ? { projection: { ...projection } } : {}),
            ...(replacement === 'workflow' ? { workflowIdentity: 'replacement' } : {}),
            ...(replacement === 'generation' ? { pairGeneration: 2 } : {}),
            ...(replacement === 'scope'
              ? { projection: { ...projection, scope: { ...projection.scope, key: 'loop-group:repeat' } } }
              : {}),
            ...(replacement === 'layout'
              ? { layout: { ...layout, nodePositions: { ...layout.nodePositions, collect: { x: 11, y: 22 } } } }
              : {}),
          } as never)
        const positionsAfterReplacement = $canvasPositions.get()
        client.resolve(success)
        await arranging
        await tick()
        expect($canvasPositions.get()).toEqual(positionsAfterReplacement)
        expect(onLayoutChange).not.toHaveBeenCalled()
        expect(onPersistLayout).not.toHaveBeenCalled()
        if (replacement === 'destroy') expect(client.destroy).toHaveBeenCalledOnce()
        else expect(screen.getByTestId('workflow-canvas')).toHaveAttribute('aria-busy', 'false')
      } finally {
        if (replacement !== 'destroy') rendered.unmount()
        measurements.restore()
      }
    },
  )

  it.each(['request', 'result'])('RG8 rechecks identity after the %s fingerprint await', async (boundary) => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const original = boundary === 'request' ? graphFingerprint : routingFingerprint
    let finish!: (fingerprint: `sha256:${string}`) => void
    const hashing = vi
      .spyOn(routedLayout, boundary === 'request' ? 'graphFingerprint' : 'routingFingerprint')
      .mockImplementation(
        () =>
          new Promise<`sha256:${string}`>((resolve) => {
            finish = resolve
          }),
      )
    const onLayoutChange = vi.fn()
    const props = {
      commandSurface: commandRegistry,
      projection,
      layout,
      layoutClient: client,
      onLayoutChange,
      pairGeneration: 1,
    }
    const rendered = renderCanvas(props)
    try {
      await measurements.publish()
      const arranging = rendered.component.arrange()
      if (boundary === 'result') {
        await waitFor(() => expect(client.requests).toHaveLength(1))
        client.resolve(successfulArrangement(client.requests[0]!))
      }
      await waitFor(() => expect(hashing).toHaveBeenCalledOnce())
      await rendered.rerender({ ...props, pairGeneration: 2 })
      finish(await original(hashing.mock.calls[0]![0] as never))
      await arranging
      expect($canvasPositions.get()).toEqual(layout.nodePositions)
      expect(onLayoutChange).not.toHaveBeenCalled()
      expect(client.requests).toHaveLength(boundary === 'request' ? 0 : 1)
    } finally {
      rendered.unmount()
      hashing.mockRestore()
      measurements.restore()
    }
  })

  it('keeps a newer Arrange busy when an obsolete request finally settles', async () => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    client.cancel.mockImplementation(() => undefined)
    const onArrangeBusyChange = vi.fn()
    const props = {
      commandSurface: commandRegistry,
      projection,
      layout,
      layoutClient: client,
      onArrangeBusyChange,
      pairGeneration: 1,
      workflowIdentity: 'first',
    }
    const rendered = renderCanvas(props)
    try {
      await measurements.publish()
      const first = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      const oldResolve = client.resolve
      await rendered.rerender({ ...props, workflowIdentity: 'second', pairGeneration: 2 })
      await measurements.publish()
      const second = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(2))
      oldResolve(successfulArrangement(client.requests[0]!))
      await first
      expect(screen.getByTestId('workflow-canvas')).toHaveAttribute('aria-busy', 'true')
      expect(onArrangeBusyChange.mock.calls).toEqual([
        [true, 'first'],
        [false, 'first'],
        [true, 'second'],
      ])
      client.resolve(successfulArrangement(client.requests[1]!))
      await second
      expect(onArrangeBusyChange.mock.calls.at(-1)).toEqual([false, 'second'])
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('RG8 retains already arranged routes, selection, and viewport after a later failure', async () => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const onLayoutChange = vi.fn(),
      onPersistLayout = vi.fn()
    const rendered = renderCanvas({ projection, layout, layoutClient: client, onLayoutChange, onPersistLayout })
    try {
      await measurements.publish()
      const first = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      client.resolve(successfulArrangement(client.requests[0]!))
      await first
      await rendered.component.flushPersistence()
      const path = rendered.container.querySelector('.workflow-edge')?.getAttribute('d')
      const viewport = rendered.container.querySelector('.svelte-flow__viewport')?.getAttribute('style')
      const positions = $canvasPositions.get()
      onLayoutChange.mockClear()
      onPersistLayout.mockClear()
      const second = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(2))
      client.reject(new Error('private details'))
      await second
      expect(rendered.container.querySelector('.workflow-edge')?.getAttribute('d')).toBe(path)
      expect(rendered.container.querySelector('.svelte-flow__viewport')?.getAttribute('style')).toBe(viewport)
      expect($canvasPositions.get()).toEqual(positions)
      expect(onLayoutChange).not.toHaveBeenCalled()
      await rendered.component.flushPersistence()
      expect(onPersistLayout).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('[RG8] [RG12] cancels a partial capacity measurement without posting or persisting layout', async () => {
    const fixture = createLargeWorkflowFixture()
    const measurements = canvasMeasurements(
      Object.fromEntries(fixture.projection.nodes.map(({ id }) => [id, { width: 216, height: 104 }])),
    )
    const client = { arrange: vi.fn(), cancel: vi.fn(), destroy: vi.fn() }
    const publish = vi.fn(),
      persist = vi.fn()
    const rendered = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: fixture.projection,
      layout: { ...fixture.layout, viewport: { x: 0, y: 0, zoom: 1 } },
      layoutClient: client,
      onLayoutChange: publish,
      onPersistLayout: persist,
    })
    await measurements.publish()
    const before = rendered.container.querySelectorAll('.svelte-flow__node').length
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(321)
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    try {
      const arranging = rendered.component.arrange()
      await tick()
      const during = rendered.container.querySelectorAll('.svelte-flow__node').length
      expect(during).toBeGreaterThan(before)
      expect(during).toBeLessThanOrEqual(before + 40)
      expect(during).toBeLessThan(250)
      expect(client.arrange).not.toHaveBeenCalled()
      await waitFor(() => expect(frame).toHaveBeenCalled())
      rendered.unmount()
      await arranging
      expect(cancel).toHaveBeenCalledWith(321)
      expect(client.arrange).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalled()
    } finally {
      measurements.restore()
      frame.mockRestore()
      cancel.mockRestore()
    }
  })

  it('mounts offscreen cards for the measured Arrange frame', async () => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const offscreenLayout = { ...layout, nodePositions: { collect: { x: 0, y: 0 }, review: { x: 10000, y: 10000 } } }
    const disconnectedProjection = {
      ...projection,
      nodes: projection.nodes.map((node) => ({ ...node, dependsOn: [] })),
      edges: [],
      capacity: { ...projection.capacity, edgeCount: 0 },
    }
    const rendered = renderCanvas({ projection: disconnectedProjection, layout: offscreenLayout, layoutClient: client })
    try {
      await measurements.publish()
      expect(rendered.container.querySelector('.svelte-flow__node[data-id="review"]')).not.toBeInTheDocument()
      const arranging = rendered.component.arrange()
      await tick()
      expect(rendered.container.querySelector('.svelte-flow__node[data-id="review"]')).toBeInTheDocument()
      await measurements.publish()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      client.resolve(successfulArrangement(client.requests[0]!))
      await arranging
      expect(screen.getByText('Graph arranged: 2 nodes and 0 dependencies.')).toBeVisible()
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it('cancels the measurement frame and settles Arrange when destroyed before posting', async () => {
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123)
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const client = new DeferredLayoutClient()
    const rendered = renderCanvas({ projection, layout, layoutClient: client })
    try {
      await tick()
      const arranging = rendered.component.arrange()
      await tick()
      await waitFor(() => expect(frame).toHaveBeenCalled())
      rendered.unmount()
      expect(cancelFrame).toHaveBeenCalledWith(123)
      await arranging
      expect(client.requests).toHaveLength(0)
    } finally {
      frame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it('announces safe failure when a live position revision supersedes the pending response', async () => {
    const measurements = canvasMeasurements()
    const client = new DeferredLayoutClient()
    const rendered = renderCanvas({ projection, layout, layoutClient: client })
    try {
      await measurements.publish()
      const arranging = rendered.component.arrange()
      await waitFor(() => expect(client.requests).toHaveLength(1))
      const replacement = { ...layout.nodePositions, collect: { x: 55, y: 55 } }
      $canvasPositions.set(replacement)
      client.resolve(successfulArrangement(client.requests[0]!))
      await arranging
      expect($canvasPositions.get()).toBe(replacement)
      expect(screen.getByText(arrangeFailure)).toBeVisible()
      expect(screen.queryByText('Arranging graph…')).not.toBeInTheDocument()
    } finally {
      rendered.unmount()
      measurements.restore()
    }
  })

  it.each(['after fit', 'during publication'])(
    'persists the fitted viewport in one complete scope and restores that camera on reopen when flushed %s',
    async (flushTiming) => {
      const measurements = canvasMeasurements()
      const client = new DeferredLayoutClient()
      const onPersistLayout = vi.fn()
      let earlyFlush: Promise<void> | undefined
      const rendered = renderCanvas({
        projection,
        layout,
        layoutClient: client,
        onPersistLayout,
        onLayoutChange: (next: Partial<ScopeLayoutV1>) => {
          if (next.nodePositions && flushTiming === 'during publication')
            earlyFlush = rendered.component.flushPersistence()
        },
      })
      let reopened: ReturnType<typeof renderCanvas> | undefined
      try {
        await measurements.publish()
        const before = rendered.container.querySelector('.svelte-flow__viewport')!.getAttribute('style')
        const arranging = rendered.component.arrange()
        await waitFor(() => expect(client.requests).toHaveLength(1))
        client.resolve(successfulArrangement(client.requests[0]!))
        await arranging
        await tick()
        const fitted = rendered.container.querySelector('.svelte-flow__viewport')!.getAttribute('style')
        expect(fitted).not.toBe(before)
        await earlyFlush
        await rendered.component.flushPersistence()
        await rendered.component.flushPersistence()
        expect(onPersistLayout).toHaveBeenCalledTimes(1)
        const persisted = onPersistLayout.mock.calls[0]![0] as ScopeLayoutV1
        expect(persisted.viewport).not.toEqual(layout.viewport)
        expect(persisted.routing).toBeDefined()
        rendered.unmount()
        reopened = renderCanvas({ projection, layout: persisted })
        await tick()
        expect(reopened.container.querySelector('.svelte-flow__viewport')!.getAttribute('style')).toBe(fitted)
      } finally {
        reopened?.unmount()
        rendered.unmount()
        measurements.restore()
      }
    },
  )

  it.each(['immediate', 'queued'])(
    'discards obsolete fitting and persists replacement positions without routing after the %s publication callback',
    async (timing) => {
      const measurements = canvasMeasurements()
      const client = new DeferredLayoutClient()
      const replacement = { collect: { x: 90, y: 90 }, review: { x: 590, y: 90 } }
      const onPersistLayout = vi.fn()
      const onLayoutChange = vi.fn((next: Partial<ScopeLayoutV1>) => {
        if (!next.nodePositions) return
        const supersede = () => {
          $canvasPositions.set(replacement)
          rendered.component.actualSize()
        }
        if (timing === 'immediate') supersede()
        else void tick().then(() => queueMicrotask(() => queueMicrotask(supersede)))
      })
      const rendered = renderCanvas({ projection, layout, layoutClient: client, onLayoutChange, onPersistLayout })
      try {
        await measurements.publish()
        const before = rendered.container.querySelector('.svelte-flow__viewport')!.getAttribute('style')
        const arranging = rendered.component.arrange()
        await waitFor(() => expect(client.requests).toHaveLength(1))
        client.resolve(successfulArrangement(client.requests[0]!))
        await arranging
        await tick()
        expect($canvasPositions.get()).toBe(replacement)
        const camera = rendered.container.querySelector('.svelte-flow__viewport')!.getAttribute('style')
        if (timing === 'immediate') expect(camera).toBe(before)
        expect(camera).toContain('scale(1)')
        expect(onLayoutChange).toHaveBeenCalledTimes(2)
        expect(onLayoutChange.mock.calls[1]![0]).toMatchObject({ nodePositions: replacement, routing: undefined })
        expect(screen.queryByText('Arranging graph…')).not.toBeInTheDocument()
        expect(screen.getByText(arrangeFailure)).toBeVisible()
        await rendered.component.flushPersistence()
        expect(onPersistLayout).toHaveBeenCalledOnce()
        expect(onPersistLayout.mock.calls[0]![0]).toMatchObject({ nodePositions: replacement })
        expect(onPersistLayout.mock.calls[0]![0].routing).toBeUndefined()
      } finally {
        rendered.unmount()
        measurements.restore()
      }
    },
  )

  it('opens node actions without replacing an existing multi-selection and selects an unselected target', async () => {
    setCanvasSelection(['collect', 'review'])
    const { container } = renderCanvas({ projection, layout })
    const collect = container.querySelector<HTMLElement>('.svelte-flow__node[data-id="collect"]')!
    const review = container.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!
    await fireEvent.contextMenu(collect, { clientX: 790, clientY: 590 })
    const menu = screen.getByRole('menu', { name: 'Node actions' })
    for (const name of [
      'Open Inspector',
      'Duplicate Selection',
      'Select All Nodes',
      'Delete Selection',
      'Delete All Nodes',
    ]) {
      expect(within(menu).getByRole('menuitem', { name })).toBeVisible()
    }
    expect($canvasSelection.get()).toEqual(['collect', 'review'])
    await fireEvent.keyDown(menu, { key: 'Escape' })
    expect(collect).toHaveFocus()
    expect($canvasSelection.get()).toEqual(['collect', 'review'])
    setCanvasSelection(['collect'])
    await tick()
    await fireEvent.contextMenu(review)
    expect($canvasSelection.get()).toEqual(['review'])
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: 'Node actions' })).not.toBeInTheDocument()
  })

  it.each([{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }])(
    'opens from the focused node with $key and navigates without moving nodes',
    async (key) => {
      const onPersistLayout = vi.fn()
      const { container } = renderCanvas({ projection, layout, onPersistLayout })
      const node = container.querySelector<HTMLElement>('.svelte-flow__node[data-id="collect"]')!
      node.focus()
      await fireEvent.keyDown(node, key)
      const menu = screen.getByRole('menu', { name: 'Node actions' })
      const items = within(menu).getAllByRole('menuitem')
      expect(items[0]).toHaveFocus()
      const positions = $canvasPositions.get()
      await fireEvent.keyDown(items[0]!, { key: 'ArrowUp' })
      expect(items[4]).toHaveFocus()
      await fireEvent.keyDown(items[4]!, { key: 'Home' })
      expect(items[0]).toHaveFocus()
      await fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
      expect(items[1]).toHaveFocus()
      await fireEvent.keyDown(items[1]!, { key: 'End' })
      expect(items[4]).toHaveFocus()
      await fireEvent.keyDown(items[4]!, { key: 'Escape' })
      expect(node).toHaveFocus()
      expect($canvasPositions.get()).toEqual(positions)
      expect(onPersistLayout).not.toHaveBeenCalled()
    },
  )

  it('uses resolved command labels, enablement, and execution while skipping disabled actions', async () => {
    const registry = createCommandRegistry()
    const inspected: string[][] = []
    for (const command of listCommands())
      registry.registerCommand({
        ...command,
        ...(command.id === 'canvas.open-inspector' ? { label: 'Inspect selected nodes', enabled: () => false } : {}),
        ...(command.id === 'canvas.duplicate-selection'
          ? {
              label: 'Clone selected nodes',
              run: () => {
                inspected.push([...$canvasSelection.get()])
              },
            }
          : {}),
      })
    const { container } = renderCanvas({ projection, layout, commandSurface: registry })
    await fireEvent.contextMenu(container.querySelector('.svelte-flow__node[data-id="collect"]')!)
    const menu = screen.getByRole('menu', { name: 'Node actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Inspect selected nodes' })).toBeDisabled()
    const duplicate = within(menu).getByRole('menuitem', { name: 'Clone selected nodes' })
    expect(duplicate).toHaveFocus()
    await fireEvent.click(duplicate)
    expect(inspected).toEqual([['collect']])
    expect(screen.queryByRole('menu', { name: 'Node actions' })).not.toBeInTheDocument()
  })

  it.each(['collect', 'review', 'all'])(
    'keeps mixed selection authoritative when node actions target %s',
    async (targetId) => {
      const previousObserver = globalThis.ResizeObserver
      const previousMatrix = window.DOMMatrixReadOnly
      const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = []
      const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
      const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
      vi.stubGlobal(
        'DOMMatrixReadOnly',
        class {
          m22 = 1
        },
      )
      vi.stubGlobal(
        'ResizeObserver',
        class {
          targets: Element[] = []
          constructor(callback: ResizeObserverCallback) {
            observers.push({ callback, targets: this.targets })
          }
          observe(target: Element): void {
            this.targets.push(target)
          }
          unobserve(): void {}
          disconnect(): void {}
        },
      )
      try {
        const registry = createCommandRegistry()
        const deleted: string[][] = []
        for (const command of listCommands())
          registry.registerCommand({
            ...command,
            ...(command.id === 'canvas.delete-selection'
              ? {
                  run: (context) => {
                    expect(context).toMatchObject({ hasSelection: true, selectionCount: targetId === 'all' ? 2 : 1 })
                    deleted.push([...$canvasSelection.get()])
                  },
                }
              : {}),
          })
        setCanvasSelection(['collect'])
        const rendered = renderCanvas({ projection, layout, commandSurface: registry })
        await tick()
        for (const observer of observers) {
          observer.callback(
            observer.targets.map((target) => ({
              target,
              contentRect: new DOMRect(0, 0, 240, 100),
              contentBoxSize: [{ inlineSize: 240, blockSize: 100 }],
              borderBoxSize: [{ inlineSize: 240, blockSize: 100 }],
              devicePixelContentBoxSize: [{ inlineSize: 240, blockSize: 100 }],
            })),
            {} as ResizeObserver,
          )
        }
        await tick()
        const edge = rendered.container.querySelector<SVGGElement>('.svelte-flow__edge')!
        expect(edge).toBeInTheDocument()
        await fireEvent.keyDown(window, { key: 'Meta', metaKey: true })
        await fireEvent.keyDown(edge, { key: ' ', metaKey: true })
        await fireEvent.keyUp(window, { key: 'Meta' })
        expect(edge.querySelector('path.workflow-edge')).toHaveClass('selected')
        expect($canvasSelection.get()).toEqual(['collect'])
        const target = rendered.container.querySelector<HTMLElement>(
          `.svelte-flow__node[data-id="${targetId === 'all' ? 'collect' : targetId}"]`,
        )!
        await fireEvent.contextMenu(target)
        if (targetId === 'all') await fireEvent.click(screen.getByRole('menuitem', { name: 'Select All Nodes' }))
        await tick()
        const expectedIds = targetId === 'all' ? ['collect', 'review'] : [targetId]
        expect($canvasSelection.get()).toEqual(expectedIds)
        expect(target).toHaveClass('selected')
        if (targetId !== 'collect') expect(edge.querySelector('path.workflow-edge')).not.toHaveClass('selected')
        else expect(edge.querySelector('path.workflow-edge')).toHaveClass('selected')
        if (targetId === 'all') await fireEvent.contextMenu(target)
        await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Selection' }))
        expect(deleted).toEqual([expectedIds])
        rendered.unmount()
      } finally {
        width.mockRestore()
        height.mockRestore()
        vi.stubGlobal('ResizeObserver', previousObserver)
        vi.stubGlobal('DOMMatrixReadOnly', previousMatrix)
      }
    },
  )

  it('omits commands absent from the provided surface and keeps Delete All disabled', async () => {
    const { container } = renderCanvas({ projection, layout, commandSurface: createCommandRegistry() })
    await fireEvent.contextMenu(container.querySelector('.svelte-flow__node[data-id="collect"]')!)
    const menu = screen.getByRole('menu', { name: 'Node actions' })
    expect(within(menu).queryByRole('menuitem', { name: 'Open Inspector' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Select All Nodes' })).toHaveFocus()
    expect(within(menu).getByRole('menuitem', { name: 'Delete All Nodes' })).toBeDisabled()
  })

  it('selects and requests deletion of all current-scope nodes through the existing delete primitive', async () => {
    const onRequestDelete = vi.fn()
    const { container } = renderCanvas({ projection, layout, onRequestDelete })
    const node = container.querySelector('.svelte-flow__node[data-id="collect"]')!
    await fireEvent.contextMenu(node)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Select All Nodes' }))
    expect($canvasSelection.get()).toEqual(['collect', 'review'])
    await fireEvent.contextMenu(node)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete All Nodes' }))
    expect(onRequestDelete).toHaveBeenCalledWith(['collect', 'review'])
  })

  it.each([
    { repairMode: true, stale: true, readOnly: false, deletable: true },
    { repairMode: false, stale: true, readOnly: false, deletable: false },
    { repairMode: true, stale: true, readOnly: true, deletable: false },
  ])('keeps repair deletion narrow for $repairMode/$readOnly', async ({ deletable, ...props }) => {
    const { container } = renderCanvas({ projection, layout, ...props })
    await fireEvent.contextMenu(container.querySelector('.svelte-flow__node[data-id="collect"]')!)
    const menu = screen.getByRole('menu', { name: 'Node actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Duplicate Selection' })).toBeDisabled()
    for (const name of ['Delete Selection', 'Delete All Nodes']) {
      expect(within(menu).getByRole('menuitem', { name }).matches(':disabled')).toBe(!deletable)
    }
    expect(within(menu).getByRole('menuitem', { name: 'Open Inspector' })).toBeEnabled()
  })

  it('closes node actions when a scope transition starts', async () => {
    const rendered = renderCanvas({ projection, layout })
    await fireEvent.contextMenu(rendered.container.querySelector('.svelte-flow__node[data-id="collect"]')!)
    expect(screen.getByRole('menu', { name: 'Node actions' })).toBeVisible()
    await rendered.rerender({ commandSurface: commandRegistry, projection, layout, transitionLocked: true })
    expect(screen.queryByRole('menu', { name: 'Node actions' })).not.toBeInTheDocument()
  })

  it('opens a compound loop group from its button, double-click, and focused-node Enter only', async () => {
    const onOpenLoopGroup = vi.fn()
    const groupProjection: ProjectedGraph = {
      ...projection,
      nodes: [{ ...projection.nodes[0]!, id: 'repeat', kind: 'loop_group', value: { nodes: [], max_iterations: 3 } }],
      edges: [],
      definitionOrder: ['repeat'],
      capacity: { status: 'visual', nodeCount: 1, edgeCount: 0 },
    }
    const rendered = renderCanvas({
      projection: groupProjection,
      layout: { ...layout, nodePositions: { repeat: { x: 0, y: 0 } } },
      groupSummaries: {
        repeat: {
          bodyNodeCount: 2,
          maxIterations: 3,
          primarySinkId: 'publish',
          errorCount: 1,
          requiredIssueCount: 1,
        },
      },
      onOpenLoopGroup,
    })
    const { container } = rendered
    const node = container.querySelector<HTMLElement>('.svelte-flow__node[data-id="repeat"]')!

    expect(node).toHaveAttribute(
      'aria-label',
      'loop group repeat, 2 body nodes, maximum 3 iterations, primary output publish, 1 error, 1 required issue',
    )
    expect(screen.getByRole('article', { name: /loop group repeat/i })).toBeVisible()
    expect(screen.getByText('2 body nodes')).toBeVisible()
    expect(screen.getByText('Maximum 3 iterations')).toBeVisible()
    expect(screen.getByText('Group output: publish')).toBeVisible()
    expect(screen.getByText('1 required')).toBeVisible()
    expect(screen.getByText('1 error')).toBeVisible()
    expect(container.querySelector('[data-port="input"]')).toBeInTheDocument()
    expect(container.querySelector('[data-port="output"]')).toBeInTheDocument()

    const open = screen.getByRole('button', { name: 'Open loop body' })
    await fireEvent.click(open)
    await fireEvent.dblClick(node)
    node.focus()
    await fireEvent.keyDown(node, { key: 'Enter' })
    await fireEvent.keyDown(open, { key: 'Enter' })

    expect(onOpenLoopGroup).toHaveBeenCalledTimes(3)
    expect(onOpenLoopGroup).toHaveBeenNthCalledWith(1, 'repeat', open)
    expect(onOpenLoopGroup).toHaveBeenNthCalledWith(2, 'repeat', node)
    expect(onOpenLoopGroup).toHaveBeenNthCalledWith(3, 'repeat', node)

    rendered.component.arrange()
    await tick()
    expect(screen.getByText('2 body nodes')).toBeVisible()
    expect(screen.getByText('Maximum 3 iterations')).toBeVisible()
    expect(screen.getByText('Group output: publish')).toBeVisible()
    expect(screen.getByText('1 required')).toBeVisible()
    expect(screen.getByText('1 error')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open loop body' })).toBeVisible()
    expect(container.querySelector('.svelte-flow__node[data-id="repeat"]')).toHaveAttribute(
      'aria-label',
      'loop group repeat, 2 body nodes, maximum 3 iterations, primary output publish, 1 error, 1 required issue',
    )
  })

  it('reports whether Escape ownership cancelled an edge gesture or a real selection', async () => {
    const rendered = renderCanvas({ projection, layout })
    expect(rendered.component.cancel()).toBe(false)

    setCanvasSelection(['collect'])
    await tick()
    expect(rendered.component.cancel()).toBe(true)
    expect($canvasSelection.get()).toEqual([])

    setCanvasSelection(['collect'])
    rendered.component.requestEdge()
    expect(rendered.component.cancel()).toBe(true)
    expect($canvasSelection.get()).toEqual(['collect'])
  })

  it('consumes an active edge-mode Escape before Svelte Flow can clear the selected node', async () => {
    const rendered = renderCanvas({ projection, layout })
    setCanvasSelection(['collect'])
    await tick()
    rendered.component.requestEdge()

    const flow = rendered.container.querySelector<HTMLElement>('.svelte-flow')!
    const focusedEdge = document.createElement('div')
    const flowEscapeHandler = vi.fn(() => setCanvasSelection([]))
    focusedEdge.className = 'svelte-flow__edge'
    focusedEdge.tabIndex = 0
    focusedEdge.addEventListener('keydown', flowEscapeHandler)
    flow.append(focusedEdge)
    await fireEvent.keyDown(focusedEdge, { key: 'Escape' })

    expect(screen.queryByText('Create edge from collect')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveTextContent(
      'Edge creation cancelled.',
    )
    expect(flowEscapeHandler).not.toHaveBeenCalled()
    expect($canvasSelection.get()).toEqual(['collect'])
  })

  it('keeps pointer panning enabled on the rendered flow pane', () => {
    const { container } = renderCanvas({ projection, layout })
    const flow = container.querySelector<HTMLElement>('.svelte-flow')

    expect(flow?.querySelector('.svelte-flow__pane')).toHaveClass('draggable')
  })

  it('isolates 100 drag moves to position state and persists one layout only after drag-stop debounce', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: ScopeLayoutV1) => Promise<void>>().mockResolvedValue(undefined)
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
      expect.any(String),
    )
  })

  it('applies every selected node in one drag payload, persists once, and restores both positions on reopen', async () => {
    vi.useFakeTimers()
    let persisted: ScopeLayoutV1 | undefined
    const persistLayout = vi.fn(async (next: ScopeLayoutV1) => {
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

  it('does not republish live positions for an updated-at-only persistence echo', async () => {
    const rendered = renderCanvas({ projection, layout })
    await tick()
    const publications: (typeof layout.nodePositions)[] = []
    const unsubscribe = $canvasPositions.subscribe((positions) => publications.push(positions))
    publications.length = 0

    await rendered.rerender({
      commandSurface: commandRegistry,
      projection,
      layout: { ...layout },
    })
    await tick()

    expect(publications).toEqual([])
    unsubscribe()
  })

  it('does not republish unchanged positions for an edge-only projection refresh', async () => {
    const rendered = renderCanvas({ projection, layout })
    await tick()
    const publications: (typeof layout.nodePositions)[] = []
    const unsubscribe = $canvasPositions.subscribe((positions) => publications.push(positions))
    publications.length = 0

    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: { ...projection, edges: [] },
      layout,
    })
    await tick()

    expect(publications).toEqual([])
    unsubscribe()
  })

  it('does not reset positions between consecutive bound node updates after an edge-only projection refresh', async () => {
    const rendered = renderCanvas({ projection, layout })
    const canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    setCanvasSelection(['collect'])
    await tick()
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: { ...projection, edges: [] },
      layout,
    })
    await tick()
    const publications: (typeof layout.nodePositions)[] = []
    const unsubscribe = $canvasPositions.subscribe((positions) => publications.push(positions))
    publications.length = 0

    await fireEvent(
      canvas,
      new CustomEvent('workflowdragmove', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 5, y: 0 } },
      }),
    )
    rendered.component.nudge(false, 'right')
    await tick()

    expect($canvasPositions.get().collect).toEqual({ x: 10, y: 0 })
    expect(publications).toEqual([
      { ...layout.nodePositions, collect: { x: 5, y: 0 } },
      { ...layout.nodePositions, collect: { x: 10, y: 0 } },
    ])
    unsubscribe()
  })

  it('does not re-read projection inputs for a bound selection update after an edge-only refresh', async () => {
    let positionReads = 0
    const trackedLayout = {
      ...layout,
      get nodePositions() {
        positionReads += 1
        return layout.nodePositions
      },
    }
    const rendered = renderCanvas({ projection, layout: trackedLayout })
    await tick()
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: { ...projection, edges: [] },
      layout: trackedLayout,
    })
    await tick()
    const baseline = positionReads

    await fireEvent.click(rendered.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!)
    await tick()

    expect(positionReads).toBe(baseline)
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
    const persistLayout = vi.fn<(next: ScopeLayoutV1) => Promise<void>>().mockResolvedValue(undefined)
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

  it('allows deletion alone from an incomplete repair projection', async () => {
    const onRequestDelete = vi.fn()
    const onDisconnect = vi.fn()
    const onRequestAdd = vi.fn()
    const { component, container } = renderCanvas({
      projection,
      layout,
      stale: true,
      repairMode: true,
      onRequestDelete,
      onDisconnect,
      onRequestAdd,
    })
    expect(screen.getByText(/delete incomplete nodes.*inspector/i)).toBeVisible()
    const canvas = container.querySelector('[data-testid="workflow-canvas"]')!
    await fireEvent(
      canvas,
      new CustomEvent('workflowbeforedelete', {
        detail: { nodes: [{ id: 'review' }], edges: [{ source: 'collect', target: 'review' }] },
      }),
    )
    await fireEvent(
      canvas,
      new CustomEvent('workflowbeforedelete', {
        detail: { nodes: [], edges: [{ source: 'collect', target: 'review' }] },
      }),
    )
    component.requestAdd()
    setCanvasSelection(['review'])
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menuitem', { name: 'Delete Selection' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Duplicate Selection' })).toBeDisabled()
    expect(onRequestDelete).toHaveBeenCalledExactlyOnceWith(['review'])
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(onRequestAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add Node' })).toBeDisabled()
  })

  it('allows add and palette drop on an explicit blank draft while other mutations remain paused', async () => {
    const onRequestAdd = vi.fn()
    const onDropNodeKind = vi.fn()
    const { component, container } = renderCanvas({
      projection: { ...projection, nodes: [], edges: [], definitionOrder: [] },
      layout,
      stale: true,
      blankDraft: true,
      onRequestAdd,
      onDropNodeKind,
    })
    expect(screen.getByText(/blank workflow draft.*add a node/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add Node' })).toBeEnabled()
    component.requestAdd()
    await fireEvent.drop(container.querySelector('[data-testid="workflow-canvas-viewport"]')!, {
      clientX: 100,
      clientY: 100,
      dataTransfer: { types: [NODE_KIND_DRAG_TYPE], getData: () => 'prompt' },
    })
    expect(onRequestAdd).toHaveBeenCalledOnce()
    expect(onDropNodeKind).toHaveBeenCalledOnce()
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeDisabled()
  })

  it('suppresses graph callbacks, palette drops, drag state, and layout persistence while stale', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: ScopeLayoutV1) => Promise<void>>().mockResolvedValue(undefined)
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
    const persistLayout = vi.fn<(next: ScopeLayoutV1) => Promise<void>>().mockResolvedValue(undefined)
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

  it('keeps the selected node authoritative without publishing an empty selection when projection diagnostics refresh', async () => {
    const rendered = renderCanvas({ projection, layout })
    const selectedNode = rendered.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!

    await fireEvent.click(selectedNode)
    await tick()

    expect($canvasSelection.get()).toEqual(['review'])
    expect(selectedNode).toHaveClass('selected')
    expect(screen.getByRole('button', { name: 'Create Edge' })).toBeEnabled()

    const publishedSelections: string[][] = []
    const unsubscribe = $canvasSelection.subscribe((ids) => publishedSelections.push([...ids]))

    const refreshedProjection: ProjectedGraph = {
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
    expect(publishedSelections).toEqual([['review']])
    unsubscribe()
  })

  it('clears rendered node selection together with the authoritative store', async () => {
    const rendered = renderCanvas({ projection, layout })
    const selectedNode = rendered.container.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!

    await fireEvent.click(selectedNode)
    await tick()
    expect($canvasSelection.get()).toEqual(['review'])
    expect(selectedNode).toHaveClass('selected')

    rendered.component.cancel()
    await tick()

    expect($canvasSelection.get()).toEqual([])
    expect(selectedNode).not.toHaveClass('selected')
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
    const projectionWithoutReview: ProjectedGraph = {
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
    const persistLayout = vi.fn<(next: ScopeLayoutV1) => Promise<void>>().mockResolvedValue(undefined)
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
      expect.any(String),
    )
    unmount()
    await vi.advanceTimersByTimeAsync(300)
    expect(persistLayout).toHaveBeenCalledTimes(1)
  })

  it('restores mounted same-scope viewport and scroll once for undo and redo', async () => {
    vi.useFakeTimers()
    const before: LayoutRecordV2 = {
      schemaVersion: 2,
      workspaceId: 'workspace',
      workflowPath: 'flow.yaml',
      activeScopeKey: 'root',
      editorMode: 'visual',
      panels: { left: 280, right: 320, problems: 180 },
      updatedAt: 'now',
      scopeLayouts: { root: { ...layout, viewport: { x: 12, y: 34, zoom: 0.8 }, canvasScroll: { left: 5, top: 15 } } },
    }
    const after: LayoutRecordV2 = {
      ...before,
      scopeLayouts: {
        root: {
          ...layout,
          viewport: { x: 210, y: 120, zoom: 1.4 },
          canvasScroll: { left: 25, top: 35 },
        },
      },
    }
    const workflow: WorkflowProjection = { ...projection.scope.workflow, definition: {}, graphs: [projection] }
    const transaction = {
      workflowId: 'workflow',
      before: { definition: 'before', companion: null },
      after: { definition: 'after', companion: null },
    } as YamlTransaction
    setActiveLayout(after)
    canvasScope.publishCanvasProjection('workflow', workflow)
    canvasScope.commitCanvasIdentityChanges(before, transaction, emptyIdentityChanges())
    const props = () => ({
      projection,
      layout: activeScopeLayout($activeLayout.get()!),
      workflowIdentity: JSON.stringify(['workflow', 'root']),
      restoreRequest: canvasScope.$canvasScopeRestoration.get(),
    })
    const persist = vi.fn()
    const changed = vi.fn()
    const { container, rerender } = renderCanvas({ ...props(), onPersistLayout: persist, onLayoutChange: changed })
    const view = container.querySelector<HTMLElement>('.svelte-flow__viewport')!
    const scroll = container.querySelector<HTMLElement>('[data-testid="workflow-canvas-viewport"]')!
    await tick()
    expect(view.style.transform).toContain('translate(210px, 120px) scale(1.4)')
    expect(canvasScope.queueCanvasLayoutHistory(transaction, 'undo')).toBe(true)
    canvasScope.publishCanvasProjection('workflow', workflow, workflow, transaction.before)
    await rerender(props())
    await tick()
    expect(view.style.transform).toContain('translate(12px, 34px) scale(0.8)')
    expect([scroll.scrollLeft, scroll.scrollTop]).toEqual([5, 15])
    expect(canvasScope.queueCanvasLayoutHistory(transaction, 'redo')).toBe(true)
    canvasScope.publishCanvasProjection('workflow', workflow, workflow, transaction.after)
    await rerender(props())
    await tick()
    expect(view.style.transform).toContain('translate(210px, 120px) scale(1.4)')
    expect([scroll.scrollLeft, scroll.scrollTop]).toEqual([25, 35])
    // Ordinary layout publications must not continually overwrite the live view.
    await rerender({ ...props(), layout: before.scopeLayouts.root })
    await tick()
    expect(view.style.transform).toContain('translate(210px, 120px) scale(1.4)')
    expect([scroll.scrollLeft, scroll.scrollTop]).toEqual([25, 35])
    await rerender({
      ...props(),
      layout: before.scopeLayouts.root,
      restoreRequest: { identity: JSON.stringify(['other-workflow', 'root']), version: 999999 },
    })
    await tick()
    expect(view.style.transform).toContain('translate(210px, 120px) scale(1.4)')
    await vi.advanceTimersByTimeAsync(550)
    expect(changed).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    clearActiveLayout()
  })

  it('restores the saved viewport when switching between workflow identities without arranging', async () => {
    const firstLayout: ScopeLayoutV1 = {
      ...layout,
      viewport: { x: 12, y: 34, zoom: 0.8 },
    }
    const secondLayout: ScopeLayoutV1 = {
      ...layout,

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
    const persisted: { scope: ScopeLayoutV1; identity: string }[] = []
    const persistLayout = vi.fn(async (next: ScopeLayoutV1, identity: string) => {
      persisted.push({ scope: structuredClone(next), identity })
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
    const secondLayout: ScopeLayoutV1 = {
      ...layout,

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
    expect(persisted.map(({ scope, identity }) => ({ identity, collect: scope.nodePositions.collect }))).toEqual([
      { identity: 'workspace\0workflow:workspace:release.yaml', collect: { x: 88, y: 99 } },
      { identity: 'workspace-b\0workflow:workspace-b:deploy.yaml', collect: { x: 44, y: 55 } },
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

  it.each(['Enter', ' '])('owns focused-edge %j after target processing without preventing default', async (key) => {
    const { container } = renderCanvas({ projection, layout })
    const flow = container.querySelector<HTMLElement>('.svelte-flow')!
    const edge = document.createElement('div')
    const targetHandler = vi.fn(() => edge.classList.add('selected'))
    const outerHandler = vi.fn()
    edge.className = 'svelte-flow__edge'
    edge.tabIndex = 0
    edge.addEventListener('keydown', targetHandler)
    flow.append(edge)
    window.addEventListener('keydown', outerHandler)

    try {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      edge.dispatchEvent(event)

      expect(targetHandler).toHaveBeenCalledOnce()
      expect(edge).toHaveClass('selected')
      expect(event.defaultPrevented).toBe(false)
      expect(outerHandler).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', outerHandler)
    }
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
