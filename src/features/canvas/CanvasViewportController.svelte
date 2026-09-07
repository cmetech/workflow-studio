<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte'

  const flow = useSvelteFlow()

  export function viewport() {
    return flow.getViewport()
  }

  export function fitGraph(): Promise<boolean> {
    // Measured nodes are already published. fitBounds applies the viewport before
    // yielding; fitView queues a later mutation that cannot be cancelled if stale.
    return flow.fitBounds(flow.getNodesBounds(flow.getNodes()), { padding: 0.18, duration: 0 })
  }
</script>
