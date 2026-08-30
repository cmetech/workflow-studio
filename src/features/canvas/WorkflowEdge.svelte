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

<BaseEdge
  {id}
  {path}
  {markerEnd}
  interactionWidth={32}
  class={['workflow-edge', selected && 'selected', data?.stale && 'stale'].filter(Boolean).join(' ')}
/>

<style>
  :global(.workflow-edge) {
    stroke: var(--color-edge);
    stroke-width: 2;
  }

  :global(.workflow-edge.selected) {
    stroke: var(--color-edge-selected);
  }

  :global(.workflow-edge.stale) {
    stroke-dasharray: 5 4;
    opacity: 0.72;
  }
</style>
