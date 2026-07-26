<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    SelectionMode,
    SvelteFlow,
    type Viewport,
  } from '@xyflow/svelte'
  import { Map, Network } from 'lucide-svelte'
  import '@xyflow/svelte/dist/style.css'
  import type { LayoutRecordV1 } from '$src/lib/layout/types'
  import type { ValidationIssue } from '$src/lib/documents/types'
  import type { WorkflowProjection } from '$src/lib/projection/types'
  import {
    $canvasPositions as canvasPositionsStore,
    moveCanvasPosition,
    replaceCanvasPositions,
    setCanvasSelection,
  } from '$src/stores/canvas'
  import { projectCanvas } from './project-canvas'
  import type { CanvasDragDetail, CanvasEdge, CanvasNode } from './types'
  import WorkflowEdge from './WorkflowEdge.svelte'
  import WorkflowNode from './WorkflowNode.svelte'

  interface Props {
    projection: WorkflowProjection
    layout: LayoutRecordV1
    workflowIdentity?: string
    issues?: readonly ValidationIssue[]
    stale?: boolean
    readOnly?: boolean
    onPersistLayout?: (layout: LayoutRecordV1) => void | Promise<void>
    onPersistenceError?: (error: unknown) => void
  }

  let {
    projection,
    layout,
    workflowIdentity = `${layout.workspaceId}\0${layout.workflowPath}`,
    issues = [],
    stale = false,
    readOnly = false,
    onPersistLayout = () => undefined,
    onPersistenceError = () => undefined,
  }: Props = $props()

  const nodeTypes = { workflow: WorkflowNode }
  const edgeTypes = { workflow: WorkflowEdge }
  const initialProjection = deriveCanvas()
  let flowNodes = $state.raw<CanvasNode[]>(initialProjection.nodes)
  let flowEdges = $state.raw<CanvasEdge[]>(initialProjection.edges)
  let flowViewport = $state.raw<Viewport>({ x: 0, y: 0, zoom: 1 })
  let restoredWorkflowIdentity = $state<string | null>(null)
  let minimapVisible = $state(false)
  let root: HTMLElement
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let pendingLayout: LayoutRecordV1 | null = null
  let persistenceQueue: Promise<void> = Promise.resolve()

  function deriveCanvas() {
    return projectCanvas(projection, layout, { issues, stale, readOnly })
  }

  $effect(() => {
    const projected = deriveCanvas()
    flowNodes = projected.nodes
    flowEdges = projected.edges
    replaceCanvasPositions(projected.positions)
  })

  $effect(() => {
    if (workflowIdentity === restoredWorkflowIdentity) return
    restoredWorkflowIdentity = workflowIdentity
    flowViewport = { ...layout.viewport }
  })

  function handleDrag(detail: CanvasDragDetail): void {
    if (readOnly || stale) return
    moveCanvasPosition(detail.id, detail.position)
  }

  function handleDragStop(detail: CanvasDragDetail): void {
    if (readOnly || stale) return
    moveCanvasPosition(detail.id, detail.position)
    schedulePersist(layoutWithPositions())
  }

  function arrange(): void {
    if (readOnly || stale) return
    const projected = projectCanvas(projection, layout, { issues, arrange: true })
    flowNodes = projected.nodes
    flowEdges = projected.edges
    replaceCanvasPositions(projected.positions)
    schedulePersist(layoutWithPositions())
  }

  function viewportChanged(viewport: Viewport): void {
    if (readOnly || stale) return
    schedulePersist({ ...layoutWithPositions(), viewport: { ...viewport } })
  }

  function layoutWithPositions(): LayoutRecordV1 {
    return {
      ...layout,
      nodePositions: Object.fromEntries(
        Object.entries(canvasPositionsStore.get()).map(([id, position]) => [id, { ...position }]),
      ),
      updatedAt: new Date().toISOString(),
    }
  }

  function schedulePersist(next: LayoutRecordV1): void {
    pendingLayout = structuredClone(next)
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      void flushPersistence().catch(onPersistenceError)
    }, 300)
  }

  export function flushPersistence(): Promise<void> {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = undefined
    const next = pendingLayout
    pendingLayout = null
    if (!next) return persistenceQueue
    const operation = persistenceQueue.catch(() => undefined).then(() => onPersistLayout(next))
    persistenceQueue = operation
    return operation
  }

  onMount(() => {
    const drag = (event: Event) => handleDrag((event as CustomEvent<CanvasDragDetail>).detail)
    const stop = (event: Event) => handleDragStop((event as CustomEvent<CanvasDragDetail>).detail)
    root.addEventListener('workflowdragmove', drag)
    root.addEventListener('workflowdragstop', stop)
    return () => {
      root.removeEventListener('workflowdragmove', drag)
      root.removeEventListener('workflowdragstop', stop)
    }
  })

  onDestroy(() => {
    void flushPersistence().catch(onPersistenceError)
  })
