<script lang="ts">
  import { searchDocumentation } from '$src/lib/docs/build-index'
  import { GUIDE_GROUPS } from '$src/lib/docs/navigation'
  import type { DocumentationIndex, DocumentationTopic, ReferenceGroupId } from '$src/lib/docs/types'

  interface Props {
    index: DocumentationIndex
    mode: 'guides' | 'reference' | 'all'
    query: string
    highlightedTopicId?: string
    expandedGroupIds: readonly string[]
    onSelect: (topic: DocumentationTopic, opener: HTMLElement) => void
    onHighlight: (topicId: string) => void
    onToggleGroup: (groupId: string) => void
  }

  type NavigationEntry =
    | { readonly kind: 'topic'; readonly topic: DocumentationTopic }
    | {
        readonly kind: 'duplicate'
        readonly id: string
        readonly title: string
        readonly topics: readonly DocumentationTopic[]
      }

  interface NodeSpecificGroup {
    readonly id: string
    readonly label: string
    readonly topics: readonly DocumentationTopic[]
  }

  const referenceGroups: readonly { readonly id: ReferenceGroupId; readonly title: string }[] = [
    { id: 'node-types', title: 'Node types' },
    { id: 'common-node-settings', title: 'Common node settings' },
    { id: 'node-specific-fields', title: 'Node-specific fields' },
    { id: 'workflow-fields', title: 'Workflow fields' },
    { id: 'companion-policy', title: 'Companion policy' },
    { id: 'language-contract', title: 'Language contract' },
  ]

  let { index, mode, query, highlightedTopicId, expandedGroupIds, onSelect, onHighlight, onToggleGroup }: Props =
    $props()

  const results = $derived(query.trim() ? searchDocumentation(index, query, { mode }) : [])
  function normalizedTitle(title: string): string {
    return title.toLocaleLowerCase('en-US')
  }

  function entriesFor(topics: readonly DocumentationTopic[]): readonly NavigationEntry[] {
    const topicIds = new Set(topics.map(({ id }) => id))
    const emitted: string[] = []
    const entries: NavigationEntry[] = []
    for (const topic of topics) {
      const key = normalizedTitle(topic.title)
      if (emitted.includes(key)) continue
      emitted.push(key)
      const duplicates = (index.duplicateTitleGroups.get(key) ?? []).filter(({ id }) => topicIds.has(id))
      if (duplicates.length > 1) {
        entries.push({ kind: 'duplicate', id: `duplicate:${key}`, title: topic.title, topics: duplicates })
      } else {
        entries.push({ kind: 'topic', topic })
      }
    }
    return entries
  }

  function nodeTypeCount(topics: readonly DocumentationTopic[]): number {
    return new Set(topics.flatMap(({ nodeKinds }) => nodeKinds ?? [])).size
  }

  function topicAccessibleName(topic: DocumentationTopic): string {
    const base = `${topic.title}, ${topic.qualifier}`
    const collides = index.topics.some(
      (candidate) =>
        candidate.id !== topic.id &&
        normalizedTitle(candidate.title) === normalizedTitle(topic.title) &&
        normalizedTitle(candidate.qualifier) === normalizedTitle(topic.qualifier),
    )
    const location = topic.fieldPaths[0]
    return collides && location ? `${base}, ${location}` : base
  }

  function nodeSpecificGroups(topics: readonly DocumentationTopic[]): readonly NodeSpecificGroup[] {
    const groups: { id: string; label: string; topics: DocumentationTopic[] }[] = []
    for (const topic of topics) {
      const id = topic.nodeKinds?.[0] ?? 'other'
      const current = groups.find((group) => group.id === id)
      if (current) current.topics.push(topic)
      else groups.push({ id, label: topic.qualifier, topics: [topic] })
    }
    return groups.sort((left, right) => left.label.localeCompare(right.label))
  }

  function emptyMessage(): string {
    const scope = mode === 'guides' ? 'guides' : mode === 'reference' ? 'reference topics' : 'documentation'
    return `No ${scope} match “${query}”.${mode === 'all' ? '' : ' Try All documentation.'}`
  }
</script>

