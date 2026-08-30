<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import { validateSchemaValue } from '$src/lib/forms/structured-draft'
  import FieldDiagnostics from './FieldDiagnostics.svelte'
  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  let draft = $derived(value === undefined ? '' : String(value))
  let localErrors = $state<readonly string[]>([])
  const invalid = $derived(issues.length > 0 || localErrors.length > 0)

  function apply(): void {
    const number = Number(draft)
    localErrors = validateSchemaValue(number, field.schema, field.label)
    if (localErrors.length === 0) void onCommit?.({ field, value: number })
  }
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span class="required-indicator"> Required</span>{/if}</label
  >
  <div class="number">
    <input
      id={field.id}
      type="number"
      bind:value={draft}
      {disabled}
      min={field.constraints.minimum}
      max={field.constraints.maximum}
      aria-required={field.required}
      aria-invalid={invalid}
      aria-describedby={`${field.id}-description${invalid ? ` ${field.id}-issue` : ''}`}
    />{#if field.unit}<span class="unit">{field.unit}</span>{/if}
  </div>
  <FieldDiagnostics {field} {issues} {localErrors} />
  <button type="button" {disabled} onclick={apply}>Apply {field.label}</button>
</div>

<style>
  label {
    display: block;
  }
  .number {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  input {
    min-width: 0;
    flex: 1;
  }
  label span {
    color: var(--color-error);
  }
  .unit {
    color: var(--color-text-muted);
  }
</style>
