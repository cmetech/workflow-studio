<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import FieldDiagnostics from './FieldDiagnostics.svelte'
  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  const invalid = $derived(issues.length > 0)
</script>

<div class="field-control">
  <label
    ><input
      id={field.id}
      type="checkbox"
      checked={value === true}
      {disabled}
      aria-required={field.required}
      aria-invalid={invalid}
      aria-describedby={`${field.id}-description${invalid ? ` ${field.id}-issue` : ''}`}
      onchange={(event) => void onCommit?.({ field, value: event.currentTarget.checked })}
    />
    {field.label}{#if field.required}<span class="required-indicator"> Required</span>{/if}</label
  >
  <FieldDiagnostics {field} {issues} />
</div>

<style>
  span {
    color: var(--color-error);
  }
</style>
