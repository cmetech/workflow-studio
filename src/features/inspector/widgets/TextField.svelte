<script lang="ts">
  import type { WidgetProps } from '$src/lib/forms/types'

  let { field, value, disabled = false, issues = [], onCommit }: WidgetProps = $props()
  let draft = $derived(value === undefined ? '' : String(value))
  const descriptionId = $derived(`${field.id}-description`)
  const issueId = $derived(`${field.id}-issue`)
  const invalid = $derived(issues.length > 0)
</script>

<div class="field-control">
  <label for={field.id}
    >{field.label}{#if field.required}<span class="required"> required</span>{/if}</label
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
  <p id={descriptionId} class="help">{field.description}</p>
  {#if invalid}<p id={issueId} class="issue">{issues.map(({ message }) => message).join(' ')}</p>{/if}
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
  .required,
  .issue {
    color: var(--color-danger);
  }
  .help,
  .issue {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  .field-actions {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.35rem;
  }
</style>
