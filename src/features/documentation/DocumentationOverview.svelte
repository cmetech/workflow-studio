<script lang="ts">
  import { DOCUMENTATION_TASKS, REFERENCE_ENTRY_POINTS, START_HERE } from '$src/lib/docs/navigation'
  import type { ReferenceGroupId } from '$src/lib/docs/types'

  interface Props {
    onSelectTopic: (topicId: string, opener: HTMLElement) => void
    onBrowseReference: (group: ReferenceGroupId, opener: HTMLElement) => void
  }

  let { onSelectTopic, onBrowseReference }: Props = $props()
</script>

<div class="overview">
  <p class="introduction">
    Build and edit Hermes workflows locally. Start with a guide for the task you are doing, or search the complete
    reference when you need a particular node or field.
  </p>

  <section aria-labelledby="start-here-heading">
    <h2 id="start-here-heading">Start here</h2>
    <ol>
      {#each START_HERE as item (item.topicId)}
        <li>
          <button
            type="button"
            data-documentation-focus-origin={`start:${item.topicId}`}
            onclick={(event) => onSelectTopic(item.topicId, event.currentTarget)}
          >
            {item.title}
          </button>
        </li>
      {/each}
    </ol>
  </section>

  <section aria-labelledby="common-tasks-heading">
    <h2 id="common-tasks-heading">Common tasks</h2>
    <div class="cards">
      {#each DOCUMENTATION_TASKS as task (task.id)}
        <button
          type="button"
          class="card"
          data-documentation-focus-origin={`task:${task.id}`}
          onclick={(event) => onSelectTopic(task.topicId, event.currentTarget)}
        >
          <strong>{task.title}</strong>
          <span>{task.description}</span>
        </button>
      {/each}
    </div>
  </section>

  <section aria-labelledby="browse-reference-heading">
    <h2 id="browse-reference-heading">Browse reference</h2>
    <div class="cards reference-cards">
      {#each REFERENCE_ENTRY_POINTS as entry (entry.group)}
        <button
          type="button"
          class="card"
          data-documentation-focus-origin={`reference-entry:${entry.group}`}
          onclick={(event) => onBrowseReference(entry.group, event.currentTarget)}
        >
          <strong>{entry.title}</strong>
          <span>{entry.description}</span>
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .overview {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    padding-block-end: var(--space-4);
  }
  .introduction {
    max-width: 68ch;
    margin: 0;
    color: var(--color-text-muted);
  }
  section {
    display: grid;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  ol {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding-inline-start: 1.5rem;
  }
  ol button {
    min-height: 2rem;
    color: var(--color-accent);
    text-align: left;
    background: transparent;
    border: 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    gap: var(--space-2);
  }
  .card {
    display: grid;
    gap: 0.3rem;
    min-width: 0;
    min-height: 5rem;
    padding: var(--space-2);
    color: var(--color-text);
    text-align: left;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.4rem;
  }
  .card span {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    .card {
      border-color: CanvasText;
    }
  }
</style>
