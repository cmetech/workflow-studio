import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
import { canvasCapacityForProjection, createMemoizedCanvasProjector } from '$src/features/canvas/project-canvas'
import { commandRegistry } from '$src/lib/commands/registry'
import {
  createEditorMetricsCollector,
  installEditorMetrics,
  type EditorMetricSnapshot,
} from '$src/lib/metrics/editor-metrics'
import { $canvasSelection, clearCanvasState } from '$src/stores/canvas'
import {
  createLargeWorkflowFixture,
  LARGE_WORKFLOW_EDGE_COUNT,
  LARGE_WORKFLOW_NODE_COUNT,
  LARGE_WORKFLOW_SEED,
} from './large-workflow'

const ZERO_EXPENSIVE_METRICS: Pick<
  EditorMetricSnapshot,
  'parseRequests' | 'validationPasses' | 'layouts' | 'yamlTransactions' | 'nativeCalls' | 'gitCalls'
> = {
  parseRequests: 0,
  validationPasses: 0,
  layouts: 0,
  yamlTransactions: 0,
  nativeCalls: 0,
  gitCalls: 0,
}

describe('250-node canvas performance contract', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('reduce') ? false : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
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

  it('builds the fixed-seed fixture with exactly 250 nodes and 500 unique forward-only edges', () => {
    const first = createLargeWorkflowFixture(LARGE_WORKFLOW_SEED)
    const second = createLargeWorkflowFixture(LARGE_WORKFLOW_SEED)
    const indexes = new Map(first.projection.nodes.map(({ id }, index) => [id, index]))

    expect(first.projection.nodes).toHaveLength(LARGE_WORKFLOW_NODE_COUNT)
    expect(first.projection.edges).toHaveLength(LARGE_WORKFLOW_EDGE_COUNT)
    expect(new Set(first.projection.edges.map(({ id }) => id)).size).toBe(LARGE_WORKFLOW_EDGE_COUNT)
    expect(
      first.projection.edges.every(
        ({ source, target }) => (indexes.get(source) ?? Number.MAX_SAFE_INTEGER) < (indexes.get(target) ?? -1),
      ),
    ).toBe(true)
    expect(second.projection.edges).toEqual(first.projection.edges)
    expect(second.yaml).toBe(first.yaml)
  })

  it('keeps 1,000 pointer moves isolated and persists exactly one completed drag after the debounce', async () => {
    vi.useFakeTimers()
    const fixture = createLargeWorkflowFixture()
    const originalLayout = structuredClone(fixture.layout)
    const metrics = createEditorMetricsCollector()
    const restoreMetrics = installEditorMetrics(metrics)
    const persistLayout = vi.fn().mockResolvedValue(undefined)

    try {
      const { container } = render(GraphCanvas, {
        commandSurface: commandRegistry,
        projection: fixture.projection,
        layout: fixture.layout,
        onPersistLayout: persistLayout,
      })
      await tick()
      metrics.reset()
      const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!

      for (let move = 1; move <= 1_000; move += 1) {
        canvas.dispatchEvent(
          new CustomEvent('workflowdragmove', {
            bubbles: true,
            detail: { id: 'node-000', position: { x: move, y: move * 2 } },
          }),
        )
      }

      expect(metrics.snapshot()).toMatchObject({ ...ZERO_EXPENSIVE_METRICS, pointerMoves: 1_000 })
      expect(persistLayout).not.toHaveBeenCalled()

      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', {
          bubbles: true,
          detail: { id: 'node-000', position: { x: 1_000, y: 2_000 } },
        }),
      )
      expect(metrics.snapshot()).toMatchObject({
        ...ZERO_EXPENSIVE_METRICS,
        pointerMoves: 1_000,
        dragCompletions: 1,
        layoutSaves: 0,
      })
      await vi.advanceTimersByTimeAsync(299)
      expect(persistLayout).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      expect(persistLayout).toHaveBeenCalledOnce()
      const persisted = persistLayout.mock.calls[0]![0]
      expect(persisted.nodePositions['node-000']).toEqual({ x: 1_000, y: 2_000 })
      expect(persisted.nodePositions['node-001']).toEqual(originalLayout.nodePositions['node-001'])
      expect(fixture.layout).toEqual(originalLayout)
      expect(metrics.snapshot()).toMatchObject({
        ...ZERO_EXPENSIVE_METRICS,
        pointerMoves: 1_000,
        dragCompletions: 1,
        layoutSaves: 1,
      })
    } finally {
      restoreMetrics()
    }
  })

  it('memoizes unchanged projection identities and keeps every node render payload bounded', () => {
    const fixture = createLargeWorkflowFixture()
    const project = createMemoizedCanvasProjector()

    const first = project(fixture.projection, fixture.layout)
    const second = project(fixture.projection, fixture.layout)

    expect(second).toBe(first)
    expect(
      first.nodes.every(({ data }) => {
        const keys = Object.keys(data).sort()
        return (
          JSON.stringify(data).length <= 256 &&
          keys.every((key) => !['definition', 'document', 'options', 'source', 'text', 'value'].includes(key))
        )
      }),
    ).toBe(true)
  })

  it('keeps the 250/500 boundary visual and treats larger workflows as non-blocking YAML-only documents', () => {
    const fixture = createLargeWorkflowFixture()
    const atLimit = canvasCapacityForProjection(fixture.projection)
    const overLimit = canvasCapacityForProjection({
      ...fixture.projection,
      nodes: [
        ...fixture.projection.nodes,
        {
          id: 'node-250',
          kind: 'command',
          value: 'Preserved in YAML only',
          dependsOn: [],
          options: {},
          source: { path: '/nodes/250', start: 2_500, end: 2_509 },
        },
      ],
    })

    expect(atLimit).toEqual({ visual: true, blocking: false, nodeCount: 250, edgeCount: 500 })
    expect(overLimit).toMatchObject({ visual: false, blocking: false, nodeCount: 251, edgeCount: 500 })
    expect(overLimit.advisory).toMatch(/preserved.*YAML-only/i)
  })

  it('batches a burst of selection events into one global selection publication', async () => {
    const fixture = createLargeWorkflowFixture()
    const { container } = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: fixture.projection,
      layout: fixture.layout,
    })
    await tick()
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const publications: string[][] = []
    const unsubscribe = $canvasSelection.subscribe((ids) => {
      publications.push([...ids])
    })
    const baseline = publications.length

    for (let index = 0; index < 100; index += 1) {
      canvas.dispatchEvent(
        new CustomEvent('workflowselectionchange', {
          bubbles: true,
          detail: { ids: [`node-${String(index).padStart(3, '0')}`] },
        }),
      )
    }
    await Promise.resolve()
    await tick()

    expect(publications).toHaveLength(baseline + 1)
    expect($canvasSelection.get()).toEqual(['node-099'])
    unsubscribe()
  })
})
