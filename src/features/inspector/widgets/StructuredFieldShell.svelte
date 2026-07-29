<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  import { createStructuredDraft, structuredDraftValue, validateStructuredDraft } from '$src/lib/forms/structured-draft'
  import StructuredValueEditor from './StructuredValueEditor.svelte'

  let { field, value, disabled = false, onCommit }: WidgetProps = $props()
  let draft = $derived(createStructuredDraft(field.schema, value))
  let errors = $state<readonly string[]>([])

  function apply(): void {
    errors = validateStructuredDraft(draft, field.label)
    if (errors.length > 0) return
    void onCommit?.({ field, value: structuredDraftValue(draft) })
  }
</script>

<div class="field-control">
  <StructuredValueEditor {draft} label={field.label} {disabled} onChange={(next) => (draft = next)} />
  <p>{field.description}</p>
  {#if errors.length > 0}<p role="alert">{errors.join(' ')}</p>{/if}
  <button type="button" {disabled} onclick={apply}>Apply {field.label}</button>
</div>

<style>
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  [role='alert'] {
    color: var(--color-danger);
  }
</style>
