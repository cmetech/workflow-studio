<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, present, disabled = false, onCommit }: WidgetProps = $props()
  const options = $derived(field.constraints.enum ?? [])
  const selected = $derived(present ? String(options.findIndex((option) => sameValue(option, value))) : '__absent__')

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
    aria-describedby={`${field.id}-description`}
    onchange={(event) => {
      if (event.currentTarget.value === '__absent__') void onCommit?.({ field, remove: true })
      else void onCommit?.({ field, value: options[Number(event.currentTarget.value)] })
    }}
  >
    {#if !field.required}<option value="__absent__">Inherited / absent</option>{/if}
    {#each options as option, index (index)}<option value={String(index)}>{String(option)}</option>{/each}
  </select>
  <p id={`${field.id}-description`}>{field.description}</p>
</div>

<style>
  label {
    display: block;
  }
  select {
    width: 100%;
  }
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  span {
    color: var(--color-danger);
  }
</style>
