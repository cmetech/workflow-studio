<script lang="ts">
  import { SvelteFlow } from '@xyflow/svelte'
  import { CANVAS_PAN_INTERACTION } from '$src/lib/commands/canvas-interactions'
  import SvelteFlowPanStateProbe from './SvelteFlowPanStateProbe.svelte'
</script>

<SvelteFlow nodes={[]} edges={[]} panActivationKey={CANVAS_PAN_INTERACTION.activationKey} panOnDrag={false}>
  <SvelteFlowPanStateProbe />
</SvelteFlow>
