import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import archonContractText from '../../contracts/archon-2026-07-v6.json?raw'
import {
  createOversizedBodyFixture,
  createScopedCapacityFixture,
  SCOPED_BODY_COUNT,
  SCOPED_EDGE_COUNT,
  SCOPED_NODE_COUNT,
} from '$src/e2e/loop-group-fixtures'
import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
import { commandRegistry } from '$src/lib/commands/registry'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { ContractDigest } from '$src/lib/documents/types'
import { createEditorMetricsCollector, installEditorMetrics } from '$src/lib/metrics/editor-metrics'
import { referenceIndexBuildCountForTest } from '$src/lib/references/reference-index'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { $canvasSelection, clearCanvasState } from '$src/stores/canvas'
import { $activeLayout, clearActiveLayout, setActiveLayout, updateScopeLayout } from '$src/stores/layout'
import { publishCanvasProjection } from '$src/stores/canvas-scope'

let contract: AuthoringContract

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
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
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  contract = loaded.contract
})

afterEach(() => {
  vi.useRealTimers()
  clearActiveLayout()
  clearCanvasState()
})

async function analyzeFixture(fixture = createScopedCapacityFixture()) {
  return analyzeWorkflowPair(
    {
      type: 'analyze' as const,
      requestId: 'scoped-capacity',
      workflowId: 'scoped-capacity',
      pairGeneration: 1,
      definition: { path: fixture.definitionPath, text: fixture.definition, revision: 1 },
      companion: { path: fixture.companionPath, text: fixture.companion, revision: 1 },
      profile: 'archon-2026-07' as const,
      contractDigest: contract.contract_digest as ContractDigest,
      reason: 'explicit-validate' as const,
    },
    contract,
  )
}

