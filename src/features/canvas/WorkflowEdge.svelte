<script lang="ts">
  import { BaseEdge, getSmoothStepPath } from '@xyflow/svelte'
  import { roundedOrthogonalPath } from './edge-route-path'
  import type { CanvasEdgeData } from './types'

  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data } = $props<{
    id: string
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourcePosition: import('@xyflow/svelte').Position
    targetPosition: import('@xyflow/svelte').Position
    markerEnd?: string
    selected?: boolean
    data?: CanvasEdgeData
  }>()

  let routedPath = $derived(data?.route ? roundedOrthogonalPath(data.route.points) : '')
  let path = $derived(
    routedPath ||
      getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 })[0],
  )
</script>

<path d={path} class="workflow-edge-casing" fill="none" aria-hidden="true" />
<path d={path} class="workflow-edge-focus-halo" fill="none" aria-hidden="true" />
<BaseEdge
  {id}
  {path}
  {markerEnd}
  interactionWidth={32}
  class={[
    'workflow-edge',
    selected && 'selected',
    data?.stale && 'stale',
    data?.readOnly && 'read-only',
    data?.emphasized && 'emphasized',
    data?.deemphasized && 'deemphasized',
  ]
    .filter(Boolean)
    .join(' ')}
/>

<style>
  :global(.workflow-edge-casing) {
    stroke: var(--workflow-edge-casing-color, var(--color-canvas));
    stroke-width: 8;
    pointer-events: none;
  }

  :global(.workflow-edge-focus-halo) {
    stroke: transparent;
    stroke-width: 6;
    pointer-events: none;
  }

  :global(.svelte-flow__edge:focus-visible .workflow-edge-focus-halo) {
    stroke: var(--workflow-edge-focus-color, var(--color-focus));
  }

  :global(.svelte-flow__edge-path.workflow-edge) {
    stroke: var(--workflow-edge-normal-color, var(--color-edge));
    stroke-width: 2;
  }

  :global(.svelte-flow__edge-wrapper:has(.workflow-edge.emphasized)) {
    z-index: 2 !important;
  }

  :global(.svelte-flow__edge-path.workflow-edge.emphasized) {
    stroke-width: 3;
  }

  :global(.svelte-flow__edge-path.workflow-edge.deemphasized) {
    stroke-width: var(--workflow-edge-subdued-width, 1.5);
  }

  :global(.svelte-flow__edge:focus-visible .svelte-flow__edge-path.workflow-edge) {
    stroke: var(--workflow-edge-focus-contrast-color, var(--color-focus-contrast));
  }

  :global(.svelte-flow__edge-path.workflow-edge.selected) {
    stroke: var(--workflow-edge-selected-color, var(--color-edge-selected));
    stroke-width: 3;
  }

  :global(.svelte-flow__edge-path.workflow-edge.read-only:where(:not(.stale))) {
    opacity: 0.72;
  }

  :global(.svelte-flow__edge-path.workflow-edge.stale) {
    stroke-dasharray: 5 4;
  }

  @media (forced-colors: active) {
    :global(.workflow-edge-casing) {
      stroke: Canvas;
    }

    :global(.svelte-flow__edge-path.workflow-edge) {
      stroke: CanvasText;
    }

    :global(.svelte-flow__edge-path.workflow-edge.read-only:where(:not(.stale))) {
      stroke: GrayText;
      opacity: 1;
    }

    :global(.svelte-flow__edge-path.workflow-edge.deemphasized) {
      stroke: CanvasText;
      stroke-width: 1px;
    }

    :global(.svelte-flow__edge-path.workflow-edge.emphasized) {
      stroke: Highlight;
      stroke-width: 3;
    }

    :global(.svelte-flow__edge-path.workflow-edge.selected) {
      stroke: Highlight;
      stroke-width: 3;
    }

    :global(.svelte-flow__edge:focus-visible .workflow-edge-focus-halo) {
      stroke: CanvasText;
    }

    :global(.svelte-flow__edge:focus-visible .svelte-flow__edge-path.workflow-edge) {
      stroke: Highlight;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.workflow-edge-casing),
    :global(.workflow-edge-focus-halo),
    :global(.svelte-flow__edge-path.workflow-edge) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
