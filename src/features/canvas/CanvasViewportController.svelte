<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte'
  import type { LayoutWorkerBounds } from '$src/workers/layout-worker-protocol'

  const flow = useSvelteFlow()

  export function viewport() {
    return flow.getViewport()
  }

  export function fitGraph(bounds: LayoutWorkerBounds): Promise<boolean> {
    // Measured nodes are already published. fitBounds applies the viewport before
    // yielding; fitView queues a later mutation that cannot be cancelled if stale.
    return flow.fitBounds(bounds, { padding: 0.18, duration: 0 })
  }
</script>
