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
  }

  let { groupId, suggestions, status, onCopy, canInsert, onInsert, onAddDependency }: Props = $props()

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
</script>

<section class="scope-bar" aria-label={`References for ${groupId}`} data-scroll-owner="scope-references">
  <div class="intro">
    <strong>Scope references</strong>
    <span>Copy or insert a contract-supported output token.</span>
  </div>
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
    {#each visibleSuggestions as suggestion (`${suggestion.namespace}:${suggestion.producerId}`)}
      <article class:unavailable={!suggestion.available}>
        <code>{suggestion.token}</code>
        <span>{suggestion.namespace}</span>
        {#if suggestion.available}
          <button type="button" onclick={() => onCopy?.(suggestion.token)}>Copy {suggestion.token}</button>
          <button
            type="button"
            disabled={canInsert ? !canInsert(suggestion) : false}
            onclick={() => onInsert?.(suggestion)}>Insert {suggestion.token}</button
          >
        {:else}
          <p>{suggestion.reason}</p>
          {#if suggestion.canAddDependency}
            <button type="button" onclick={() => onAddDependency?.(suggestion.producerId)}>
              Add {suggestion.producerId} as group dependency
            </button>
          {/if}
        {/if}
      </article>
    {/each}
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
  .suggestions,
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
  article > span,
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
