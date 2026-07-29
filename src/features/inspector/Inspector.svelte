<script lang="ts">
  import type { ValidationIssue } from '$src/lib/documents/types'
  import type { FormField, FormFieldCommit } from '$src/lib/forms/types'
  import type { DocumentationIndex } from '$src/lib/docs/types'
  import { resolveWidget } from '$src/lib/forms/widget-registry'
  import ContextDocs from '$src/features/documentation/ContextDocs.svelte'

  interface Props {
    fields: readonly FormField[]
    values: Readonly<Record<string, unknown>>
    selectionLabel?: string | undefined
    selectionNodeId?: string | undefined
    selectionCount?: number | undefined
    bindingIdentity?: string | undefined
    issues?: readonly ValidationIssue[] | undefined
    disabledReason?: string | undefined
    documentationIndex?: DocumentationIndex | undefined
    documentationTopicId?: string | undefined
    onDocumentationTopic?: ((id: string) => void) | undefined
    onCommit?: ((commit: FormFieldCommit) => void | Promise<void>) | undefined
  }

  let {
    fields,
    values,
    selectionLabel = 'No selection',
    selectionNodeId,
    selectionCount = 1,
    bindingIdentity = selectionLabel,
    issues = [],
    disabledReason,
    documentationIndex,
    documentationTopicId,
    onDocumentationTopic,
    onCommit,
  }: Props = $props()

  const tabs = ['General', 'Execution', 'Advanced', 'Docs'] as const
  type InspectorTab = (typeof tabs)[number]
  let activeTab = $state<InspectorTab>('General')
  let tabButtons = $state<HTMLButtonElement[]>([])
  let resetVersions = $state<Record<string, number>>({})
  const visibleFields = $derived(
    activeTab === 'Docs' ? [] : fields.filter(({ section }) => section.toLowerCase() === activeTab.toLowerCase()),
  )
  const contextualDocField = $derived.by(() => {
    if (!documentationTopicId) return fields[0]
    return fields.find((field) => `field:${field.id.split('@/')[0]}` === documentationTopicId) ?? fields[0]
  })

  function activateTab(index: number): void {
    const normalized = (index + tabs.length) % tabs.length
    activeTab = tabs[normalized] ?? 'General'
    tabButtons[normalized]?.focus()
  }

  function onTabKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'ArrowRight') activateTab(index + 1)
    else if (event.key === 'ArrowLeft') activateTab(index - 1)
    else if (event.key === 'Home') activateTab(0)
    else if (event.key === 'End') activateTab(tabs.length - 1)
    else return
    event.preventDefault()
  }

  function fieldIssues(field: FormField): readonly ValidationIssue[] {
    if (!field.concretePath) return []
    const pointer = `/${field.concretePath
      .map((token) => String(token).replaceAll('~', '~0').replaceAll('/', '~1'))
      .join('/')}`
    const leaf = String(field.concretePath.at(-1) ?? '')
    return issues.filter((issue) => {
      if (issue.document !== field.document) return false
      if (issue.path) return issue.path === pointer
      return Boolean(selectionNodeId && issue.nodeId === selectionNodeId && issue.field === leaf)
    })
  }

  function resetDraft(field: FormField): void {
    resetVersions = { ...resetVersions, [field.id]: (resetVersions[field.id] ?? 0) + 1 }
  }

  function selectDocumentationField(field: FormField): void {
    onDocumentationTopic?.(`field:${field.id.split('@/')[0]}`)
  }

  function sameValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (Array.isArray(left) && Array.isArray(right))
      return left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const leftRecord = left as Record<string, unknown>
      const rightRecord = right as Record<string, unknown>
      const keys = Object.keys(leftRecord)
      return (
        keys.length === Object.keys(rightRecord).length &&
        keys.every((key) => Object.hasOwn(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]))
      )
    }
    return false
  }
</script>

