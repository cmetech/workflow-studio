<script lang="ts">
  import { tick } from 'svelte'
  import { renderMarkdown } from '$src/lib/docs/render-markdown'
  import { searchDocumentation } from '$src/lib/docs/build-index'
  import type { DocumentationIndex, DocumentationTopic, DocumentationTopicKind } from '$src/lib/docs/types'

  interface Props {
    index: DocumentationIndex
    topicId?: string | undefined
    navigationRequestId?: number | undefined
    onTopicConsumed?: ((id: string, requestId?: number) => void) | undefined
    onOpenExternal?: ((url: string) => void) | undefined
  }

  let { index, topicId, navigationRequestId, onTopicConsumed, onOpenExternal }: Props = $props()
  let query = $state('')
  let kind = $state<DocumentationTopicKind | 'all'>('all')
  let highlighted = $state(0)
  let selected = $state<DocumentationTopic | null>(null)
  let history = $state<readonly string[]>([])
  let consumedRequestId = $state<number | undefined>()
  let consumedTopicId = $state<string | undefined>()
  let reconciledIndex: DocumentationIndex | undefined
  let article = $state<HTMLElement>()
  let searchInput = $state<HTMLInputElement>()
  let backToResults = $state<HTMLButtonElement>()
  const results = $derived(searchDocumentation(index, query, kind))

  function activeResultId(): string | undefined {
    const topic = results[highlighted]
    return topic ? `documentation-result-${topic.id}` : undefined
  }

  function select(topic: DocumentationTopic): void {
    selected = topic
    history = [topic.id, ...history.filter((id) => id !== topic.id)].slice(0, 5)
    void revealSelectedTopic(topic.id)
  }

  async function revealSelectedTopic(topicId: string): Promise<void> {
    await tick()
    if (selected?.id !== topicId) return
    if (article) article.scrollTop = 0
    if (!window.matchMedia?.('(max-width: 48rem)').matches) return
    const pageScroll = article?.closest<HTMLElement>('[data-page-scroll]')
    if (pageScroll) pageScroll.scrollTop = 0
    backToResults?.focus({ preventScroll: true })
  }

  function returnToResults(): void {
    const selectedId = selected?.id
    selected = null
    void tick().then(() => {
      if (!selectedId) return
      const selectedResult = document.getElementById(`documentation-result-${selectedId}`)
      const target = selectedResult ?? searchInput
      target?.focus()
    })
  }

  $effect(() => {
    if (index === reconciledIndex) return
    reconciledIndex = index
    selected = selected ? (index.byId.get(selected.id) ?? null) : null
    history = history.filter((id) => index.byId.has(id))
    highlighted = Math.min(highlighted, Math.max(0, results.length - 1))
  })

  $effect(() => {
    const topic = topicId ? index.byId.get(topicId) : undefined
    if (topic && navigationRequestId !== undefined && consumedRequestId !== navigationRequestId) {
      if (selected?.id !== topic.id) select(topic)
      consumedRequestId = navigationRequestId
      onTopicConsumed?.(topic.id, navigationRequestId)
    } else if (topic && navigationRequestId === undefined && consumedTopicId !== topic.id) {
      if (selected?.id !== topic.id) select(topic)
      consumedTopicId = topic.id
      onTopicConsumed?.(topic.id)
    } else if (topicId && !topic && navigationRequestId !== undefined && consumedRequestId !== navigationRequestId) {
      consumedRequestId = navigationRequestId
      onTopicConsumed?.(topicId, navigationRequestId)
    }
  })

  function searchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      highlighted = Math.min(highlighted + 1, Math.max(0, results.length - 1))
      event.preventDefault()
    } else if (event.key === 'ArrowUp') {
      highlighted = Math.max(highlighted - 1, 0)
      event.preventDefault()
    } else if (event.key === 'Enter') {
      const topic = results[highlighted]
      if (topic) {
        select(topic)
        event.preventDefault()
      }
    }
  }

  function delegateLinks(node: HTMLElement): { destroy(): void } {
    const followLink = (event: MouseEvent): void => {
      const internal =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-topic-id]') : null
      const topic = internal?.dataset.topicId ? index.byId.get(internal.dataset.topicId) : undefined
      if (topic) {
        select(topic)
        void tick().then(() => article?.focus())
        return
      }
      const target =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-external-url]') : null
      const url = target?.dataset.externalUrl
      if (url) onOpenExternal?.(url)
    }
    node.addEventListener('click', followLink)
    return { destroy: () => node.removeEventListener('click', followLink) }
  }

  function renderSanitized(node: HTMLElement, markdown: string): { update(next: string): void } {
    const update = (next: string): void => {
      node.innerHTML = renderMarkdown(next)
    }
    update(markdown)
    return { update }
  }
