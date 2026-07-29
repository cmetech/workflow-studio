<script lang="ts">
  import {
    additionalPropertySchema,
    emptyStructuredDraft,
    fieldLabel,
    objectAllowsDynamicEntries,
    objectOptionalProperties,
    selectStructuredUnionBranch,
    structuredBranchLabel,
    type ObjectEntryDraft,
    type StructuredDraft,
  } from '$src/lib/forms/structured-draft'
  import StructuredValueEditor from './StructuredValueEditor.svelte'

  interface Props {
    draft: StructuredDraft
    label: string
    disabled?: boolean
    invalid?: boolean
    describedBy?: string
    onChange: (draft: StructuredDraft) => void
  }

  let { draft, label, disabled = false, invalid = false, describedBy = '', onChange }: Props = $props()
  const scalarType = $derived(
    Array.isArray(draft.schema.type) ? draft.schema.type.find((value) => value !== 'null') : draft.schema.type,
  )
  const enumOptions = $derived(Array.isArray(draft.schema.enum) ? draft.schema.enum : [])
  const scalarOptions = $derived(
    enumOptions.length > 0 ? enumOptions : Object.hasOwn(draft.schema, 'const') ? [draft.schema.const] : [],
  )

  function replaceArrayItem(index: number, value: StructuredDraft): void {
    if (draft.kind !== 'array') return
    onChange({ ...draft, items: draft.items.map((item, itemIndex) => (itemIndex === index ? value : item)) })
  }

  function replaceObjectEntry(index: number, entry: ObjectEntryDraft): void {
    if (draft.kind !== 'object') return
    onChange({
      ...draft,
      entries: draft.entries.map((current, entryIndex) => (entryIndex === index ? entry : current)),
    })
  }
</script>

{#if draft.kind === 'union'}
  <label
    >{label} type<select
      {disabled}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      value={String(draft.activeIndex)}
      onchange={(event) => onChange(selectStructuredUnionBranch(draft, Number(event.currentTarget.value)))}
      >{#each draft.branches as branch, index (index)}<option value={String(index)}
          >{structuredBranchLabel(branch, index)}</option
        >{/each}</select
    ></label
  >
  <StructuredValueEditor
    draft={draft.value}
    label={`${label} value`}
    {disabled}
    {invalid}
    {describedBy}
    onChange={(value) => onChange({ ...draft, value })}
  />
{:else if draft.kind === 'scalar'}
  {#if scalarOptions.length > 0}
    <label
      >{label}<select
        {disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={String(scalarOptions.findIndex((candidate) => Object.is(candidate, draft.value)))}
        onchange={(event) => onChange({ ...draft, value: scalarOptions[Number(event.currentTarget.value)] })}
        >{#each scalarOptions as option, index (index)}<option value={String(index)}>{String(option)}</option
          >{/each}</select
      ></label
    >
  {:else if scalarType === 'null'}
    <p role="status">{label}: null</p>
  {:else if scalarType === 'boolean'}
    <label
      ><input
        type="checkbox"
        {disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        checked={draft.value === true}
        onchange={(event) => onChange({ ...draft, value: event.currentTarget.checked })}
      />{label}</label
    >
  {:else if scalarType === 'number' || scalarType === 'integer'}
    <label
      >{label}<input
        type="number"
        {disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={typeof draft.value === 'number' && Number.isFinite(draft.value) ? String(draft.value) : ''}
        min={typeof draft.schema.minimum === 'number' ? draft.schema.minimum : undefined}
        max={typeof draft.schema.maximum === 'number' ? draft.schema.maximum : undefined}
        step={scalarType === 'integer' ? 1 : 'any'}
        oninput={(event) => onChange({ ...draft, value: Number(event.currentTarget.value) })}
      /></label
    >
  {:else}
    <label
      >{label}<input
        type="text"
        {disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={typeof draft.value === 'string' ? draft.value : ''}
        oninput={(event) => onChange({ ...draft, value: event.currentTarget.value })}
      /></label
    >
  {/if}
{:else if draft.kind === 'array'}
  <fieldset {disabled}>
    <legend>{label}</legend>
    {#each draft.items as item, index (index)}
      <div class="entry">
        <StructuredValueEditor
          draft={item}
          label={`${label} item ${index + 1}`}
          {disabled}
          {invalid}
          {describedBy}
          onChange={(next) => replaceArrayItem(index, next)}
        />
        <button
          type="button"
          {disabled}
          onclick={() => onChange({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}
          >Remove {label} item {index + 1}</button
        >
      </div>
    {/each}
    <button
      type="button"
      {disabled}
      onclick={() =>
        onChange({
          ...draft,
          items: [...draft.items, emptyStructuredDraft((draft.schema.items as Record<string, unknown>) ?? {})],
        })}>Add {label} item</button
    >
  </fieldset>
{:else}
  <fieldset {disabled}>
    <legend>{label}</legend>
    {#each draft.entries as entry, index (entry.id)}
      <div class="entry">
        {#if entry.dynamic}
          <label
            >{label} key {index + 1}<input
              type="text"
              {disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              value={entry.key}
              oninput={(event) => replaceObjectEntry(index, { ...entry, key: event.currentTarget.value })}
            /></label
          >
        {/if}
        <StructuredValueEditor
          draft={entry.value}
          label={fieldLabel(entry)}
          {disabled}
          {invalid}
          {describedBy}
          onChange={(value) => replaceObjectEntry(index, { ...entry, value })}
        />
        {#if entry.dynamic || !entry.required}<button
            type="button"
            {disabled}
            onclick={() =>
              onChange({ ...draft, entries: draft.entries.filter((_, entryIndex) => entryIndex !== index) })}
            >Remove {fieldLabel(entry)}</button
          >{/if}
      </div>
    {/each}
    {#each objectOptionalProperties(draft) as [key, schema] (key)}
      <button
        type="button"
        {disabled}
        onclick={() =>
          onChange({
            ...draft,
            entries: [
              ...draft.entries,
              {
                id: `entry-${crypto.randomUUID()}`,
                key,
                dynamic: false,
                required: false,
                schema,
                value: emptyStructuredDraft(schema),
              },
            ],
          })}>Add {typeof schema.title === 'string' ? schema.title : key}</button
      >
    {/each}
    {#if objectAllowsDynamicEntries(draft)}<button
        type="button"
        {disabled}
        onclick={() => {
          const schema = additionalPropertySchema(draft.schema)
          onChange({
            ...draft,
            entries: [
              ...draft.entries,
              {
                id: `entry-${crypto.randomUUID()}`,
                key: '',
                dynamic: true,
                required: false,
                schema,
                value: emptyStructuredDraft(schema),
              },
            ],
          })
        }}>Add {label} entry</button
      >{/if}
  </fieldset>
{/if}

<style>
  fieldset {
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
  }
  label {
    display: grid;
    gap: 0.25rem;
    margin: 0.25rem 0;
  }
  input,
  select {
    min-width: 0;
    width: 100%;
  }
  .entry {
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--color-border);
  }
</style>
