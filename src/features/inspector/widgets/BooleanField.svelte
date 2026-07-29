<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, present, disabled = false, onCommit }: WidgetProps = $props()
</script>

<div class="field-control">
  <label
    ><input
      type="checkbox"
      checked={value === true}
      {disabled}
      aria-describedby={`${field.id}-description`}
      onchange={(event) => void onCommit?.({ field, value: event.currentTarget.checked })}
    />
    {field.label}{#if field.required}<span> required</span>{/if}</label
  >
  <p id={`${field.id}-description`}>{field.description}</p>
  {#if !field.required && present}<button
      type="button"
      {disabled}
      onclick={() => void onCommit?.({ field, remove: true })}>Remove {field.label}</button
    >{/if}
</div>

<style>
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  span {
    color: var(--color-danger);
  }
</style>