describe('[RG12] scoped canvas performance contract', () => {
  it('builds one deterministic 250/500 root and three deterministic 250/500 bodies', () => {
    const first = createScopedCapacityFixture()
    const second = createScopedCapacityFixture()
    const definition = parse(first.definition) as {
      nodes: Array<{
        id: string
        depends_on?: string[]
        loop_group?: { nodes: Array<{ id: string; depends_on?: string[] }> }
      }>
    }

    expect(first.definition).toBe(second.definition)
    expect(first.layout).toEqual(second.layout)
    expect(first.definition.length).toBeLessThan(2 * 1024 * 1024)
    expect(definition.nodes).toHaveLength(SCOPED_NODE_COUNT)
    expect(first.scopes).toHaveLength(SCOPED_BODY_COUNT + 1)
    for (const scope of first.scopes) {
      expect(scope.nodeIds).toHaveLength(SCOPED_NODE_COUNT)
      expect(scope.edges).toHaveLength(SCOPED_EDGE_COUNT)
      expect(new Set(scope.nodeIds).size).toBe(SCOPED_NODE_COUNT)
      expect(new Set(scope.edges.map(({ source, target }) => `${source}->${target}`)).size).toBe(SCOPED_EDGE_COUNT)
      const order = new Map(scope.nodeIds.map((id, index) => [id, index]))
      expect(scope.edges.every(({ source, target }) => order.get(source)! < order.get(target)!)).toBe(true)
      expect(Object.keys(first.layout.scopeLayouts[scope.scopeKey]!.nodePositions)).toHaveLength(SCOPED_NODE_COUNT)
    }
    expect(definition.nodes.filter(({ loop_group }) => loop_group)).toHaveLength(SCOPED_BODY_COUNT)
  })

  it('analyzes all four bounded scopes once within the established module budget', async () => {
    const fixture = createScopedCapacityFixture()
    const beforeIndexes = referenceIndexBuildCountForTest()
    const started = performance.now()
    const analysis = await analyzeFixture(fixture)
    const elapsed = performance.now() - started

    expect(analysis.structurallyValid).toBe(true)
    expect(referenceIndexBuildCountForTest() - beforeIndexes).toBe(1)
    expect(analysis.referenceIndex?.metrics).toMatchObject({
      indexBuilds: 1,
      definitionTraversals: 1,
      graphVisits: 4,
      nodeVisits: SCOPED_NODE_COUNT * 4,
    })
    expect(
      analysis.projection?.graphs.map(({ scope, capacity }) => ({
        key: scope.key,
        nodes: capacity.nodeCount,
        edges: capacity.edgeCount,
      })),
    ).toEqual(
      fixture.scopes.map(({ scopeKey }) => ({
        key: scopeKey,
        nodes: SCOPED_NODE_COUNT,
        edges: SCOPED_EDGE_COUNT,
      })),
    )
    expect(elapsed).toBeLessThan(2_000)
  })

  it('mounts one flow for the active scope and never lays out hidden scopes', async () => {
    const fixture = createScopedCapacityFixture()
    const exactDefinition = fixture.definition
    const exactCompanion = fixture.companion
    const analysis = await analyzeFixture(fixture)
    const projection = analysis.projection as WorkflowProjection
    const metrics = createEditorMetricsCollector()
    const restore = installEditorMetrics(metrics)
    const rendered = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: projection.graphs[0]!,
      layout: fixture.layout.scopeLayouts.root,
      workflowIdentity: 'scoped-capacity:root',
    })
    await tick()
    expect(rendered.container.querySelectorAll('.svelte-flow')).toHaveLength(1)
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="root-000"]')).toBeTruthy()
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="body-0-000"]')).toBeNull()

    metrics.reset()
    await rendered.rerender({
      commandSurface: commandRegistry,
      projection: projection.graphs[1]!,
      layout: fixture.layout.scopeLayouts['loop-group:root-000']!,
      workflowIdentity: 'scoped-capacity:loop-group:root-000',
    })
    await tick()
    expect(rendered.container.querySelectorAll('.svelte-flow')).toHaveLength(1)
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="root-000"]')).toBeNull()
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="body-0-000"]')).toBeTruthy()
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="body-1-000"]')).toBeNull()
    expect(metrics.snapshot()).toMatchObject({
      parseRequests: 0,
      validationPasses: 0,
      layouts: 0,
      yamlTransactions: 0,
      nativeCalls: 0,
      gitCalls: 0,
      layoutSaves: 0,
    })
    expect(fixture.definition).toBe(exactDefinition)
    expect(fixture.companion).toBe(exactCompanion)
    rendered.unmount()
    restore()
  })

  it.each([
    { scopeKey: 'root' as const, graphIndex: 0, nodeId: 'root-003' },
    { scopeKey: 'loop-group:root-000' as const, graphIndex: 1, nodeId: 'body-0-003' },
  ])(
    'keeps 1,000 $scopeKey pointer moves authority-free and persists that scope once',
    async ({ scopeKey, graphIndex, nodeId }) => {
      vi.useFakeTimers()
      const fixture = createScopedCapacityFixture()
      const analysis = await analyzeFixture(fixture)
      const projection = analysis.projection as WorkflowProjection
      const metrics = createEditorMetricsCollector()
      const restore = installEditorMetrics(metrics)
      const persist = vi.fn(async () => undefined)
      const rendered = render(GraphCanvas, {
        commandSurface: commandRegistry,
        projection: projection.graphs[graphIndex]!,
        layout: fixture.layout.scopeLayouts[scopeKey]!,
        workflowIdentity: `scoped-capacity:${scopeKey}`,
        onPersistLayout: persist,
      })
      await tick()
      metrics.reset()
      const canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
      const beforeText = fixture.definition
      for (let move = 1; move <= 1_000; move += 1) {
        canvas.dispatchEvent(
          new CustomEvent('workflowdragmove', {
            bubbles: true,
            detail: { id: nodeId, position: { x: move, y: move * 2 } },
          }),
        )
      }
      expect(metrics.snapshot()).toMatchObject({
        parseRequests: 0,
        validationPasses: 0,
        layouts: 0,
        yamlTransactions: 0,
        nativeCalls: 0,
        gitCalls: 0,
        pointerMoves: 1_000,
      })
      expect(persist).not.toHaveBeenCalled()
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragstop', {
          bubbles: true,
          detail: { id: nodeId, position: { x: 1_000, y: 2_000 } },
        }),
      )
      await vi.advanceTimersByTimeAsync(299)
      expect(persist).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(persist).toHaveBeenCalledOnce()
      expect(persist.mock.calls[0]![0].nodePositions[nodeId]).toEqual({ x: 1_000, y: 2_000 })
      expect(fixture.definition).toBe(beforeText)
      expect(metrics.snapshot()).toMatchObject({
        parseRequests: 0,
        validationPasses: 0,
        layouts: 0,
        yamlTransactions: 0,
        nativeCalls: 0,
        gitCalls: 0,
        pointerMoves: 1_000,
        dragCompletions: 1,
        layoutSaves: 1,
      })
      rendered.unmount()
      restore()
    },
  )

  it('batches body selection and dispatches one semantic connection without pointer-frame authority work', async () => {
    const fixture = createScopedCapacityFixture()
    const analysis = await analyzeFixture(fixture)
    const projection = analysis.projection as WorkflowProjection
    const metrics = createEditorMetricsCollector()
    const restore = installEditorMetrics(metrics)
    const onConnect = vi.fn(async () => ({ status: 'committed' as const }))
    const onLayoutChange = vi.fn()
    setActiveLayout({ ...fixture.layout, activeScopeKey: 'loop-group:root-000' })
    publishCanvasProjection('scoped-capacity', projection)
    const hiddenScope = $activeLayout.get()!.scopeLayouts['loop-group:root-001']
    const rendered = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: projection.graphs[1]!,
      layout: fixture.layout.scopeLayouts['loop-group:root-000']!,
      workflowIdentity: 'scoped-capacity:loop-group:root-000',
      onConnect,
      onLayoutChange,
    })
    await tick()
    const canvas = rendered.container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    metrics.reset()

    for (let index = 0; index < 1_000; index += 1) {
      canvas.dispatchEvent(
        new CustomEvent('workflowselectionchange', {
          bubbles: true,
          detail: { ids: [`body-0-${String(index % SCOPED_NODE_COUNT).padStart(3, '0')}`] },
        }),
      )
    }
    expect(onLayoutChange).not.toHaveBeenCalled()
    await tick()
    expect($canvasSelection.get()).toEqual(['body-0-249'])
    expect(onLayoutChange).toHaveBeenCalledOnce()
    expect(onLayoutChange).toHaveBeenCalledWith(
      { selectedNodeIds: ['body-0-249'] },
      'scoped-capacity:loop-group:root-000',
    )
    updateScopeLayout('loop-group:root-000', (scope) => ({ ...scope, viewport: { x: 24, y: 18, zoom: 1.1 } }))
    expect($activeLayout.get()!.scopeLayouts['loop-group:root-001']).toBe(hiddenScope)
    expect(metrics.snapshot()).toMatchObject({
      parseRequests: 0,
      validationPasses: 0,
      layouts: 0,
      yamlTransactions: 0,
      nativeCalls: 0,
      gitCalls: 0,
    })

    canvas.dispatchEvent(
      new CustomEvent('workflowconnect', {
        bubbles: true,
        detail: { source: 'body-0-003', target: 'body-0-004' },
      }),
    )
    await tick()
    expect(onConnect).toHaveBeenCalledOnce()
    expect(onConnect).toHaveBeenCalledWith('body-0-003', 'body-0-004')
    expect(metrics.snapshot()).toMatchObject({
      parseRequests: 0,
      validationPasses: 0,
      layouts: 0,
      yamlTransactions: 0,
      nativeCalls: 0,
      gitCalls: 0,
    })
    rendered.unmount()
    restore()
  })

  it('classifies only a 251-node body as YAML-only while root and its sibling remain visual', async () => {
    const fixture = createOversizedBodyFixture()
    const analysis = await analyzeFixture(fixture)
    expect(analysis.structurallyValid).toBe(true)
    expect(
      analysis.projection?.graphs.map(({ scope, capacity }) => [scope.key, capacity.status, capacity.nodeCount]),
    ).toEqual([
      ['root', 'visual', 2],
      ['loop-group:large-group', 'yaml-only', 251],
      ['loop-group:small-group', 'visual', 1],
    ])
    expect(analysis.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'visual_capacity_exceeded',
          blocking: false,
          scopeKey: 'loop-group:large-group',
        }),
      ]),
    )
    expect(fixture.definition).toContain('large-250')
  })
})
