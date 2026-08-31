<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte'
  import { Background, BackgroundVariant, SelectionMode, SvelteFlow, type Viewport } from '@xyflow/svelte'
  import '@xyflow/svelte/dist/style.css'
  import type { CommandSurface } from '$src/lib/commands/registry'
  import { resolveCommand, type ResolvedCommand } from '$src/lib/commands/surface'
  import type { CommandContext, CommandExecutionResult } from '$src/lib/commands/types'
  import type { LayoutRecordV1 } from '$src/lib/layout/types'
  import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
  import type { ValidationIssue } from '$src/lib/documents/types'
  import type { WorkflowProjection } from '$src/lib/projection/types'
  import {
    $canvasPositions as canvasPositionsStore,
    $canvasSelection as canvasSelectionStore,
    moveCanvasPositions,
    replaceCanvasPositions,
    setCanvasSelection,
  } from '$src/stores/canvas'
  import { createMemoizedCanvasProjector, projectCanvas } from './project-canvas'
  import { CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH } from './layout-graph'
  import {
    CANVAS_INSPECTOR_RELATIONSHIP,
    type CanvasDragDetail,
    type CanvasEdge,
    type CanvasInspectorRelationship,
    type CanvasNode,
    type CanvasPosition,
  } from './types'
  import { NODE_KIND_DRAG_TYPE } from './node-kind-options'
  import { createCanvasSelectionReconciler } from './reconcile-canvas-selection'
  import { shouldRefreshCanvasProjection, type CanvasProjectionRefreshSnapshot } from './canvas-projection-refresh'
  import CanvasToolbar from './CanvasToolbar.svelte'
  import WorkflowEdge from './WorkflowEdge.svelte'
  import WorkflowNode from './WorkflowNode.svelte'

  export interface CanvasAuthoringFeedback {
    readonly status: 'committed' | 'rejected' | 'resolution_required'
    readonly code?: string
    readonly message?: string
  }

  interface Props {
    commandSurface: CommandSurface
    projection: WorkflowProjection
    layout: LayoutRecordV1
    workflowIdentity?: string
    transitionLocked?: boolean
    surfaceActive?: boolean
    issues?: readonly ValidationIssue[]
    stale?: boolean
    staleSource?: 'current' | 'retained' | null
    readOnly?: boolean
    inspectorControls?: string
    inspectorExpanded?: boolean
    onPersistLayout?: (layout: LayoutRecordV1) => void | Promise<void>
    onPersistenceError?: (error: unknown) => void
    onConnect?: (sourceId: string, targetId: string) => CanvasAuthoringFeedback | Promise<CanvasAuthoringFeedback>
    onDisconnect?: (sourceId: string, targetId: string) => CanvasAuthoringFeedback | Promise<CanvasAuthoringFeedback>
    onRequestAdd?: (request: {
      readonly afterNodeId?: string
      readonly viewportCenter: { readonly x: number; readonly y: number }
    }) => void | Promise<void>
    onRequestDelete?: (nodeIds: readonly string[]) => unknown | Promise<unknown>
    onOpenInspector?: () => void
    onToggleInspector?: (expanded: boolean, invoker: HTMLElement) => void | Promise<void>
    onDropNodeKind?: (kind: string, position: { readonly x: number; readonly y: number }) => void | Promise<void>
  }

  let {
    commandSurface,
    projection,
    layout,
    workflowIdentity = `${layout.workspaceId}\0${layout.workflowPath}`,
    transitionLocked = false,
    surfaceActive = true,
    issues = [],
    stale = false,
    staleSource = stale ? 'retained' : null,
    readOnly = false,
    inspectorControls,
    inspectorExpanded = false,
    onPersistLayout = () => undefined,
    onPersistenceError = () => undefined,
    onConnect,
    onDisconnect,
    onRequestAdd,
    onRequestDelete,
    onOpenInspector,
    onToggleInspector,
    onDropNodeKind,
  }: Props = $props()

  const nodeTypes = { workflow: WorkflowNode }
  const edgeTypes = { workflow: WorkflowEdge }
  const projectMemoizedCanvas = createMemoizedCanvasProjector()
  const reconcileSelection = createCanvasSelectionReconciler()
  const inspectorRelationship: CanvasInspectorRelationship = {
    controls: () => inspectorControls,
    expanded: () => inspectorExpanded,
    toggle: (nodeId, invoker) => {
      if (inspectorExpanded && selection.includes(nodeId)) {
        void onToggleInspector?.(false, invoker)
        return
      }
      selectionChanged([nodeId])
      if (onToggleInspector) void onToggleInspector(true, invoker)
      else onOpenInspector?.()
    },
  }
  setContext(CANVAS_INSPECTOR_RELATIONSHIP, inspectorRelationship)
  const initialProjection = deriveCanvas()
  let flowNodes = $state.raw<CanvasNode[]>(withAuthoritativeSelection(initialProjection.nodes))
  let flowEdges = $state.raw<CanvasEdge[]>(initialProjection.edges)
  let flowViewport = $state.raw<Viewport>({ x: 0, y: 0, zoom: 1 })
  let restoredWorkflowIdentity = $state<string | null>(null)
  let selection = $state<readonly string[]>(canvasSelectionStore.get())
  let authoringFeedback = $state('')
  let edgeSourceId = $state<string | null>(null)
  let edgeTargetIndex = $state(0)
  let reducedMotion = $state(false)
  let root: HTMLElement
  let viewportElement: HTMLElement
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let pendingLayout: LayoutRecordV1 | null = null
  let persistenceQueue: Promise<void> = Promise.resolve()
  let pendingSelection: readonly string[] | null = null
  let selectionPublicationQueued = false
  let canvasMounted = false
  let surfaceWasInactive = false
  let restoringSurfaceSelection = false
  let previousProjectionRefresh: CanvasProjectionRefreshSnapshot | undefined
  const canvasCommandContext = $derived.by<CommandContext>(() => ({
    surface: 'canvas',
    canMutate: canAuthor(),
    hasSelection: selection.length > 0,
    selectionCount: selection.length,
  }))
  const addCommand = $derived(resolveCommand(commandSurface, 'canvas.add-node', canvasCommandContext))
  const edgeCommand = $derived(resolveCommand(commandSurface, 'canvas.create-edge', canvasCommandContext))
  const duplicateCommand = $derived(resolveCommand(commandSurface, 'canvas.duplicate-selection', canvasCommandContext))
  const deleteCommand = $derived(resolveCommand(commandSurface, 'canvas.delete-selection', canvasCommandContext))
  const arrangeCommand = $derived(resolveCommand(commandSurface, 'canvas.arrange', canvasCommandContext))
  const zoomInCommand = $derived(resolveCommand(commandSurface, 'canvas.zoom-in', canvasCommandContext))
  const zoomOutCommand = $derived(resolveCommand(commandSurface, 'canvas.zoom-out', canvasCommandContext))
  const actualSizeCommand = $derived(resolveCommand(commandSurface, 'canvas.actual-size', canvasCommandContext))
  const fitGraphCommand = $derived(resolveCommand(commandSurface, 'canvas.fit-graph', canvasCommandContext))
  const toolbarCommands = $derived.by<readonly ResolvedCommand[]>(() =>
    [
      addCommand,
      edgeCommand,
      duplicateCommand,
      deleteCommand,
      arrangeCommand,
      zoomInCommand,
      zoomOutCommand,
      actualSizeCommand,
      fitGraphCommand,
    ].filter((command): command is ResolvedCommand => command !== undefined),
  )

  function executeToolbar(
    command: { readonly id: string; readonly enabled: boolean } | undefined,
  ): Promise<CommandExecutionResult> | undefined {
    if (!command?.enabled) return undefined
    return commandSurface.executeCommand(command.id, canvasCommandContext)
  }

  function executeToolbarId(id: string): Promise<CommandExecutionResult> | undefined {
    return executeToolbar(toolbarCommands.find((command) => command.id === id))
  }

  function deriveCanvas() {
    return projectMemoizedCanvas(projection, layout, { issues, stale, readOnly: readOnly || transitionLocked })
  }

  $effect(() => {
    if (!surfaceActive) return
    const nextRefresh: CanvasProjectionRefreshSnapshot = {
      projection,
      issues,
      workflowIdentity,
      stale,
      readOnly,
      transitionLocked,
    }
    if (
      !shouldRefreshCanvasProjection(
        previousProjectionRefresh,
        nextRefresh,
        layout.nodePositions,
        canvasPositionsStore.get(),
      )
    ) {
      return
    }
    const projected = deriveCanvas()
    flowNodes = withAuthoritativeSelection(projected.nodes)
    flowEdges = projected.edges
    replaceCanvasPositions(projected.positions)
    previousProjectionRefresh = nextRefresh
  })

  $effect(() => {
    if (!surfaceActive) {
      surfaceWasInactive = true
      restoringSurfaceSelection = false
      return
    }
    if (!surfaceWasInactive) return
    surfaceWasInactive = false
    restoringSurfaceSelection = canvasSelectionStore.get().length > 0
    restoreSurfaceSelection()
  })

  $effect(() => {
    if (workflowIdentity === restoredWorkflowIdentity) return
    restoredWorkflowIdentity = workflowIdentity
    flowViewport = { ...layout.viewport }
  })

  function handleDrag(detail: CanvasDragDetail): void {
    recordEditorMetric('pointerMoves')
    if (readOnly || stale || transitionLocked) return
    moveCanvasPositions(draggedPositions(detail))
  }

  function handleDragStop(detail: CanvasDragDetail): void {
    recordEditorMetric('dragCompletions')
    if (readOnly || stale || transitionLocked) return
    const updates = draggedPositions(detail)
    if (updates.length === 0) return
    moveCanvasPositions(updates)
    schedulePersist(layoutWithPositions())
  }

  function draggedPositions(
    detail: CanvasDragDetail,
  ): readonly { readonly id: string; readonly position: CanvasPosition }[] {
    if (detail.nodes) return detail.nodes
    return detail.id && detail.position ? [{ id: detail.id, position: detail.position }] : []
  }

  function dragDetail(
    nodes: readonly { readonly id: string; readonly position: CanvasPosition }[],
    targetNode?: { readonly id: string; readonly position: CanvasPosition } | null,
  ): CanvasDragDetail {
    const updates = nodes.map(({ id, position }) => ({ id, position }))
    if (targetNode && !updates.some(({ id }) => id === targetNode.id)) {
      updates.push({ id: targetNode.id, position: targetNode.position })
    }
    return { nodes: updates }
  }

  export function arrange(): void {
    if (readOnly || stale || transitionLocked) return
    const projected = projectCanvas(projection, layout, { issues, arrange: true })
    flowNodes = withAuthoritativeSelection(projected.nodes)
    flowEdges = projected.edges
    replaceCanvasPositions(projected.positions)
    schedulePersist(layoutWithPositions())
  }

  function withAuthoritativeSelection(nodes: readonly CanvasNode[]): CanvasNode[] {
    const currentSelection = canvasSelectionStore.get()
    const reconciled = reconcileSelection(nodes, currentSelection)
    if (reconciled.selection.length !== currentSelection.length) setCanvasSelection(reconciled.selection)
    return reconciled.nodes
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
      : 'No valid dependency targets are available; connecting to an upstream node would create a cycle.'
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
    const positions = canvasPositionsStore.get()
    const updates = selection.flatMap((id) => {
      const position = positions[id]
      return position ? [{ id, position: { x: position.x + delta.x, y: position.y + delta.y } }] : []
    })
    if (updates.length === 0) return
    const nudgedPositions = new Map(updates.map(({ id, position }) => [id, position]))
    flowNodes = flowNodes.map((node) => {
      const position = nudgedPositions.get(node.id)
      return position ? { ...node, position: { ...position } } : node
    })
    moveCanvasPositions(updates)
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
    fitNodes(flowNodes.map(({ id }) => id))
  }
  export function fitSelection(): void {
    fitNodes(selection)
  }
  export function openInspector(): void {
    onOpenInspector?.()
  }

  function fitNodes(ids: readonly string[]): void {
    const nodes = flowNodes.filter((node) => ids.includes(node.id))
    if (!nodes.length) return
    const left = Math.min(...nodes.map(({ position }) => position.x))
    const top = Math.min(...nodes.map(({ position }) => position.y))
    const right = Math.max(...nodes.map(({ position }) => position.x + CANVAS_NODE_WIDTH))
    const bottom = Math.max(...nodes.map(({ position }) => position.y + CANVAS_NODE_HEIGHT))
    const width = Math.max(1, right - left)
    const height = Math.max(1, bottom - top)
    const zoom = Math.max(
      0.1,
      Math.min(4, Math.min(viewportElement.clientWidth / (width + 48), viewportElement.clientHeight / (height + 48))),
    )
    flowViewport = {
      x: (viewportElement.clientWidth - width * zoom) / 2 - left * zoom,
      y: (viewportElement.clientHeight - height * zoom) / 2 - top * zoom,
      zoom,
    }
  }

  function viewportChanged(viewport: Viewport): void {
    if (readOnly || stale || transitionLocked) return
    schedulePersist({ ...layoutWithPositions(), viewport: { ...viewport } })
  }

  function selectionChanged(ids: readonly string[]): void {
    if (transitionLocked || !surfaceActive) return
    if (restoringSurfaceSelection && ids.length === 0 && canvasSelectionStore.get().length > 0) {
      restoreSurfaceSelection()
      return
    }
    setCanvasSelection(ids)
    selection = [...ids]
  }

  function restoreSurfaceSelection(): void {
    const selectedIds = new Set(canvasSelectionStore.get())
    flowNodes = flowNodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) }))
    selection = [...selectedIds]
  }

  function resumeSelectionPublication(): void {
    restoringSurfaceSelection = false
  }

  function scheduleSelectionChanged(ids: readonly string[]): void {
    if (transitionLocked || !surfaceActive) return
    pendingSelection = [...ids]
    if (selectionPublicationQueued) return
    selectionPublicationQueued = true
    queueMicrotask(() => {
      selectionPublicationQueued = false
      const next = pendingSelection
      pendingSelection = null
      if (canvasMounted && surfaceActive && next) selectionChanged(next)
    })
  }

  function canAuthor(): boolean {
    return !readOnly && !stale && !transitionLocked
  }

  export function viewportCenterPosition(): { x: number; y: number } {
    const zoom = flowViewport.zoom || 1
    return {
      x: (viewportElement.clientWidth / 2 - flowViewport.x) / zoom,
      y: (viewportElement.clientHeight / 2 - flowViewport.y) / zoom,
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
    void onRequestAdd({ ...(afterNodeId ? { afterNodeId } : {}), viewportCenter: viewportCenterPosition() })
  }

  function acceptsNodeDrop(event: DragEvent): boolean {
    return (
      canAuthor() && Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes(NODE_KIND_DRAG_TYPE))
    )
  }

  function dragNodeKindOver(event: DragEvent): void {
    if (!acceptsNodeDrop(event) || !event.dataTransfer) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function dropNodeKind(event: DragEvent): void {
    if (!acceptsNodeDrop(event) || !event.dataTransfer || !onDropNodeKind) return
    const kind = event.dataTransfer.getData(NODE_KIND_DRAG_TYPE)
    if (!kind) return
    event.preventDefault()
    const bounds = viewportElement.getBoundingClientRect()
    const zoom = flowViewport.zoom || 1
    void onDropNodeKind(kind, {
      x: (event.clientX - bounds.left - flowViewport.x) / zoom,
      y: (event.clientY - bounds.top - flowViewport.y) / zoom,
    })
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
    const operation = persistenceQueue
      .catch(() => undefined)
      .then(() => {
        recordEditorMetric('layoutSaves')
        return onPersistLayout(next)
      })
    persistenceQueue = operation
    return operation
  }

  onMount(() => {
    canvasMounted = true
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
    const selectionEvent = (event: Event) => {
      const ids = (event as CustomEvent<{ readonly ids: readonly string[] }>).detail.ids
      scheduleSelectionChanged(ids)
    }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionChanged = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches
    }
    reducedMotion = motionQuery.matches
    root.addEventListener('workflowdragmove', drag)
    root.addEventListener('workflowdragstop', stop)
    root.addEventListener('workflowconnect', connect)
    root.addEventListener('workflowdisconnect', disconnect)
    root.addEventListener('workflowbeforedelete', beforeDeleteEvent)
    root.addEventListener('workflowselectionchange', selectionEvent)
    root.addEventListener('pointerdown', resumeSelectionPublication, true)
    root.addEventListener('keydown', resumeSelectionPublication, true)
    root.addEventListener('keydown', handleEdgeKeydown)
    motionQuery.addEventListener?.('change', motionChanged)
    const unsubscribeSelection = canvasSelectionStore.subscribe((ids) => {
      selection = [...ids]
    })
    return () => {
      canvasMounted = false
      root.removeEventListener('workflowdragmove', drag)
      root.removeEventListener('workflowdragstop', stop)
      root.removeEventListener('workflowconnect', connect)
      root.removeEventListener('workflowdisconnect', disconnect)
      root.removeEventListener('workflowbeforedelete', beforeDeleteEvent)
      root.removeEventListener('workflowselectionchange', selectionEvent)
      root.removeEventListener('pointerdown', resumeSelectionPublication, true)
      root.removeEventListener('keydown', resumeSelectionPublication, true)
      root.removeEventListener('keydown', handleEdgeKeydown)
      motionQuery.removeEventListener?.('change', motionChanged)
      unsubscribeSelection()
    }
  })

  onDestroy(() => {
    void flushPersistence().catch(onPersistenceError)
  })