{#snippet topicEntries(topics: readonly DocumentationTopic[])}
  {#each entriesFor(topics) as entry (entry.kind === 'topic' ? entry.topic.id : entry.id)}
    {#if entry.kind === 'duplicate'}
      {@const count = nodeTypeCount(entry.topics)}
      <div class="duplicate-group">
        <button
          type="button"
          class="disclosure"
          aria-label={`${entry.title}, used by ${count} node ${count === 1 ? 'type' : 'types'}`}
          aria-expanded={expandedGroupIds.includes(entry.id)}
          onclick={() => onToggleGroup(entry.id)}
        >
          <strong>{entry.title}</strong>
          <span>Used by {count} node {count === 1 ? 'type' : 'types'}</span>
        </button>
        {#if expandedGroupIds.includes(entry.id)}
          <div class="duplicate-children">
            {#each entry.topics as topic (topic.id)}
              <button
                type="button"
                aria-label={topicAccessibleName(topic)}
                data-documentation-focus-origin={`reference-topic:${topic.id}`}
                onclick={(event) => onSelect(topic, event.currentTarget)}
              >
                <strong>{topic.title}</strong><span>{topic.qualifier}</span>
                {#if topicAccessibleName(topic) !== `${topic.title}, ${topic.qualifier}`}
                  <code>{topic.fieldPaths[0]}</code>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        aria-label={topicAccessibleName(entry.topic)}
        data-documentation-focus-origin={`reference-topic:${entry.topic.id}`}
        onclick={(event) => onSelect(entry.topic, event.currentTarget)}
      >
        <strong>{entry.topic.title}</strong><span>{entry.topic.qualifier}</span>
        {#if topicAccessibleName(entry.topic) !== `${entry.topic.title}, ${entry.topic.qualifier}`}
          <code>{entry.topic.fieldPaths[0]}</code>
        {/if}
      </button>
    {/if}
  {/each}
{/snippet}

{#if query.trim()}
  {#if results.length > 0}
    <p class="search-status" role="status">
      {results.length}
      {results.length === 1 ? 'result' : 'results'} for “{query}”.
    </p>
    <ul class="result-list" aria-label="Documentation results">
      {#each results as topic (topic.id)}
        <li>
          <button
            type="button"
            id={`documentation-result-${topic.id}`}
            aria-label={topicAccessibleName(topic)}
            data-documentation-focus-origin={`search-result:${topic.id}`}
            class:highlighted={topic.id === highlightedTopicId}
            onfocus={() => onHighlight(topic.id)}
            onmouseenter={() => onHighlight(topic.id)}
            onclick={(event) => onSelect(topic, event.currentTarget)}
          >
            <span class="result-heading"><strong>{topic.title}</strong><span>{topic.qualifier}</span></span>
            <span class="result-kind">{topic.kind}</span>
            <span class="result-description">{topic.description}</span>
            {#if topic.nodeKinds?.length}
              <span class="badges" aria-label="Applicable nodes">
                {#each topic.nodeKinds as nodeKind (nodeKind)}<span>{nodeKind}</span>{/each}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-results" role="status">{emptyMessage()}</p>
  {/if}
{:else if mode === 'guides'}
  <div class="group-list">
    {#each GUIDE_GROUPS as group (group.id)}
      {@const topics = index.guideGroups.get(group.id) ?? []}
      {#if topics.length > 0}
        <section class="topic-group" aria-labelledby={`documentation-group-${group.id}`} aria-label={group.title}>
          <h2 id={`documentation-group-${group.id}`} tabindex="-1">{group.title}</h2>
          <div class="topic-rows">
            {#each topics as topic (topic.id)}
              <button
                type="button"
                aria-label={`${topic.title}, ${topic.qualifier}`}
                data-documentation-focus-origin={`guide-topic:${topic.id}`}
                onclick={(event) => onSelect(topic, event.currentTarget)}
              >
                <strong>{topic.title}</strong>
                <span>{topic.useWhen}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  </div>
{:else}
  <div class="group-list">
    {#each referenceGroups as group (group.id)}
      {@const topics = index.referenceGroups.get(group.id) ?? []}
      {#if topics.length > 0}
        <section class="topic-group" aria-labelledby={`documentation-group-heading-${group.id}`}>
          <h2 id={`documentation-group-heading-${group.id}`}>
            <button
              type="button"
              id={`documentation-group-${group.id}`}
              class="reference-group-disclosure"
              aria-label={`${group.title}, reference group`}
              aria-expanded={expandedGroupIds.includes(`reference:${group.id}`)}
              onclick={() => onToggleGroup(`reference:${group.id}`)}
            >
              <span>{group.title}</span><span aria-hidden="true">⌄</span>
            </button>
          </h2>
          {#if expandedGroupIds.includes(`reference:${group.id}`)}
            {#if group.id === 'node-specific-fields'}
              <div class="node-specific-groups">
                {#each nodeSpecificGroups(topics) as nodeGroup (nodeGroup.id)}
                  <section class="node-specific-group" aria-label={`${nodeGroup.label} fields`}>
                    <h3>{nodeGroup.label}</h3>
                    <div class="topic-rows">{@render topicEntries(nodeGroup.topics)}</div>
                  </section>
                {/each}
              </div>
            {:else}
              <div class="topic-rows">{@render topicEntries(topics)}</div>
            {/if}
          {/if}
        </section>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .group-list,
  .topic-group,
  .topic-rows,
  .duplicate-group,
  .duplicate-children,
  .node-specific-groups,
  .node-specific-group,
  .result-list {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .group-list {
    gap: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  h3 {
    margin: 0;
    font-size: 0.85rem;
  }
  button {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    padding: var(--space-2);
    color: var(--color-text);
    text-align: left;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0.35rem;
    overflow-wrap: anywhere;
  }
  button span {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  button:focus-visible,
  button.highlighted {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  .disclosure {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  .reference-group-disclosure {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font: inherit;
  }
  .reference-group-disclosure span:first-child {
    color: var(--color-text);
    font-size: inherit;
  }
  .duplicate-children {
    padding-inline-start: var(--space-3);
  }
  .duplicate-children button,
  .result-heading {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  .result-list button {
    display: grid;
    width: 100%;
  }
  .result-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .result-heading {
    display: grid;
    gap: var(--space-2);
  }
  .result-kind {
    text-transform: capitalize;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .badges span {
    padding: 0.15rem 0.35rem;
    border: 1px solid var(--color-border);
    border-radius: 99rem;
  }
  .empty-results {
    margin: 0;
    color: var(--color-text-muted);
  }
  .search-status {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @media (forced-colors: active) {
    button,
    .badges span {
      border-color: CanvasText;
    }
    [aria-expanded='true'] {
      outline: 2px solid Highlight;
    }
  }
</style>
