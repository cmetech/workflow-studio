<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import GraphCanvas from './GraphCanvas.svelte'

  let { canvasProps }: { canvasProps: ComponentProps<typeof GraphCanvas> } = $props()
  let inspectorExpanded = $state(false)
  let inspector: HTMLElement

  $effect(() => {
    inspector?.toggleAttribute('inert', !inspectorExpanded)
  })
</script>

<GraphCanvas
  {...canvasProps}
  inspectorControls="workflow-inspector"
  {inspectorExpanded}
  onOpenInspector={() => (inspectorExpanded = true)}
  onToggleInspector={(expanded) => {
    inspectorExpanded = expanded
  }}
/>
<aside
  id="workflow-inspector"
  bind:this={inspector}
  aria-label="Test Inspector"
  aria-hidden={inspectorExpanded ? undefined : 'true'}
>
  Test Inspector
</aside>
