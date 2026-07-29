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
  import { Copy, Link, Map, Network, Plus, Trash2 } from 'lucide-svelte'
  import '@xyflow/svelte/dist/style.css'
  import type { LayoutRecordV1 } from '$src/lib/layout/types'
  import type { ValidationIssue } from '$src/lib/documents/types'
  import type { WorkflowProjection } from '$src/lib/projection/types'
  import {
    $canvasPositions as canvasPositionsStore,
    $canvasSelection as canvasSelectionStore,
    moveCanvasPosition,
    replaceCanvasPositions,
    setCanvasSelection,
  } from '$src/stores/canvas'
  import { projectCanvas } from './project-canvas'
  import type { CanvasDragDetail, CanvasEdge, CanvasNode } from './types'
  import WorkflowEdge from './WorkflowEdge.svelte'
  import WorkflowNode from './WorkflowNode.svelte'

  export interface CanvasAuthoringFeedback {
    readonly status: 'committed' | 'rejected' | 'resolution_required'
    readonly code?: string
    readonly message?: string
  }

  interface Props {
    projection: WorkflowProjection
    layout: LayoutRecordV1
    workflowIdentity?: string
    transitionLocked?: boolean
    issues?: readonly ValidationIssue[]
    stale?: boolean
    readOnly?: boolean
    onPersistLayout?: (layout: LayoutRecordV1) => void | Promise<void>
    onPersistenceError?: (error: unknown) => void
    onConnect?: (sourceId: string, targetId: string) => CanvasAuthoringFeedback | Promise<CanvasAuthoringFeedback>
    onDisconnect?: (sourceId: string, targetId: string) => CanvasAuthoringFeedback | Promise<CanvasAuthoringFeedback>
    onRequestAdd?: (request: {
      readonly afterNodeId?: string
      readonly viewportCenter: { readonly x: number; readonly y: number }
    }) => void | Promise<void>
    onDuplicate?: (nodeIds: readonly string[]) => CanvasAuthoringFeedback | Promise<CanvasAuthoringFeedback>
    onRequestDelete?: (nodeIds: readonly string[]) => unknown | Promise<unknown>
  }

  let {
    projection,
    layout,
    workflowIdentity = `${layout.workspaceId}\0${layout.workflowPath}`,
    transitionLocked = false,
    issues = [],
    stale = false,
    readOnly = false,
    onPersistLayout = () => undefined,
    onPersistenceError = () => undefined,
    onConnect,
    onDisconnect,
    onRequestAdd,
    onDuplicate,
    onRequestDelete,
  }: Props = $props()

  const nodeTypes = { workflow: WorkflowNode }
  const edgeTypes = { workflow: WorkflowEdge }
  const initialProjection = deriveCanvas()
  let flowNodes = $state.raw<CanvasNode[]>(initialProjection.nodes)
  let flowEdges = $state.raw<CanvasEdge[]>(initialProjection.edges)
  let flowViewport = $state.raw<Viewport>({ x: 0, y: 0, zoom: 1 })
  let restoredWorkflowIdentity = $state<string | null>(null)
  let minimapVisible = $state(false)
  let selection = $state<readonly string[]>(canvasSelectionStore.get())
  let authoringFeedback = $state('')
  let edgeSourceId = $state<string | null>(null)
  let edgeTargetIndex = $state(0)
  let root: HTMLElement
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let pendingLayout: LayoutRecordV1 | null = null
  let persistenceQueue: Promise<void> = Promise.resolve()

  function deriveCanvas() {
    return projectCanvas(projection, layout, { issues, stale, readOnly: readOnly || transitionLocked })
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
    if (readOnly || stale || transitionLocked) return
    moveCanvasPosition(detail.id, detail.position)
  }

  function handleDragStop(detail: CanvasDragDetail): void {
    if (readOnly || stale || transitionLocked) return
    moveCanvasPosition(detail.id, detail.position)
    schedulePersist(layoutWithPositions())
  }

  export function arrange(): void {
    if (readOnly || stale || transitionLocked) return
    const projected = projectCanvas(projection, layout, { issues, arrange: true })
    flowNodes = projected.nodes
    flowEdges = projected.edges
    replaceCanvasPositions(projected.positions)
    schedulePersist(layoutWithPositions())
  }

  function nodeIds(): readonly string[] {
    return projection.nodes.map(({ id }) => id)
  }

  function validEdgeTargets(sourceId: string): readonly string[] {
    const existing = projection.edges.map(({ source, target }) => `${source}\0${target}`)
    const downstream: Record<string, string[]> = {}
    for (const edge of projection.edges) (downstream[edge.source] ??= []).push(edge.target)
    const reachesSource = (candidate: string, visited: readonly string[] = []): boolean => {
      if (candidate === sourceId) return true
      if (visited.includes(candidate)) return false
      return (downstream[candidate] ?? []).some((next) => reachesSource(next, [...visited, candidate]))
    }
    return nodeIds().filter(
      (target) => target !== sourceId && !existing.includes(`${sourceId}\0${target}`) && !reachesSource(target),
    )
  }

  export function requestEdge(): void {
    const sourceId = selection.length === 1 ? selection[0] : null
    if (!canAuthor() || !sourceId) {
      authoringFeedback = 'Select one node before creating a dependency edge.'
      return
    }
    edgeSourceId = sourceId
    edgeTargetIndex = 0
    const targets = validEdgeTargets(sourceId)
    authoringFeedback = targets.length
      ? 'Choose a valid dependency target.'
      : 'No valid dependency targets are available.'
    root?.focus()
  }

  function cancelEdge(): boolean {
    if (!edgeSourceId) return false
    edgeSourceId = null
    edgeTargetIndex = 0
    authoringFeedback = 'Edge creation cancelled.'
    return true
  }

  async function commitEdgeTarget(targetId: string | undefined): Promise<void> {
    const sourceId = edgeSourceId
    if (!sourceId || !targetId || !validEdgeTargets(sourceId).includes(targetId)) {
      authoringFeedback = 'That target would create an invalid dependency edge.'
      return
    }
    await handleAuthoringResult(
      onConnect
        ? () => onConnect(sourceId, targetId)
        : () => ({ status: 'rejected', code: 'canvas_action_unavailable', message: 'Connect is unavailable.' }),
    )
    edgeSourceId = null
    edgeTargetIndex = 0
  }

  function handleEdgeKeydown(event: KeyboardEvent): void {
    if (!edgeSourceId) return
    const targets = validEdgeTargets(edgeSourceId)
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdge()
      return
    }
    if (!targets.length) return
    if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
      event.preventDefault()
      edgeTargetIndex =
        (edgeTargetIndex +
          (event.shiftKey || event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) +
          targets.length) %
        targets.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void commitEdgeTarget(targets[edgeTargetIndex])
    }
  }

  export function cancel(): void {
    if (cancelEdge()) return
    selectionChanged([])
  }

  export function selectAll(): void {
    if (!transitionLocked) selectionChanged(nodeIds())
  }

  export function nudge(larger: boolean, direction: 'up' | 'down' | 'left' | 'right'): void {
    if (!canAuthor() || selection.length === 0) return
    const amount = larger ? 20 : 5
    const delta =
      direction === 'up'
        ? { x: 0, y: -amount }
        : direction === 'down'
          ? { x: 0, y: amount }
          : direction === 'left'
            ? { x: -amount, y: 0 }
            : { x: amount, y: 0 }
    for (const id of selection) {
      const position = canvasPositionsStore.get()[id]
      if (position) moveCanvasPosition(id, { x: position.x + delta.x, y: position.y + delta.y })
    }
    schedulePersist(layoutWithPositions())
  }

  export function zoomIn(): void {
    flowViewport = { ...flowViewport, zoom: Math.min(4, flowViewport.zoom * 1.2) }
  }
  export function zoomOut(): void {
    flowViewport = { ...flowViewport, zoom: Math.max(0.1, flowViewport.zoom / 1.2) }
  }
  export function actualSize(): void {
    flowViewport = { ...flowViewport, zoom: 1 }
  }
  export function fitGraph(): void {
    flowViewport = { ...flowViewport, x: 0, y: 0, zoom: 1 }
  }
  export function fitSelection(): void {
    fitGraph()
  }
  export function openInspector(): void {
    authoringFeedback = 'Inspector opened for the selected node.'
  }

  function viewportChanged(viewport: Viewport): void {
    if (readOnly || stale || transitionLocked) return
    schedulePersist({ ...layoutWithPositions(), viewport: { ...viewport } })
  }

  function selectionChanged(ids: readonly string[]): void {
    if (transitionLocked) return
    setCanvasSelection(ids)
    selection = [...ids]
  }

  function canAuthor(): boolean {
    return !readOnly && !stale && !transitionLocked
  }

  function viewportCenter(): { x: number; y: number } {
    const zoom = flowViewport.zoom || 1
    return {
      x: (root.clientWidth / 2 - flowViewport.x) / zoom,
      y: (root.clientHeight / 2 - flowViewport.y) / zoom,
    }
  }

  async function handleAuthoringResult(
    operation: (() => CanvasAuthoringFeedback | Promise<CanvasAuthoringFeedback>) | undefined,
  ): Promise<void> {
    if (!canAuthor() || !operation) return
    const result = await operation()
    if (!result) {
      authoringFeedback = 'The canvas action did not return a result.'
      return
    }
    authoringFeedback = result.status === 'committed' ? '' : (result.message ?? 'The canvas action was rejected.')
  }

  export function requestAdd(afterNodeId?: string): void {
    if (!canAuthor() || !onRequestAdd) return
    void onRequestAdd({ ...(afterNodeId ? { afterNodeId } : {}), viewportCenter: viewportCenter() })
  }

  function requestDuplicate(): void {
    if (selection.length === 0) return
    void handleAuthoringResult(
      onDuplicate
        ? () => onDuplicate(selection)
        : () => ({ status: 'rejected', code: 'canvas_action_unavailable', message: 'Duplicate is unavailable.' }),
    )
  }

  function requestDelete(): void {
    if (!canAuthor() || selection.length === 0) return
    void onRequestDelete?.(selection)
  }

  async function beforeDelete(
    nodes: readonly { readonly id: string }[],
    edges: readonly { readonly source: string; readonly target: string }[],
  ): Promise<boolean> {
    if (!canAuthor()) return false
    if (nodes.length > 0) {
      await onRequestDelete?.(nodes.map(({ id }) => id))
      return false
    }
    for (const edge of edges) {
      await handleAuthoringResult(
        onDisconnect
          ? () => onDisconnect(edge.source, edge.target)
          : () => ({ status: 'rejected', code: 'canvas_action_unavailable', message: 'Disconnect is unavailable.' }),
      )
    }
    return false
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
    root.tabIndex = 0
    const drag = (event: Event) => handleDrag((event as CustomEvent<CanvasDragDetail>).detail)
    const stop = (event: Event) => handleDragStop((event as CustomEvent<CanvasDragDetail>).detail)
    const connect = (event: Event) => {
      const detail = (event as CustomEvent<{ source: string; target: string }>).detail
      void handleAuthoringResult(
        onConnect
          ? () => onConnect(detail.source, detail.target)
          : () => ({ status: 'rejected', code: 'canvas_action_unavailable', message: 'Connect is unavailable.' }),
      )
    }
    const disconnect = (event: Event) => {
      const detail = (event as CustomEvent<{ source: string; target: string }>).detail
      void handleAuthoringResult(
        onDisconnect
          ? () => onDisconnect(detail.source, detail.target)
          : () => ({ status: 'rejected', code: 'canvas_action_unavailable', message: 'Disconnect is unavailable.' }),
      )
    }
    const beforeDeleteEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          nodes: readonly { id: string }[]
          edges: readonly { source: string; target: string }[]
        }>
      ).detail
      void beforeDelete(detail.nodes, detail.edges)
    }
    root.addEventListener('workflowdragmove', drag)
    root.addEventListener('workflowdragstop', stop)
    root.addEventListener('workflowconnect', connect)
    root.addEventListener('workflowdisconnect', disconnect)
    root.addEventListener('workflowbeforedelete', beforeDeleteEvent)
    root.addEventListener('keydown', handleEdgeKeydown)
    const unsubscribeSelection = canvasSelectionStore.subscribe((ids) => {
      selection = [...ids]
    })
    return () => {
      root.removeEventListener('workflowdragmove', drag)
      root.removeEventListener('workflowdragstop', stop)
      root.removeEventListener('workflowconnect', connect)
      root.removeEventListener('workflowdisconnect', disconnect)
      root.removeEventListener('workflowbeforedelete', beforeDeleteEvent)
      root.removeEventListener('keydown', handleEdgeKeydown)
      unsubscribeSelection()
    }
  })

  onDestroy(() => {
    void flushPersistence().catch(onPersistenceError)
  })
