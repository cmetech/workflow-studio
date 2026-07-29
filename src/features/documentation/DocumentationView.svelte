<script lang="ts">
  import { renderMarkdown } from '$src/lib/docs/render-markdown'
  import { searchDocumentation } from '$src/lib/docs/build-index'
  import type { DocumentationIndex, DocumentationTopic, DocumentationTopicKind } from '$src/lib/docs/types'

  interface Props {
    index: DocumentationIndex
    topicId?: string | undefined
    onTopicConsumed?: ((id: string) => void) | undefined
    onOpenExternal?: ((url: string) => void) | undefined
  }

  let { index, topicId, onTopicConsumed, onOpenExternal }: Props = $props()
  let query = $state('')
  let kind = $state<DocumentationTopicKind | 'all'>('all')
  let highlighted = $state(0)
  let selected = $state<DocumentationTopic | null>(null)
  let history = $state<readonly string[]>([])
  const results = $derived(searchDocumentation(index, query, kind))

  function activeResultId(): string | undefined {
    const topic = results[highlighted]
    return topic ? `documentation-result-${topic.id}` : undefined
  }

  function select(topic: DocumentationTopic): void {
    selected = topic
    history = [topic.id, ...history.filter((id) => id !== topic.id)].slice(0, 5)
  }

  $effect(() => {
    const topic = topicId ? index.byId.get(topicId) : undefined
    if (topic && selected?.id !== topic.id) {
      select(topic)
      onTopicConsumed?.(topic.id)
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

  function delegateExternal(node: HTMLElement): { destroy(): void } {
    const followExternal = (event: MouseEvent): void => {
      const target =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-external-url]') : null
      const url = target?.dataset.externalUrl
      if (url) onOpenExternal?.(url)
    }
    node.addEventListener('click', followExternal)
    return { destroy: () => node.removeEventListener('click', followExternal) }
  }

  function renderSanitized(node: HTMLElement, markdown: string): { update(next: string): void } {
    const update = (next: string): void => {
      node.innerHTML = renderMarkdown(next)
    }
    update(markdown)
    return { update }
  }
</script>

<section class="documentation" aria-label="Offline documentation">
  <label>
    Search documentation
    <input
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
  {#if history.length > 0}
    <nav aria-label="Documentation history">
      {#each history as id (id)}
        {@const topic = index.byId.get(id)}
        {#if topic}<button type="button" onclick={() => select(topic)}>{topic.title} — {topic.id}</button>{/if}
      {/each}
    </nav>
  {/if}
  {#if selected}
    <article use:delegateExternal>
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
</section>

<style>
  .documentation {
    display: grid;
    gap: 0.75rem;
    padding: 0.75rem;
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
  }
  [role='option'].highlighted,
  [role='option']:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  [role='option'] span {
    color: var(--color-text-muted);
    font-size: 0.7rem;
  }
  .markdown :global(pre),
  .markdown :global(code) {
    white-space: pre-wrap;
  }
</style>