</script>

<section class="graph-canvas" data-testid="workflow-canvas" aria-label="Workflow graph" bind:this={root}>
  <div class="canvas-toolbar" aria-label="Canvas tools">
    <button type="button" aria-label="Arrange graph" disabled={readOnly || stale} onclick={arrange}>
      <Network size={15} aria-hidden="true" />
      Arrange
    </button>
    <button
      type="button"
      aria-label={minimapVisible ? 'Hide minimap' : 'Show minimap'}
      aria-pressed={minimapVisible}
      onclick={() => (minimapVisible = !minimapVisible)}
    >
      <Map size={15} aria-hidden="true" />
      Map
    </button>
  </div>

  <SvelteFlow
    bind:nodes={flowNodes}
    bind:edges={flowEdges}
    bind:viewport={flowViewport}
    {nodeTypes}
    {edgeTypes}
    nodesDraggable={!readOnly && !stale}
    nodesConnectable={!readOnly && !stale}
    elementsSelectable={true}
    nodesFocusable={true}
    edgesFocusable={true}
    selectionOnDrag={true}
    selectionMode={SelectionMode.Partial}
    selectionKey="Shift"
    multiSelectionKey={['Meta', 'Control']}
    panActivationKey="Space"
    panOnDrag={true}
    minZoom={0.1}
    maxZoom={4}
    fitViewOptions={{ padding: 0.18, duration: 0 }}
    onnodedrag={({ targetNode, nodes }) => {
      const node = targetNode ?? nodes[0]
      if (node) handleDrag({ id: node.id, position: node.position })
    }}
    onnodedragstop={({ targetNode, nodes }) => {
      const node = targetNode ?? nodes[0]
      if (node) handleDragStop({ id: node.id, position: node.position })
    }}
    onselectionchange={({ nodes }) => setCanvasSelection(nodes.map(({ id }) => id))}
    onmoveend={(_event, viewport) => viewportChanged(viewport)}
  >
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
    <Controls showLock={false} aria-label="Canvas zoom controls" />
    {#if minimapVisible}
      <MiniMap
        ariaLabel="Workflow minimap"
        pannable={true}
        zoomable={true}
        nodeColor="var(--color-accent)"
        maskColor="color-mix(in srgb, var(--color-background) 74%, transparent)"
      />
    {/if}
  </SvelteFlow>

  {#if stale}
    <div class="stale-overlay" role="status">
      Last valid graph shown read-only while current YAML has structural errors.
    </div>
  {/if}
</section>

<style>
  .graph-canvas {
    position: relative;
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 18rem;
    overflow: hidden;
    background: var(--color-canvas);
  }

  :global(.graph-canvas .svelte-flow) {
    background-image: radial-gradient(var(--color-grid) 1px, transparent 1px);
    background-size: 1.25rem 1.25rem;
  }

  :global(.graph-canvas .workflow-edge .svelte-flow__edge-path) {
    stroke: var(--color-edge);
    stroke-width: 2;
  }

  :global(.graph-canvas .workflow-edge.stale .svelte-flow__edge-path) {
    stroke-dasharray: 5 4;
    opacity: 0.72;
  }

  .canvas-toolbar {
    position: absolute;
    z-index: 6;
    top: 0.625rem;
    right: 0.625rem;
    display: flex;
    gap: 0.35rem;
  }

  .canvas-toolbar button {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    min-height: 2rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--color-border);
    border-radius: 0.4rem;
    color: var(--color-text);
    background: var(--color-surface);
  }

  .canvas-toolbar button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }

  .stale-overlay {
    position: absolute;
    z-index: 5;
    right: 1rem;
    bottom: 1rem;
    max-width: 24rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--color-warning);
    border-radius: 0.45rem;
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 94%, transparent);
    font-size: 0.72rem;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.graph-canvas *),
    :global(.graph-canvas *::before),
    :global(.graph-canvas *::after) {
      scroll-behavior: auto !important;
      transition-duration: 0s !important;
      animation-duration: 0s !important;
    }
  }
</style>
