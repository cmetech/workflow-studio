<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import GraphCanvas from './GraphCanvas.svelte'

  let { canvasProps }: { canvasProps: ComponentProps<typeof GraphCanvas> } = $props()
  let inspectorExpanded = $state(false)
</script>

<GraphCanvas
  {...canvasProps}
  inspectorControls="workflow-inspector"
  {inspectorExpanded}
  onOpenInspector={() => (inspectorExpanded = true)}
/>
