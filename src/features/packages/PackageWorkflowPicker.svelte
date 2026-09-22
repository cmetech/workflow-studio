<script lang="ts">
  import type { PackageWorkflowOption } from '$src/lib/packages/creation'
  interface Props {
    sources: readonly PackageWorkflowOption[]
    selectedId: string
    onSelect: (id: string) => void
    disabled?: boolean
    label?: string
  }
  let { sources, selectedId, onSelect, disabled = false, label = 'First workflow' }: Props = $props()
</script>

<label>
  {label}
  <select
    value={selectedId}
    disabled={disabled || sources.length === 0}
    onchange={(event) => onSelect(event.currentTarget.value)}
  >
    <option value="" disabled>Select a workflow</option>
    {#each sources as option (option.id)}
      <option value={option.id} disabled={Boolean(option.disabledReason)}
        >{option.label}{option.disabledReason ? ` - ${option.disabledReason}` : ''}</option
      >
    {/each}
  </select>
</label>
{#if !sources.some((option) => !option.disabledReason)}<p>No verified workflow sources are available.</p>{/if}

<style>
  label {
    display: grid;
    gap: 0.35rem;
  }
  select {
    width: 100%;
    min-height: 2.25rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
  }
  select:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
