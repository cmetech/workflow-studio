<script lang="ts">
  import { BaseEdge, getSmoothStepPath } from '@xyflow/svelte'
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

  let path = $derived(
    getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 })[0],
  )
</script>

<path d={path} class="workflow-edge-focus-halo" fill="none" aria-hidden="true" />
<BaseEdge
  {id}
  {path}
  {markerEnd}
  interactionWidth={32}
  class={['workflow-edge', selected && 'selected', data?.stale && 'stale'].filter(Boolean).join(' ')}
/>

<style>
  :global(.workflow-edge-focus-halo) {
    stroke: transparent;
    stroke-width: 6;
    pointer-events: none;
  }

  :global(.svelte-flow__edge:focus-visible .workflow-edge-focus-halo) {
    stroke: var(--color-focus);
  }

  :global(.svelte-flow__edge-path.workflow-edge) {
    stroke: var(--color-edge);
    stroke-width: 2;
  }

  :global(.svelte-flow__edge:focus-visible .svelte-flow__edge-path.workflow-edge) {
    stroke: var(--color-focus-contrast);
  }

  :global(.svelte-flow__edge-path.workflow-edge.selected) {
    stroke: var(--color-edge-selected);
  }

  :global(.svelte-flow__edge-path.workflow-edge.stale) {
    stroke-dasharray: 5 4;
  }

  @media (forced-colors: active) {
    :global(.svelte-flow__edge:focus-visible .workflow-edge-focus-halo) {
      stroke: CanvasText;
    }

    :global(.svelte-flow__edge:focus-visible .svelte-flow__edge-path.workflow-edge) {
      stroke: Highlight;
    }
  }
</style>
