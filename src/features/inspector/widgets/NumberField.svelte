<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, present, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  let draft = $derived(value === undefined ? '' : String(value))
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span> required</span>{/if}</label
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
      aria-invalid={issues.length > 0}
      aria-describedby={`${field.id}-description`}
    />{#if field.unit}<span class="unit">{field.unit}</span>{/if}
  </div>
  <p id={`${field.id}-description`}>{field.description}</p>
  <button type="button" {disabled} onclick={() => void onCommit?.({ field, value: Number(draft) })}
    >Apply {field.label}</button
  >
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
  .number {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  input {
    min-width: 0;
    flex: 1;
  }
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  label span {
    color: var(--color-danger);
  }
  .unit {
    color: var(--color-text-muted);
  }
</style>
