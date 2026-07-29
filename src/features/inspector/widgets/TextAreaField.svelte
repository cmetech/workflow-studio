<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  let draft = $derived(value === undefined ? '' : String(value))
  const descriptionId = $derived(`${field.id}-description`)
  const invalid = $derived(issues.length > 0)
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span> required</span>{/if}</label
  >
  <textarea
    id={field.id}
    bind:value={draft}
    {disabled}
    aria-required={field.required}
    aria-invalid={invalid}
    aria-describedby={descriptionId}></textarea>
  <p id={descriptionId}>{field.description}</p>
  {#if invalid}<p class="issue">{issues.map(({ message }) => message).join(' ')}</p>{/if}
  <button type="button" {disabled} onclick={() => void onCommit?.({ field, value: draft })}>Apply {field.label}</button>
</div>

<style>
  label {
    display: block;
  }
  textarea {
    width: 100%;
    min-height: 5rem;
  }
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  .issue,
  span {
    color: var(--color-danger);
  }
</style>
