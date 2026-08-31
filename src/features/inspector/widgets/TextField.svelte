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
    >{field.label}{#if field.required}<span class="required required-indicator"> Required</span>{/if}</label
  >
  <input
    id={field.id}
    type="text"
    bind:value={draft}
    {disabled}
    aria-required={field.required}
    aria-invalid={invalid}
    aria-describedby={`${descriptionId}${invalid ? ` ${issueId}` : ''}`}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void onCommit?.({ field, value: draft })
      }
    }}
  />
  <FieldDiagnostics {field} {issues} />
  <div class="field-actions">
    <button type="button" {disabled} onclick={() => void onCommit?.({ field, value: draft })}
      >Apply {field.label}</button
    >
  </div>
</div>

<style>
  label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.75rem;
  }
  input {
    width: 100%;
  }
  .required {
    color: var(--color-error);
  }
  .field-actions {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.35rem;
  }
</style>
