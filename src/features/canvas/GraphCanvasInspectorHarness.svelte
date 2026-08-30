<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import GraphCanvas from './GraphCanvas.svelte'

  let { canvasProps }: { canvasProps: ComponentProps<typeof GraphCanvas> } = $props()
  let inspectorExpanded = $state(false)
</script>

<button type="button" aria-label="Toggle test inspector" onclick={() => (inspectorExpanded = !inspectorExpanded)}>
  Toggle inspector
</button>
<GraphCanvas {...canvasProps} inspectorControls="workflow-inspector" {inspectorExpanded} />
