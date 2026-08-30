<script lang="ts">
  import type { ExampleDescriptor } from '$src/lib/examples/types'

  type ExampleCatalogState =
    | { readonly phase: 'loading' }
    | { readonly phase: 'ready'; readonly examples: readonly ExampleDescriptor[] }
    | { readonly phase: 'empty' }
    | { readonly phase: 'error'; readonly message: string }

  interface Props {
    catalogState: ExampleCatalogState
    topicLabels: Readonly<Record<string, string>>
    onCreateEditableCopy: (example: ExampleDescriptor) => void | Promise<void>
    onOpenDocumentation: (example: ExampleDescriptor, topicId: string, opener: HTMLButtonElement) => void
    onRetry?: () => void | Promise<void>
    embedded?: boolean
  }

  let {
    catalogState,
    topicLabels,
    onCreateEditableCopy,
    onOpenDocumentation,
    onRetry,
    embedded = false,
  }: Props = $props()
  let selectedExample = $state<ExampleDescriptor | null>(null)
</script>

<section class="example-gallery" aria-labelledby={embedded ? undefined : 'examples-title'}>
  {#if !embedded}<h2 id="examples-title">Examples</h2>{/if}
  {#if catalogState.phase === 'loading'}
    <p class="catalog-state" role="status">Loading validated examples…</p>
  {:else if catalogState.phase === 'empty'}
    <p class="catalog-state" role="status">No bundled examples are available.</p>
  {:else if catalogState.phase === 'error'}
    <div class="catalog-state" role="alert">
      <p>{catalogState.message}</p>
      {#if onRetry}
        <button type="button" onclick={() => void onRetry()}>Retry loading examples</button>
      {/if}
    </div>
  {:else if selectedExample}
    <section class="preview" aria-label={`${selectedExample.title} preview`}>
      <header class="preview-header">
        <button type="button" data-variant="ghost" onclick={() => (selectedExample = null)}>Back to Examples</button>
        <div>
          <h3>{selectedExample.title}</h3>
          <p>{selectedExample.summary}</p>
        </div>
      </header>
      <dl>
        <div>
          <dt>Profile</dt>
          <dd>{selectedExample.profile}</dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>{selectedExample.difficulty}</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>{selectedExample.highlightedNodeIds.join(', ')}</dd>
        </div>
        <div>
          <dt>Concepts</dt>
          <dd>{selectedExample.concepts.join(', ')}</dd>
        </div>
      </dl>
      <div class="topics" aria-label={`${selectedExample.title} documentation`}>
        {#each selectedExample.documentationTopicIds as topicId (topicId)}
          <button
            type="button"
            onclick={(event) => onOpenDocumentation(selectedExample!, topicId, event.currentTarget)}
          >
            Open documentation: {topicLabels[`${selectedExample.profile}:${topicId}`] ?? topicId}
          </button>
        {/each}
      </div>
      <div class="actions">
        <button type="button" data-variant="primary" onclick={() => onCreateEditableCopy(selectedExample!)}
          >Create Editable Copy: {selectedExample.title}</button
        >
      </div>
      <div class="yaml-files">
        <section aria-label="Definition YAML">
          <h4>Definition YAML</h4>
          <pre><code>{selectedExample.definitionText}</code></pre>
        </section>
        {#if selectedExample.companionText}
          <section aria-label="Companion YAML">
            <h4>Companion YAML</h4>
            <pre><code>{selectedExample.companionText}</code></pre>
          </section>
        {/if}
      </div>
    </section>
  {:else}
    <p class="intro">Validated bundled workflows are read-only. Create a copy to edit one in the current workspace.</p>
    <div class="cards">
      {#each catalogState.examples as example (example.id)}
        <article class="card" aria-label={example.title}>
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
              <button type="button" onclick={(event) => onOpenDocumentation(example, topicId, event.currentTarget)}>
                Open documentation: {topicLabels[`${example.profile}:${topicId}`] ?? topicId}
              </button>
            {/each}
          </div>
          <div class="actions">
            <button type="button" onclick={() => (selectedExample = example)}>Preview {example.title}</button>
            <button type="button" onclick={() => onCreateEditableCopy(example)}
              >Create Editable Copy: {example.title}</button
            >
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .example-gallery {
    min-width: 0;
    max-width: 100%;
    padding: var(--space-4);
  }
  .intro {
    color: var(--color-text-muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: var(--space-3);
  }
  .card {
    min-width: 0;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-node);
  }
  h3 {
    margin: 0 0 0.4rem;
    min-width: 0;
    overflow-wrap: anywhere;
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
    display: grid;
    min-width: 0;
    gap: var(--space-3);
  }
  .preview-header {
    display: flex;
    align-items: start;
    gap: var(--space-3);
  }
  .preview-header > div {
    min-width: 0;
  }
  .preview-header p,
  h4,
  .catalog-state p {
    margin: 0;
  }
  .yaml-files {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
    gap: var(--space-3);
    min-width: 0;
  }
  .yaml-files > section {
    min-width: 0;
  }
  pre {
    max-width: 100%;
    overflow-x: auto;
    padding: 0.75rem;
    background: var(--color-yaml-gutter);
  }
  .catalog-state {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (max-width: 40rem) {
    .preview-header {
      align-items: stretch;
      flex-direction: column;
    }

    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