</script>

<section class="documentation" aria-label="Offline documentation" data-profile={index.topics[0]?.profile}>
  <div class="documentation-layout" class:detail-active={selected !== null}>
    <section
      class="documentation-navigation"
      data-testid="documentation-navigation"
      aria-label="Documentation navigation"
    >
      <label>
        Search documentation
        <input
          bind:this={searchInput}
          type="search"
          bind:value={query}
          aria-controls="documentation-results"
          aria-activedescendant={activeResultId()}
          oninput={() => (highlighted = 0)}
          onkeydown={searchKeydown}
        />
      </label>
      <label>
        Topic type
        <select aria-label="Topic type" bind:value={kind} onchange={() => (highlighted = 0)}>
          <option value="all">All topics</option>
          <option value="node">Nodes</option>
          <option value="field">Fields</option>
          <option value="guide">Guides</option>
          <option value="contract">Contract</option>
        </select>
      </label>
      <div id="documentation-results" role="listbox" aria-label="Documentation results">
        {#each results as topic, index (topic.id)}
          <button
            role="option"
            id={`documentation-result-${topic.id}`}
            aria-selected={index === highlighted}
            class:highlighted={index === highlighted}
            onclick={() => {
              highlighted = index
              select(topic)
            }}
          >
            <strong>{topic.title}</strong><span>{topic.kind}</span>
          </button>
        {/each}
      </div>
      {#if results.length === 0}<p class="empty-results" role="status">No documentation matches</p>{/if}
      {#if history.length > 0}
        <nav aria-label="Documentation history">
          {#each history as id (id)}
            {@const topic = index.byId.get(id)}
            {#if topic}<button type="button" onclick={() => select(topic)}>{topic.title} — {topic.id}</button>{/if}
          {/each}
        </nav>
      {/if}
    </section>
    {#if selected}
      <article aria-label={selected.title} bind:this={article} tabindex="-1" use:delegateLinks>
        <button
          bind:this={backToResults}
          class="back-to-results"
          type="button"
          data-variant="ghost"
          onclick={returnToResults}>Back to Results</button
        >
        <h2>{selected.title}</h2>
        {#if selected.examples.length > 0}
          <section aria-label="Examples">
            <h3>Examples</h3>
            <pre>{JSON.stringify(selected.examples[0], null, 2)}</pre>
          </section>
        {/if}
        <div class="markdown" use:renderSanitized={selected.body}></div>
      </article>
    {/if}
  </div>
</section>

<style>
  .documentation {
    height: 100%;
    min-width: 0;
    min-height: 0;
    max-width: 100%;
  }
  .documentation-layout {
    display: grid;
    grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
    gap: var(--space-3);
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: var(--space-3);
    overflow: hidden;
  }
  .documentation-navigation {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  label {
    display: grid;
    gap: 0.25rem;
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  input,
  select {
    min-height: 2rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
  [role='listbox'] {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  [role='option'] {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem;
    text-align: left;
    color: var(--color-text);
    background: transparent;
    border: 1px solid var(--color-border);
    min-width: 0;
  }
  [role='option'].highlighted,
  [role='option']:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  [role='option'] span {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: 0.7rem;
    overflow-wrap: anywhere;
  }
  [role='option'] strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  article {
    min-width: 0;
    min-height: 0;
    padding: var(--space-1) var(--space-3) var(--space-4);
    overflow: auto;
    overflow-wrap: anywhere;
  }
  article h2 {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  article pre {
    max-width: 100%;
    overflow-x: auto;
  }
  .back-to-results {
    display: none;
  }
  .empty-results {
    margin: 0;
    color: var(--color-text-muted);
  }
  .markdown :global(pre),
  .markdown :global(code) {
    white-space: pre-wrap;
  }

  @media (max-width: 48rem) {
    .documentation {
      height: auto;
    }

    .documentation-layout {
      display: block;
      height: auto;
      overflow: visible;
    }

    .documentation-navigation,
    article {
      overflow: visible;
    }

    .documentation-layout.detail-active .documentation-navigation {
      display: none;
    }

    .back-to-results {
      display: inline-flex;
    }
  }
</style>
