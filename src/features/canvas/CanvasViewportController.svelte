<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte'

  const flow = useSvelteFlow()

  export function viewport() {
    return flow.getViewport()
  }

  export function fitGraph(): Promise<boolean> {
    // An instant fit cannot keep animating after workflow/scope replacement.
    return flow.fitView({ padding: 0.18, duration: 0 })
  }
</script>
