<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import FieldDiagnostics from './FieldDiagnostics.svelte'
  let { field, value, present, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  const options = $derived(field.constraints.enum ?? [])
  const selected = $derived(present ? String(options.findIndex((option) => sameValue(option, value))) : '__absent__')
  const invalid = $derived(issues.length > 0)

  function sameValue(left: unknown, right: unknown): boolean {
    return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)
  }
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span> required</span>{/if}</label
  >
  <select
    id={field.id}
    {disabled}
    value={selected}
    aria-required={field.required}
    aria-invalid={invalid}
    aria-describedby={`${field.id}-description${invalid ? ` ${field.id}-issue` : ''}`}
    onchange={(event) => {
      if (event.currentTarget.value === '__absent__') void onCommit?.({ field, remove: true })
      else void onCommit?.({ field, value: options[Number(event.currentTarget.value)] })
    }}
  >
    {#if !field.required}<option value="__absent__">Inherited / absent</option>{/if}
    {#each options as option, index (index)}<option value={String(index)}>{String(option)}</option>{/each}
  </select>
  <FieldDiagnostics {field} {issues} />
</div>

<style>
  label {
    display: block;
  }
  select {
    width: 100%;
  }
  span {
    color: var(--color-error);
  }
</style>