</script>

<section
  class="graph-canvas"
  class:canvas-transitions={!reducedMotion}
  data-testid="workflow-canvas"
  data-motion={reducedMotion ? 'reduced' : 'full'}
  data-keyboard-viewport-focus="instant"
  aria-label="Workflow graph"
  aria-busy={transitionLocked}
  bind:this={root}
>
  <CanvasToolbar commands={toolbarCommands} onExecute={executeToolbarId} />

  {#if stale}
    <div class="stale-overlay" role="status" data-canvas-chrome>
      {staleSource === 'current'
        ? 'Current graph shown read-only while current YAML has structural errors.'
        : 'Last valid graph shown read-only while current YAML has structural errors.'}
    </div>
  {/if}
  {#if edgeSourceId}
    <div class="edge-picker" role="status" aria-live="polite" data-canvas-chrome>
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
  <div
    class="canvas-viewport"
    data-testid="workflow-canvas-viewport"
    role="region"
    aria-label="Workflow canvas viewport"
    bind:this={viewportElement}
    ondragover={dragNodeKindOver}
    ondrop={dropNodeKind}
  >
    <SvelteFlow
      bind:nodes={flowNodes}
      bind:edges={flowEdges}
      bind:viewport={flowViewport}
      {nodeTypes}
      {edgeTypes}
      nodesDraggable={!readOnly && !stale && !transitionLocked}
      nodesConnectable={!readOnly && !stale && !transitionLocked}
      elementsSelectable={!transitionLocked}
      onlyRenderVisibleElements={true}
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
        handleDrag(dragDetail(nodes, targetNode))
      }}
      onnodedragstop={({ targetNode, nodes }) => {
        handleDragStop(dragDetail(nodes, targetNode))
      }}
      onselectionchange={({ nodes }) => scheduleSelectionChanged(nodes.map(({ id }) => id))}
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
    </SvelteFlow>
  </div>
  <p class="sr-only" role="status" aria-label="Canvas authoring feedback" aria-live="polite">
    {authoringFeedback}
  </p>
</section>

<style>
  .graph-canvas {
    position: relative;
    container-type: size;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--color-canvas);
  }

  .canvas-viewport {
    position: relative;
    grid-row: 4;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .graph-canvas:focus {
    z-index: 1;
    outline: 3px solid var(--color-focus);
    outline-offset: -3px;
  }

  :global(.graph-canvas .svelte-flow) {
    --xy-edge-stroke: var(--color-edge);
    --xy-edge-stroke-selected: var(--color-edge-selected);
    background-image: radial-gradient(var(--color-grid) 1px, transparent 1px);
    background-size: 1.25rem 1.25rem;
  }

  .stale-overlay {
    position: static;
    grid-row: 2;
    justify-self: end;
    max-width: 24rem;
    margin: 0.5rem 0.625rem 0;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--color-warning);
    border-radius: 0.45rem;
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 94%, transparent);
    font-size: 0.72rem;
  }

  .edge-picker {
    position: static;
    grid-row: 3;
    justify-self: end;
    max-width: 20rem;
    margin: 0.5rem 0.625rem 0;
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
      transition: none !important;
      animation: none !important;
    }
  }
</style>
