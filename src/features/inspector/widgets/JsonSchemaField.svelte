<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import StructuredFieldShell from './StructuredFieldShell.svelte'
  let props: WidgetProps = $props()
  const genericField = $derived(props.field.widget === 'json-schema' ? { ...props.field, schema: {} } : props.field)
  function commit(value: unknown): void {
    void props.onCommit?.({ field: props.field, value })
  }
</script>

<StructuredFieldShell {...props} field={genericField} onCommit={({ value }) => commit(value)} />
