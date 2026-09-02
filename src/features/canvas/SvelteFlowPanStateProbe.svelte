<script lang="ts">
  import { useStore } from '@xyflow/svelte'

  const store = useStore()
</script>

<output data-testid="svelte-flow-pan-state" data-pan-activation-key-pressed={String(store.panActivationKeyPressed)}
></output>
