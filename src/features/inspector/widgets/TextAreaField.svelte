<script lang="ts">
  import { untrack } from 'svelte'
  import type { WidgetProps } from '$src/lib/forms/types'
  import FieldDiagnostics from './FieldDiagnostics.svelte'
  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  const initialDraft = untrack(() => normalizeDraft(value))
  let authoritativeDraft = $state(initialDraft)
  let draft = $state(initialDraft)
  const descriptionId = $derived(`${field.id}-description`)
  const issueId = $derived(`${field.id}-issue`)
  const invalid = $derived(issues.length > 0)

  $effect(() => {
    const next = normalizeDraft(value)
    if (next === authoritativeDraft) return
    authoritativeDraft = next
    draft = next
  })

  function normalizeDraft(input: unknown): string {
    return input === undefined ? '' : String(input)
  }
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span class="required-indicator"> Required</span>{/if}</label
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
    color: var(--color-error);
  }
</style>
