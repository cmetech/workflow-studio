<script lang="ts">
  import { renderMarkdown } from '$src/lib/docs/render-markdown'
  import type { DocumentationIndex, DocumentationTopic } from '$src/lib/docs/types'

  interface Props {
    topic: DocumentationTopic
    index: DocumentationIndex
    onBack: () => void
    onSelectTopic: (topic: DocumentationTopic, opener: HTMLElement) => void
    onOpenExternal?: ((url: string) => void) | undefined
  }

  let { topic, index, onBack, onSelectTopic, onOpenExternal }: Props = $props()

  function displayValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  function labelForNodeKind(nodeKind: string): string {
    return `${nodeKind[0]?.toUpperCase() ?? ''}${nodeKind.slice(1)}`
  }

  function delegateLinks(node: HTMLElement): { destroy(): void } {
    const followLink = (event: MouseEvent): void => {
      const internal =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-topic-id]') : null
      const selected = internal?.dataset.topicId ? index.byId.get(internal.dataset.topicId) : undefined
      if (selected && internal) {
        onSelectTopic(selected, internal)
        return
      }
      const external =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-external-url]') : null
      if (external?.dataset.externalUrl) onOpenExternal?.(external.dataset.externalUrl)
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

<article aria-label={topic.title} tabindex="-1">
  <button class="back-to-results" type="button" data-variant="ghost" onclick={onBack}>Back to Results</button>

  <nav aria-label="Documentation breadcrumb">
    <ol>
      {#each topic.breadcrumb as item (item)}<li>{item}</li>{/each}
    </ol>
  </nav>

  <header>
    <h2>{topic.title}</h2>
    <p class="topic-qualifier">{topic.qualifier}</p>
    <p class="use-when">{topic.useWhen}</p>
  </header>

  {#if topic.nodeKinds?.length || topic.fieldPaths.length || topic.kind === 'field'}
    <dl class="topic-context">
      {#if topic.nodeKinds?.length}
        <div>
          <dt>Applicable nodes</dt>
          <dd>{topic.nodeKinds.map(labelForNodeKind).join(', ')}</dd>
        </div>
      {/if}
      {#if topic.fieldPaths.length}
        <div>
          <dt>YAML location</dt>
          <dd><code>{topic.fieldPaths.join(', ')}</code></dd>
        </div>
      {/if}
      {#if topic.kind === 'field'}
        <div>
          <dt>Requirement</dt>
          <dd>{topic.required ? 'Required' : 'Optional'}</dd>
        </div>
      {/if}
      {#if topic.defaultValue !== undefined}
        <div>
          <dt>Default</dt>
          <dd><code>{displayValue(topic.defaultValue)}</code></dd>
        </div>
      {/if}
      <div>
        <dt>Profile status</dt>
        <dd>{topic.status} · {topic.profile}</dd>
      </div>
      {#if topic.constraints && Object.keys(topic.constraints).length > 0}
        <div>
          <dt>Constraints</dt>
          <dd><code>{JSON.stringify(topic.constraints)}</code></dd>
        </div>
      {/if}
    </dl>
  {/if}

  {#if topic.examples.length > 0}
    <section aria-label="Examples">
      <h3>Examples</h3>
      <pre>{topic.examples.map((example) => displayValue(example)).join('\n\n')}</pre>
    </section>
  {/if}

  <div class="markdown" use:delegateLinks use:renderSanitized={topic.body}></div>

  {#if topic.relatedTopicIds?.some((id) => index.byId.has(id))}
    <section aria-labelledby="related-topics-heading">
      <h3 id="related-topics-heading">Related topics</h3>
      <div class="related-topics">
        {#each topic.relatedTopicIds as id (id)}
          {@const related = index.byId.get(id)}
          {#if related}
            <button
              type="button"
              aria-label={`${related.title}, ${related.qualifier}`}
              onclick={(event) => onSelectTopic(related, event.currentTarget)}
            >
              <strong>{related.title}</strong><span>{related.qualifier}</span>
            </button>
          {/if}
        {/each}
      </div>
    </section>
  {/if}
</article>

<style>
  article {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-width: 0;
    min-height: 0;
    padding: var(--space-1) var(--space-3) var(--space-4);
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .back-to-results {
    justify-self: start;
  }
  nav ol {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    list-style: none;
  }
  nav li + li::before {
    content: '/';
    margin-inline-end: 0.35rem;
  }
  header {
    display: grid;
    gap: 0.35rem;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  .topic-qualifier,
  .use-when {
    color: var(--color-text-muted);
  }
  .use-when {
    max-width: 68ch;
  }
  .topic-context {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: var(--space-2);
    margin: 0;
  }
  .topic-context div {
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
  }
  dt {
    color: var(--color-text-muted);
    font-size: 0.7rem;
  }
  dd {
    margin: 0.2rem 0 0;
  }
  pre,
  .markdown :global(pre) {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre-wrap;
  }
  .related-topics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .related-topics button {
    display: grid;
    gap: 0.2rem;
    padding: var(--space-2);
    color: var(--color-text);
    text-align: left;
    background: transparent;
    border: 1px solid var(--color-border);
  }
  .related-topics span {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  button:focus-visible,
  article:focus-visible,
  .markdown :global(button:focus-visible) {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    .topic-context div,
    .related-topics button {
      border-color: CanvasText;
    }
  }
</style>
