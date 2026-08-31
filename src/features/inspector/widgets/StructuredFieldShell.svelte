<script lang="ts">
  import { untrack } from 'svelte'
  import type { WidgetProps } from '$src/lib/forms/types'
  import {
    createStructuredDraft,
    sameStructuredValue,
    structuredDraftValue,
    validateStructuredDraft,
  } from '$src/lib/forms/structured-draft'
  import FieldDiagnostics from './FieldDiagnostics.svelte'
  import StructuredValueEditor from './StructuredValueEditor.svelte'

  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  const initialDraft = untrack(() => createStructuredDraft(field.schema, value))
  let authoritativeValue = $state(untrack(() => structuredDraftValue(initialDraft)))
  let draft = $state(initialDraft)
  let errors = $state<readonly string[]>([])
  const invalid = $derived(issues.length > 0 || errors.length > 0)
  const describedBy = $derived(`${field.id}-description${invalid ? ` ${field.id}-issue` : ''}`)

  $effect(() => {
    const nextDraft = createStructuredDraft(field.schema, value)
    const nextValue = structuredDraftValue(nextDraft)
    if (sameStructuredValue(nextValue, authoritativeValue)) return
    authoritativeValue = nextValue
    draft = nextDraft
    errors = []
  })

  function apply(): void {
    errors = validateStructuredDraft(draft, field.label)
    if (errors.length > 0) return
    void onCommit?.({ field, value: structuredDraftValue(draft) })
  }
</script>

<div class="field-control">
  <StructuredValueEditor
    {draft}
    label={field.label}
    {disabled}
    {invalid}
    {describedBy}
    onChange={(next) => (draft = next)}
  />
  <FieldDiagnostics {field} {issues} localErrors={errors} />
  <button type="button" {disabled} onclick={apply}>Apply {field.label}</button>
</div>

<style>
</style>