</script>

<section
  class="graph-canvas"
  data-testid="workflow-canvas"
  aria-label="Workflow graph"
  aria-busy={transitionLocked}
  bind:this={root}
>
  <div class="canvas-toolbar" aria-label="Canvas tools">
    <button type="button" aria-label="Add node" disabled={!canAuthor()} onclick={() => requestAdd()}>
      <Plus size={15} aria-hidden="true" />
      Add
    </button>
    <button
      type="button"
      aria-label="Create dependency edge"
      disabled={!canAuthor() || selection.length !== 1}
      onclick={requestEdge}
    >
      <Link size={15} aria-hidden="true" />
      Edge
    </button>
    <button
      type="button"
      aria-label="Duplicate selection"
      disabled={!canAuthor() || selection.length === 0}
      onclick={requestDuplicate}
    >
      <Copy size={15} aria-hidden="true" />
      Duplicate
    </button>
    <button
      type="button"
      aria-label="Delete selection"
      disabled={!canAuthor() || selection.length === 0}
      onclick={requestDelete}
    >
      <Trash2 size={15} aria-hidden="true" />
      Delete
    </button>
    <button type="button" aria-label="Arrange graph" disabled={readOnly || stale || transitionLocked} onclick={arrange}>
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
    nodesDraggable={!readOnly && !stale && !transitionLocked}
    nodesConnectable={!readOnly && !stale && !transitionLocked}
    elementsSelectable={!transitionLocked}
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
    onselectionchange={({ nodes }) => selectionChanged(nodes.map(({ id }) => id))}
    onconnect={({ source, target }) => {
      if (source && target) {
        void handleAuthoringResult(
          onConnect
            ? () => onConnect(source, target)
            : () => ({ status: 'rejected', code: 'canvas_action_unavailable', message: 'Connect is unavailable.' }),
        )
      }
    }}
    onbeforedelete={({ nodes, edges }) => beforeDelete(nodes, edges)}
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
  {#if edgeSourceId}
    <div class="edge-picker" role="status" aria-live="polite">
      <strong>Create edge from {edgeSourceId}</strong>
      <p>Use Tab or arrows to choose a valid target, Enter to connect, Escape to cancel.</p>
      <div role="listbox" aria-label="Valid edge targets">
        {#each validEdgeTargets(edgeSourceId) as target, index (target)}
          <button
            type="button"
            role="option"
            aria-selected={index === edgeTargetIndex}
            onclick={() => void commitEdgeTarget(target)}>{target}</button
          >
        {:else}
          <p>No valid targets; existing dependencies and cycles are blocked.</p>
        {/each}
      </div>
    </div>
  {/if}
  <p class="sr-only" role="status" aria-label="Canvas authoring feedback" aria-live="polite">
    {authoringFeedback}
  </p>
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

  .edge-picker {
    position: absolute;
    z-index: 7;
    top: 3.3rem;
    right: 0.625rem;
    max-width: 20rem;
    padding: 0.65rem;
    border: 1px solid var(--color-focus);
    border-radius: 0.45rem;
    background: var(--color-surface);
  }
  .edge-picker p {
    margin: 0.3rem 0;
    font-size: 0.75rem;
  }
  .edge-picker [role='option'] {
    display: block;
    width: 100%;
    text-align: left;
  }
  .edge-picker [aria-selected='true'] {
    background: var(--color-node-selected);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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
