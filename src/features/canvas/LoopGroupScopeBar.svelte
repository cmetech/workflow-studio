<script lang="ts">
  import type { LoopGroupReferenceSuggestion } from './loop-group-reference-guidance'

  interface Props {
    groupId: string
    suggestions: readonly LoopGroupReferenceSuggestion[]
    status?: string | undefined
    onCopy?: (token: string) => void | Promise<void>
    canInsert?: (suggestion: LoopGroupReferenceSuggestion) => boolean
    onInsert?: (suggestion: LoopGroupReferenceSuggestion) => void | Promise<void>
    onAddDependency?: (producerId: string) => void | Promise<void>
    insertionTargetLabel?: string
  }

  let { groupId, suggestions, status, onCopy, canInsert, onInsert, onAddDependency, insertionTargetLabel }: Props =
    $props()

  const RESULT_LIMIT = 12
  let query = $state('')
  const matchingSuggestions = $derived.by(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return suggestions
    return suggestions.filter((suggestion) =>
      [suggestion.token, suggestion.producerId, suggestion.namespace, suggestion.reason ?? ''].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
  })
  const visibleSuggestions = $derived(matchingSuggestions.slice(0, RESULT_LIMIT))
  const currentSuggestions = $derived(
    visibleSuggestions.filter((suggestion) => suggestion.available && suggestion.namespace === 'current'),
  )
  const outerSuggestions = $derived(
    visibleSuggestions.filter((suggestion) => suggestion.available && suggestion.namespace === 'outer'),
  )
  const previousSuggestions = $derived(
    visibleSuggestions.filter((suggestion) => suggestion.available && suggestion.namespace === 'previous'),
  )
  const unavailableOuterSuggestions = $derived(
    visibleSuggestions.filter((suggestion) => !suggestion.available && suggestion.namespace === 'outer'),
  )
  const hasCurrentProducer = $derived(
    suggestions.some((suggestion) => suggestion.available && suggestion.namespace === 'current'),
  )
</script>

<section class="scope-bar" aria-label={`References for ${groupId}`} data-scroll-owner="scope-references">
  <div class="intro">
    <strong>Scope references</strong>
    <span>References are exact workflow text that let a node reuse another node's output.</span>
    <span>Copy works at any time. Insert adds a token to a compatible Inspector text field.</span>
  </div>
  <p class="insertion-target">
    {#if insertionTargetLabel}
      Insert target: {insertionTargetLabel}
    {:else}
      Focus a compatible Inspector text field to enable Insert. Copy works at any time.
    {/if}
  </p>
  {#if suggestions.length > RESULT_LIMIT}
    <label class="search">
      <span>Search scope references</span>
      <input type="search" bind:value={query} />
    </label>
    <p class="result-count" aria-live="polite">
      Showing {visibleSuggestions.length} of {matchingSuggestions.length} matching references.
    </p>
  {/if}
  <div class="suggestions">
    <section class="reference-group" aria-labelledby="current-references-heading">
      <h2 id="current-references-heading">Earlier nodes in this iteration</h2>
      <p>
        Body-node fields can use outputs from their direct dependencies. Compatible group controls can use outputs from
        any body node.
      </p>
      {#if !hasCurrentProducer}
        <p>Earlier nodes become available when the focused body field can use one of its direct dependencies.</p>
      {/if}
      {#each currentSuggestions as suggestion (`${suggestion.namespace}:${suggestion.producerId}`)}
        <article>
          <code>{suggestion.token}</code>
          <button type="button" onclick={() => onCopy?.(suggestion.token)}>Copy {suggestion.token}</button>
          <button
            type="button"
            disabled={canInsert ? !canInsert(suggestion) : false}
            onclick={() => onInsert?.(suggestion)}>Insert {suggestion.token}</button
          >
        </article>
      {/each}
    </section>
    <section class="reference-group" aria-labelledby="outer-references-heading">
      <h2 id="outer-references-heading">Inputs from the main workflow</h2>
      <p>Use outputs from workflow nodes that this loop already depends on.</p>
      {#each outerSuggestions as suggestion (`${suggestion.namespace}:${suggestion.producerId}`)}
        <article>
          <code>{suggestion.token}</code>
          <button type="button" onclick={() => onCopy?.(suggestion.token)}>Copy {suggestion.token}</button>
          <button
            type="button"
            disabled={canInsert ? !canInsert(suggestion) : false}
            onclick={() => onInsert?.(suggestion)}>Insert {suggestion.token}</button
          >
        </article>
      {/each}
    </section>
    <section class="reference-group" aria-labelledby="previous-references-heading">
      <h2 id="previous-references-heading">Outputs from the previous iteration</h2>
      <p>Use the same body node's output from the immediately previous loop iteration.</p>
      {#each previousSuggestions as suggestion (`${suggestion.namespace}:${suggestion.producerId}`)}
        <article>
          <code>{suggestion.token}</code>
          <button type="button" onclick={() => onCopy?.(suggestion.token)}>Copy {suggestion.token}</button>
          <button
            type="button"
            disabled={canInsert ? !canInsert(suggestion) : false}
            onclick={() => onInsert?.(suggestion)}>Insert {suggestion.token}</button
          >
        </article>
      {/each}
    </section>
    <section class="reference-group" aria-labelledby="unavailable-outer-references-heading">
      <h2 id="unavailable-outer-references-heading">More workflow outputs</h2>
      <p>Allow this loop to use a workflow output by adding it as a group dependency.</p>
      {#each unavailableOuterSuggestions as suggestion (`${suggestion.namespace}:${suggestion.producerId}`)}
        <article class="unavailable">
          <code>{suggestion.token}</code>
          <p>{suggestion.reason}</p>
          {#if suggestion.canAddDependency}
            <button type="button" onclick={() => onAddDependency?.(suggestion.producerId)}>
              Allow this loop to use {suggestion.producerId}
            </button>
          {/if}
        </article>
      {/each}
    </section>
    {#if visibleSuggestions.length === 0}<p>No matching references.</p>{/if}
  </div>
  {#if status}<p class="status" role="status" aria-live="polite">{status}</p>{/if}
</section>

<style>
  .scope-bar {
    min-width: 0;
    max-height: 10rem;
    overflow: auto;
    padding: var(--space-2);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .intro,
  article {
    display: flex;
    min-width: 0;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .search {
    display: grid;
    grid-template-columns: max-content minmax(10rem, 24rem);
    gap: var(--space-2);
    align-items: center;
    margin-block: var(--space-2);
  }
  .search input {
    min-width: 0;
  }
  .result-count {
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: 0.72rem;
  }
  .intro span,
  .insertion-target,
  .reference-group > p,
  article p {
    color: var(--color-text-muted);
    font-size: 0.72rem;
  }
  article {
    padding: var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  article.unavailable {
    opacity: 0.78;
  }
  .insertion-target,
  .reference-group > p {
    margin: var(--space-1) 0;
  }
  .reference-group {
    margin-block: var(--space-3);
  }
  .reference-group h2 {
    margin: 0;
    font-size: 0.9rem;
  }
  code {
    overflow-wrap: anywhere;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  @media (forced-colors: active) {
    article {
      border-color: CanvasText;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      scroll-behavior: auto !important;
    }
  }
</style>
