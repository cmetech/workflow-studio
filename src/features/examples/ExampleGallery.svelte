<script lang="ts">
  import type { ExampleDescriptor } from '$src/lib/examples/types'

  interface Props {
    examples: readonly ExampleDescriptor[]
    topicLabels: Readonly<Record<string, string>>
    onCreateEditableCopy: (example: ExampleDescriptor) => void | Promise<void>
    onOpenDocumentation: (example: ExampleDescriptor, topicId: string) => void
  }

  let { examples, topicLabels, onCreateEditableCopy, onOpenDocumentation }: Props = $props()
  let preview = $state<ExampleDescriptor | null>(null)
</script>

<section class="example-gallery" aria-labelledby="examples-title">
  <h2 id="examples-title">Examples</h2>
  <p class="intro">Validated bundled workflows are read-only. Create a copy to edit one in the current workspace.</p>
  <div class="cards">
    {#each examples as example (example.id)}
      <article class="card">
        <h3>{example.title}</h3>
        <p>{example.summary}</p>
        <dl>
          <div>
            <dt>Profile</dt>
            <dd>{example.profile}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{example.difficulty}</dd>
          </div>
          <div>
            <dt>Nodes</dt>
            <dd>{example.highlightedNodeIds.join(', ')}</dd>
          </div>
          <div>
            <dt>Concepts</dt>
            <dd>{example.concepts.join(', ')}</dd>
          </div>
        </dl>
        <div class="topics" aria-label={`${example.title} documentation`}>
          {#each example.documentationTopicIds as topicId (topicId)}
            <button type="button" onclick={() => onOpenDocumentation(example, topicId)}>
              Open documentation: {topicLabels[`${example.profile}:${topicId}`] ?? topicId}
            </button>
          {/each}
        </div>
        <div class="actions">
          <button type="button" onclick={() => (preview = example)}>Preview {example.title}</button>
          <button type="button" onclick={() => onCreateEditableCopy(example)}
            >Create Editable Copy: {example.title}</button
          >
        </div>
      </article>
    {/each}
  </div>
  {#if preview}
    <section class="preview" aria-label="Example preview">
      <div>
        <h3>{preview.title} preview</h3>
        <button type="button" onclick={() => (preview = null)}>Close preview</button>
      </div>
      <pre>{preview.definitionText}</pre>
      {#if preview.companionText}<pre>{preview.companionText}</pre>{/if}
    </section>
  {/if}
</section>

<style>
  .example-gallery {
    padding: 1rem;
    overflow: auto;
  }
  .intro {
    color: var(--color-text-muted);
  }
  .cards {
    display: grid;
    gap: 0.75rem;
  }
  .card {
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-node);
  }
  h3 {
    margin: 0 0 0.4rem;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem;
    font-size: 0.875rem;
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .preview {
    margin-top: 1rem;
    border-top: 1px solid var(--color-border);
    padding-top: 1rem;
  }
  .preview > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  pre {
    overflow: auto;
    padding: 0.75rem;
    background: var(--color-yaml-gutter);
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
