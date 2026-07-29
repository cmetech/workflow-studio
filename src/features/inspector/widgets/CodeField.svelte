<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, present, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  let draft = $derived(value === undefined ? '' : String(value))
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span> required</span>{/if}</label
  >
  <textarea
    id={field.id}
    class="code"
    bind:value={draft}
    {disabled}
    aria-required={field.required}
    aria-invalid={issues.length > 0}
    aria-describedby={`${field.id}-description`}></textarea>
  <p id={`${field.id}-description`}>{field.description}</p>
  <button type="button" {disabled} onclick={() => void onCommit?.({ field, value: draft })}>Apply {field.label}</button>
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
  .code {
    width: 100%;
    min-height: 5rem;
    font-family: ui-monospace, monospace;
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
