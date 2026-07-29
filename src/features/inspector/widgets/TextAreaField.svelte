<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import FieldDiagnostics from './FieldDiagnostics.svelte'
  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  let draft = $derived(value === undefined ? '' : String(value))
  const descriptionId = $derived(`${field.id}-description`)
  const issueId = $derived(`${field.id}-issue`)
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
    aria-describedby={`${descriptionId}${invalid ? ` ${issueId}` : ''}`}></textarea>
  <FieldDiagnostics {field} {issues} />
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
  span {
    color: var(--color-danger);
  }
</style>
