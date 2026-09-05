<script lang="ts">
  import type { LoopGroupReferenceSuggestion } from './loop-group-reference-guidance'

  interface Props {
    groupId: string
    suggestions: readonly LoopGroupReferenceSuggestion[]
    status?: string | undefined
    onCopy?: (token: string) => void | Promise<void>
    onInsert?: (token: string) => void | Promise<void>
    onAddDependency?: (producerId: string) => void | Promise<void>
  }

  let { groupId, suggestions, status, onCopy, onInsert, onAddDependency }: Props = $props()
</script>

<section class="scope-bar" aria-label={`References for ${groupId}`} data-scroll-owner="scope-references">
  <div class="intro">
    <strong>Scope references</strong>
    <span>Copy or insert a contract-supported output token.</span>
  </div>
  <div class="suggestions">
    {#each suggestions as suggestion (`${suggestion.namespace}:${suggestion.producerId}`)}
      <article class:unavailable={!suggestion.available}>
        <code>{suggestion.token}</code>
        <span>{suggestion.namespace}</span>
        {#if suggestion.available}
          <button type="button" onclick={() => onCopy?.(suggestion.token)}>Copy {suggestion.token}</button>
          <button type="button" onclick={() => onInsert?.(suggestion.token)}>Insert {suggestion.token}</button>
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
