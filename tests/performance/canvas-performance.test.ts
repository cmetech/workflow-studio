import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
import {
  canvasCapacityForProjection,
  createMemoizedCanvasProjector,
  projectCanvas,
} from '$src/features/canvas/project-canvas'
import {
  createCanvasSelectionReconciler,
  reconcileCanvasNodeSelection,
} from '$src/features/canvas/reconcile-canvas-selection'
import { commandRegistry } from '$src/lib/commands/registry'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import {
  createEditorMetricsCollector,
  installEditorMetrics,
  type EditorMetricSnapshot,
} from '$src/lib/metrics/editor-metrics'
import { $canvasSelection, clearCanvasState } from '$src/stores/canvas'
import { patchWorkflowDocument } from '$src/lib/yaml/patch-document'
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

  it('reconciles 250-node selection without replacing unchanged render identities', () => {
    const fixture = createLargeWorkflowFixture()
    const projected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const reconcileSelection = createCanvasSelectionReconciler()

    const first = reconcileSelection(projected.nodes, ['node-125'])
    const unchanged = reconcileSelection(projected.nodes, ['node-125'])

    expect(unchanged.nodes).toBe(first.nodes)
    expect(unchanged.nodes.every((node, index) => node === first.nodes[index])).toBe(true)

    const changedProjectedNodes = [...projected.nodes]
    changedProjectedNodes[127] = {
      ...changedProjectedNodes[127]!,
      data: { ...changedProjectedNodes[127]!.data, summary: 'Changed projected summary' },
    }
    const oneProjectionChange = reconcileSelection(changedProjectedNodes, ['node-125'])

    expect(oneProjectionChange.nodes).not.toBe(first.nodes)
    expect(oneProjectionChange.nodes[127]).not.toBe(first.nodes[127])
    expect(oneProjectionChange.nodes.every((node, index) => index === 127 || node === first.nodes[index])).toBe(true)

    const oneSelectionChange = reconcileSelection(changedProjectedNodes, ['node-126'])
    expect(oneSelectionChange.nodes[125]).not.toBe(oneProjectionChange.nodes[125])
    expect(oneSelectionChange.nodes[126]).not.toBe(oneProjectionChange.nodes[126])
    expect(
      oneSelectionChange.nodes.every(
        (node, index) => index === 125 || index === 126 || node === oneProjectionChange.nodes[index],
      ),
    ).toBe(true)

    const withoutSelectedNode = changedProjectedNodes.filter(({ id }) => id !== 'node-126')
    const removed = reconcileSelection(withoutSelectedNode, ['node-126'])
    expect(removed.selection).toEqual([])
    expect(removed.nodes).toHaveLength(249)
    expect(removed.nodes.some(({ id, selected }) => id === 'node-126' || selected)).toBe(false)
  })

  it('restores unchanged 250-node selection without cloning the render array or node objects', () => {
    const fixture = createLargeWorkflowFixture()
    const projected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const selectedNodes = projected.nodes.map((node) => (node.id === 'node-125' ? { ...node, selected: true } : node))

    const unchanged = reconcileCanvasNodeSelection(selectedNodes, ['node-125'])

    expect(unchanged).toBe(selectedNodes)
    expect(unchanged.every((node, index) => node === selectedNodes[index])).toBe(true)

    const changed = reconcileCanvasNodeSelection(selectedNodes, ['node-126'])
    expect(changed).not.toBe(selectedNodes)
    expect(changed[125]).not.toBe(selectedNodes[125])
    expect(changed[126]).not.toBe(selectedNodes[126])
    expect(changed.every((node, index) => index === 125 || index === 126 || node === selectedNodes[index])).toBe(true)
  })

  it('keeps the bound runtime-decorated 250-node array when projection and selection are unchanged', () => {
    const fixture = createLargeWorkflowFixture()
    const projected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const reconcileSelection = createCanvasSelectionReconciler()
    const initial = reconcileSelection(projected.nodes, ['node-125'])
    const liveNodes = initial.nodes.map((node) => ({ ...node, measured: { width: 240, height: 84 } }))

    const unchanged = reconcileSelection(projected.nodes, ['node-125'], liveNodes)

    expect(unchanged.nodes).toBe(liveNodes)
    expect(unchanged.nodes.every((node, index) => node === liveNodes[index])).toBe(true)
  })

  it('publishes one genuine projected node change while preserving unchanged bound node identities', () => {
    const fixture = createLargeWorkflowFixture()
    const projected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const reconcileSelection = createCanvasSelectionReconciler()
    const initial = reconcileSelection(projected.nodes, ['node-125'])
    const liveNodes = initial.nodes.map((node) => ({ ...node, measured: { width: 240, height: 84 } }))
    const changedProjectedNodes = [...projected.nodes]
    changedProjectedNodes[127] = {
      ...changedProjectedNodes[127]!,
      data: { ...changedProjectedNodes[127]!.data, summary: 'Changed projected summary' },
    }

    const changed = reconcileSelection(changedProjectedNodes, ['node-125'], liveNodes)

    expect(changed.nodes).not.toBe(liveNodes)
    expect(changed.nodes[127]).toBe(changedProjectedNodes[127])
    expect(changed.nodes.every((node, index) => index === 127 || node === liveNodes[index])).toBe(true)
  })

  it('publishes an issue-derived node change while preserving unaffected bound node identities', () => {
    const fixture = createLargeWorkflowFixture()
    const projected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const reconcileSelection = createCanvasSelectionReconciler()
    const initial = reconcileSelection(projected.nodes, ['node-125'])
    const liveNodes = initial.nodes.map((node) => ({ ...node, measured: { width: 240, height: 84 } }))
    const changedProjectedNodes = [...projected.nodes]
    changedProjectedNodes[127] = {
      ...changedProjectedNodes[127]!,
      data: { ...changedProjectedNodes[127]!.data, errorCount: 1, requiredIssueCount: 1 },
    }

    const changed = reconcileSelection(changedProjectedNodes, ['node-125'], liveNodes)

    expect(changed.nodes[127]).toBe(changedProjectedNodes[127])
    expect(changed.nodes.every((node, index) => index === 127 || node === liveNodes[index])).toBe(true)
  })

  it('clones only bound nodes whose authoritative selection changes', () => {
    const fixture = createLargeWorkflowFixture()
    const projected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const reconcileSelection = createCanvasSelectionReconciler()
    const initial = reconcileSelection(projected.nodes, ['node-125'])
    const liveNodes = initial.nodes.map((node) => ({ ...node, measured: { width: 240, height: 84 } }))

    const changed = reconcileSelection(projected.nodes, ['node-126'], liveNodes)

    expect(changed.nodes).not.toBe(liveNodes)
    expect(changed.nodes[125]).not.toBe(liveNodes[125])
    expect(changed.nodes[126]).not.toBe(liveNodes[126])
    expect(changed.nodes.every((node, index) => index === 125 || index === 126 || node === liveNodes[index])).toBe(true)
  })

  it('preserves arranged live node identities across the persisted-layout projection echo', () => {
    const fixture = createLargeWorkflowFixture()
    const initialProjected = createMemoizedCanvasProjector()(fixture.projection, fixture.layout)
    const reconcileSelection = createCanvasSelectionReconciler()
    const initial = reconcileSelection(initialProjected.nodes, ['node-125'])
    const initialLiveNodes = initial.nodes.map((node) => ({ ...node, measured: { width: 240, height: 84 } }))
    const arrangedProjected = projectCanvas(fixture.projection, fixture.layout, { arrange: true })
    const arranged = reconcileSelection(arrangedProjected.nodes, ['node-125'], initialLiveNodes)
    expect(arranged.nodes[0]).toBe(arrangedProjected.nodes[0])
    expect(arranged.nodes[0]!.position).toEqual(arrangedProjected.nodes[0]!.position)
    expect(arranged.nodes[0]!.position).not.toEqual(initialLiveNodes[0]!.position)
    const arrangedLiveNodes = arranged.nodes.map((node) => ({ ...node, measured: { width: 240, height: 84 } }))
    const echoedLayout = { ...fixture.layout, nodePositions: arrangedProjected.positions }
    const echoedProjected = projectCanvas(fixture.projection, echoedLayout)

    const echoed = reconcileSelection(echoedProjected.nodes, ['node-125'], arrangedLiveNodes)

    expect(echoed.nodes).toBe(arrangedLiveNodes)
    expect(echoed.nodes.every((node, index) => node === arrangedLiveNodes[index])).toBe(true)
  })

  it('reuses unchanged render objects when one dependency changes at canvas capacity', () => {
    const fixture = createLargeWorkflowFixture()
    const project = createMemoizedCanvasProjector()
    const first = project(fixture.projection, fixture.layout)
    const changedProjection = {
      ...fixture.projection,
      edges: fixture.projection.edges.filter(({ source, target }) => source !== 'node-027' || target !== 'node-028'),
    }

    const second = project(changedProjection, fixture.layout)

    expect(second.nodes).toBe(first.nodes)
    expect(second.positions).toBe(first.positions)
    expect(second.edges.find(({ id }) => id === 'dependency:node-001->node-002')).toBe(
      first.edges.find(({ id }) => id === 'dependency:node-001->node-002'),
    )
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

  it('source-patches dependencies at the exact 250/500 boundary', async () => {
    const fixture = createLargeWorkflowFixture()
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')
    if (!contract) throw new Error('Expected the bundled Hermes legacy contract.')

    const disconnected = patchWorkflowDocument(
      fixture.yaml,
      { type: 'set-dependencies', nodeId: 'node-028', dependsOn: ['node-018'] },
      contract,
    )
    expect(disconnected).toMatchObject({ ok: true })
    if (!disconnected.ok) return

    const connected = patchWorkflowDocument(
      disconnected.text,
      { type: 'set-dependencies', nodeId: 'node-028', dependsOn: ['node-018', 'node-027'] },
      contract,
    )
    expect(connected).toMatchObject({ ok: true })
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
