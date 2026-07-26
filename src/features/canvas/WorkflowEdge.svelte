<script lang="ts">
  import { BaseEdge, getSmoothStepPath } from '@xyflow/svelte'
  import type { CanvasEdgeData } from './types'

  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = $props<{
    id: string
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourcePosition: import('@xyflow/svelte').Position
    targetPosition: import('@xyflow/svelte').Position
    markerEnd?: string
    data?: CanvasEdgeData
  }>()

  let path = $derived(
    getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 })[0],
  )
</script>

<BaseEdge {id} {path} {markerEnd} interactionWidth={32} class={data?.stale ? 'workflow-edge stale' : 'workflow-edge'} />