<section class="inspector" aria-label="Workflow inspector">
  <header>
    <span>Inspector</span>
    <strong>{selectionLabel}</strong>
  </header>
  <div class="tabs" role="tablist" aria-label="Inspector sections">
    {#each tabs as tab, index (tab)}
      <button
        bind:this={tabButtons[index]}
        type="button"
        role="tab"
        id={`inspector-tab-${tab.toLowerCase()}`}
        aria-controls={`inspector-panel-${tab.toLowerCase()}`}
        aria-selected={activeTab === tab}
        tabindex={activeTab === tab ? 0 : -1}
        class:active={activeTab === tab}
        onclick={() => (activeTab = tab)}
        onkeydown={(event) => onTabKeydown(event, index)}>{tab}</button
      >
    {/each}
  </div>

  <div
    class="panel"
    role="tabpanel"
    id={`inspector-panel-${activeTab.toLowerCase()}`}
    aria-labelledby={`inspector-tab-${activeTab.toLowerCase()}`}
  >
    {#if selectionCount > 1}
      <div class="selection-summary">
        <strong>{selectionCount} nodes selected</strong>
        <p>Choose one node to edit its fields.</p>
      </div>
    {:else if disabledReason}
      <p class="disabled-reason" aria-live="polite">{disabledReason}</p>
      {#each visibleFields as field (field.id)}
        {@const resolution = resolveWidget(field)}
        {#if resolution.ok}
          {@const Widget = resolution.definition.component}
          <div
            class="field"
            class:deferred={field.status !== 'supported'}
            onfocusin={() => selectDocumentationField(field)}
          >
            {#key `${bindingIdentity}:${field.id}:${resetVersions[field.id] ?? 0}`}
              <Widget
                {field}
                value={values[field.id]}
                present={Object.hasOwn(values, field.id)}
                disabled={true}
                issues={fieldIssues(field)}
                {onCommit}
              />
            {/key}
          </div>
        {/if}
      {/each}
    {:else if activeTab === 'Docs'}
      <div class="docs">
        <ContextDocs field={contextualDocField} index={documentationIndex} />
      </div>
    {:else if visibleFields.length === 0}
      <p class="empty">No {activeTab.toLowerCase()} fields apply to this selection.</p>
    {:else}
      {#each visibleFields as field (field.id)}
        {@const resolution = resolveWidget(field)}
        <div
          class="field"
          class:deferred={field.status !== 'supported'}
          onfocusin={() => selectDocumentationField(field)}
        >
          <div class="field-meta">
            {#if field.status !== 'supported'}<span class="badge">{field.status}</span>{/if}
            {#if !Object.hasOwn(values, field.id) && field.hasDefault}<span class="badge"
                >inherited default: {String(field.defaultValue)}</span
              >{/if}
            {#if Object.hasOwn(values, field.id) && field.hasDefault && sameValue(values[field.id], field.defaultValue)}<span
                class="badge">explicit default: {String(field.defaultValue)}</span
              >{/if}
            {#if field.unit}<span class="badge">{field.unit}</span>{/if}
          </div>
          {#if resolution.ok}
            {@const Widget = resolution.definition.component}
            {#key `${bindingIdentity}:${field.id}:${resetVersions[field.id] ?? 0}`}
              <Widget
                {field}
                value={values[field.id]}
                present={Object.hasOwn(values, field.id)}
                issues={fieldIssues(field)}
                {onCommit}
              />
            {/key}
            <div class="field-actions">
              <button type="button" onclick={() => resetDraft(field)}>Reset {field.label} draft</button>
              {#if !field.required && Object.hasOwn(values, field.id)}<button
                  type="button"
                  onclick={() => void onCommit?.({ field, remove: true })}>Remove {field.label}</button
                >{/if}
            </div>
          {:else}
            <p class="unsupported" role="status">{resolution.message} YAML is preserved; this field is read-only.</p>
          {/if}
          {#if field.examples.length > 0}<p class="example">Example: {JSON.stringify(field.examples[0])}</p>{/if}
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .inspector {
    min-height: 100%;
    color: var(--color-text);
    background: var(--color-surface);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.1rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--color-border);
  }
  .tabs button {
    min-width: 0;
    padding: 0.35rem 0.15rem;
    border: 0;
    border-radius: 0.3rem;
    color: var(--color-text-muted);
    background: transparent;
    font-size: 0.68rem;
  }
  .tabs button.active {
    color: var(--color-accent-strong);
    background: var(--color-node-selected);
  }
  .panel {
    padding: 0.75rem;
    overflow: auto;
  }
  .field {
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .field.deferred {
    opacity: 0.82;
  }
  .field-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }
  .field-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.35rem;
  }
  .badge {
    padding: 0.1rem 0.3rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-text-muted);
    font-size: 0.62rem;
  }
  .example,
  .empty,
  .disabled-reason,
  .selection-summary p {
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  .unsupported {
    padding: 0.5rem;
    border: 1px solid var(--color-warning);
    color: var(--color-warning);
  }
  .docs :global(article) {
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }
  .docs :global(h3) {
    font-size: 0.8rem;
  }
  .docs :global(p),
  .docs :global(pre) {
    white-space: pre-wrap;
    font-size: 0.7rem;
  }
</style>
