<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'
  let { field, value, present, disabled = false, onCommit }: WidgetProps = $props()
  let draft = $derived(JSON.stringify(value ?? {}, null, 2))
  let error = $state('')
  function apply() {
    try {
      const parsed: unknown = JSON.parse(draft)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new TypeError('Enter a JSON Schema object.')
      error = ''
      void onCommit?.({ field, value: parsed })
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Enter valid JSON.'
    }
  }
</script>

<div class="field-control">
  <label for={field.id}>{field.label}</label><textarea id={field.id} bind:value={draft} {disabled}></textarea>
  <p>{field.description}</p>
  {#if error}<p role="alert">{error}</p>{/if}<button type="button" {disabled} onclick={apply}
    >Apply {field.label}</button
  >{#if !field.required && present}<button
      type="button"
      {disabled}
      onclick={() => void onCommit?.({ field, remove: true })}>Remove {field.label}</button
    >{/if}
</div>

<style>
  label {
    display: block;
  }
  textarea {
    width: 100%;
    min-height: 5rem;
    font-family: ui-monospace, monospace;
  }
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  [role='alert'] {
    color: var(--color-danger);
  }
</style>
