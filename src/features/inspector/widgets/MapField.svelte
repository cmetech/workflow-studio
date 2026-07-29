<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import StructuredFieldShell from './StructuredFieldShell.svelte'
  let props: WidgetProps = $props()
</script>

<StructuredFieldShell {...props} />
