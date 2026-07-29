<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, present, disabled = false, onCommit }: WidgetProps = $props()
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span> required</span>{/if}</label
  >
  <select
    id={field.id}
    {disabled}
    value={String(value ?? '')}
    aria-describedby={`${field.id}-description`}
    onchange={(event) => void onCommit?.({ field, value: event.currentTarget.value })}
  >
    {#if !field.required}<option value="">Inherited / absent</option>{/if}
    {#each field.constraints.enum ?? [] as option (String(option))}<option value={String(option)}
        >{String(option)}</option
      >{/each}
  </select>
  <p id={`${field.id}-description`}>{field.description}</p>
  {#if !field.required && present}<button
      type="button"
      {disabled}
      onclick={() => void onCommit?.({ field, remove: true })}>Remove {field.label}</button
    >{/if}
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
