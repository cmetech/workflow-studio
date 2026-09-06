<script lang="ts">
  import { executeCommand, type CommandSurface } from '$src/lib/commands/registry'
  import type { CommandContext } from '$src/lib/commands/types'
  import type { DocumentKind, IssueLayer, ValidationIssue } from '$src/lib/documents/types'
  import { selectProblem } from '$src/stores/documents'
  import { issueViewKey } from './issue-view-key'

  interface Props {
    issues: readonly ValidationIssue[]
    paths: Readonly<Record<DocumentKind, string | null>>
    hosted?: boolean
    workflowName?: string | undefined
    execute?: CommandSurface['executeCommand']
    onDocumentation?: ((id: string, opener: HTMLButtonElement) => void) | undefined
    scrollTop?: number | undefined
    onScroll?: ((scrollTop: number) => void) | undefined
  }

  interface IssueGroup {
    readonly document: DocumentKind
    readonly path: string
    readonly issues: readonly ValidationIssue[]
  }

  const layers: readonly IssueLayer[] = ['syntax', 'contract', 'semantic', 'compatibility', 'operational']

  let {
    issues,
    paths,
    workflowName,
    hosted = false,
    execute = executeCommand,
    onDocumentation,
    scrollTop = 0,
    onScroll,
  }: Props = $props()
  const id = $props.id()
  let layerTablist = $state<HTMLDivElement>()
  let activeLayer = $state<IssueLayer>('syntax')
  let layerSelectionInitialized = $state(false)
  let scrollOwner = $state<HTMLElement>()
  const groups = $derived(
    groupIssues(
      issues.filter((issue) => issue.layer === activeLayer),
      paths,
    ),
  )
  const blockingCount = $derived(issues.filter((issue) => issue.blocking).length)
  const focusContext: CommandContext = { surface: 'global', canMutate: false, hasSelection: true }

  $effect(() => {
    if (scrollOwner && scrollOwner.scrollTop !== scrollTop) scrollOwner.scrollTop = scrollTop
  })

  $effect(() => {
    if (layerSelectionInitialized) return
    const firstPopulatedLayer = layers.find((layer) => issues.some((issue) => issue.layer === layer))
    if (!firstPopulatedLayer) return
    activeLayer = firstPopulatedLayer
    layerSelectionInitialized = true
  })

  function groupIssues(
    values: readonly ValidationIssue[],
    filePaths: Readonly<Record<DocumentKind, string | null>>,
  ): readonly IssueGroup[] {
    const documents: readonly DocumentKind[] = ['definition', 'companion']
    return documents.flatMap((document) => {
      const documentIssues = values.filter((issue) => issue.document === document)
      if (documentIssues.length === 0) return []
      return [
        {
          document,
          path: filePaths[document] ?? document,
          issues: documentIssues,
        },
      ]
    })
  }

  function layerName(layer: IssueLayer): string {
    return layer[0]?.toUpperCase() + layer.slice(1)
  }

  function layerCount(layer: IssueLayer): number {
    return issues.filter((issue) => issue.layer === layer).length
  }

  function selectLayer(layer: IssueLayer): void {
    activeLayer = layer
    layerSelectionInitialized = true
  }

  function navigateLayers(event: KeyboardEvent, layer: IssueLayer): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation()
      return
    }
    const index = layers.indexOf(layer)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? layers.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (index + 1) % layers.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? (index + layers.length - 1) % layers.length
              : null
    if (next === null) return
    event.preventDefault()
    const nextLayer = layers[next]!
    selectLayer(nextLayer)
    layerTablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  function focusIssue(issue: ValidationIssue): void {
    selectProblem(issue)
    void execute('problems.focus', focusContext)
  }

  function issueContext(issue: ValidationIssue): string {
    return [
      workflowName ? `workflow ${workflowName}` : '',
      issue.groupId ? `group ${issue.groupId}` : '',
      issue.nodeId ? `node ${issue.nodeId}` : '',
      issue.field ?? '',
    ]
      .filter(Boolean)
      .join(', ')
  }

  function duplicateOrdinal(values: readonly ValidationIssue[], index: number): number {
    const fingerprint = issueViewKey(values[index]!, 0)
    return values.slice(0, index).filter((issue) => issueViewKey(issue, 0) === fingerprint).length
  }
</script>

<svelte:element
  this={hosted ? 'div' : 'section'}
  class="problems"
  class:hosted
  aria-labelledby={hosted ? undefined : 'problems-heading'}
  data-scroll-frame={hosted ? undefined : 'problems'}
>
  {#if !hosted}
    <header>
      <h2 id="problems-heading">Problems</h2>
      <p class="summary" aria-live="polite">
        {issues.length}
        {issues.length === 1 ? 'problem' : 'problems'}, {blockingCount} blocking
      </p>
    </header>
  {/if}

  <div class="layer-tabs" role="tablist" aria-label="Validation layers" bind:this={layerTablist}>
    {#each layers as layer (layer)}
      <button
        type="button"
        role="tab"
        id={`${id}-${layer}-tab`}
        aria-controls={`${id}-${layer}-panel`}
        aria-selected={activeLayer === layer}
        tabindex={activeLayer === layer ? 0 : -1}
        onclick={() => selectLayer(layer)}
        onkeydown={(event) => navigateLayers(event, layer)}
      >
        <span>{layerName(layer)}</span>
        <span class="layer-count">{layerCount(layer)}</span>
      </button>
    {/each}
  </div>

  <div
    class="layer-panel"
    role="tabpanel"
    id={`${id}-${activeLayer}-panel`}
    aria-labelledby={`${id}-${activeLayer}-tab`}
    tabindex="0"
  >
    {#if groups.length === 0}
      <p class="empty">No {activeLayer} problems.</p>
    {:else}
      <div
        class="groups"
        data-scroll-owner={hosted ? undefined : 'problems'}
        bind:this={scrollOwner}
        onscroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      >
        {#each groups as group (group.document)}
          <section class="file-group" aria-labelledby={`${id}-${activeLayer}-${group.document}`}>
            <h3 id={`${id}-${activeLayer}-${group.document}`}>{group.path}</h3>
            <ul>
              {#each group.issues as issue, occurrence (issueViewKey(issue, duplicateOrdinal(group.issues, occurrence)))}
                {@const ordinal = duplicateOrdinal(group.issues, occurrence)}
                <li data-issue-key={issueViewKey(issue, ordinal)}>
                  <button
                    type="button"
                    aria-label={`${issueContext(issue)}${issueContext(issue) ? ': ' : ''}${issue.message}. ${issue.blocking ? 'Blocks save and export' : 'Advisory'}`}
                    onclick={() => focusIssue(issue)}
                  >
                    <span class:error={issue.blocking} class="indicator" aria-hidden="true"></span>
                    <span class="issue-copy">
                      <strong>{issue.message}</strong>
                      <span>{issue.blocking ? 'Blocks save and export' : 'Advisory'}</span>
                    </span>
                  </button>
                  {#if issue.documentationId}
                    <button
                      type="button"
                      class="docs-action"
                      aria-label={`Open documentation for ${issue.message}`}
                      onclick={(event) => onDocumentation?.(issue.documentationId!, event.currentTarget)}>Docs</button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</svelte:element>

<style>
  .problems {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    color: var(--color-text);
    background: var(--color-surface);
  }

  .problems.hosted {
    display: block;
    height: auto;
    overflow: visible;
  }

  .hosted .layer-panel,
  .hosted .groups {
    overflow: visible;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 2.625rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  h2,
  h3,
  p,
  ul {
    margin: 0;
  }

  h2 {
    color: var(--color-text-muted);
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .summary {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }

  .layer-tabs {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--color-border);
  }

  .layer-tabs button {
    display: inline-flex;
    gap: 0.375rem;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    width: auto;
    min-height: 2.25rem;
    padding: 0.375rem 0.5rem;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--color-text-muted);
    font-size: 0.6875rem;
  }

  .layer-tabs button[aria-selected='true'] {
    border-bottom-color: var(--color-focus);
    color: var(--color-text);
  }

  .layer-count {
    min-width: 1.25rem;
    padding: 0.0625rem 0.3125rem;
    border-radius: 999px;
    background: var(--color-node);
    color: currentColor;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-align: center;
  }

  .layer-panel {
    min-height: 0;
    overflow: hidden;
  }

  .groups {
    min-height: 0;
    padding: 0.75rem;
    overflow: auto;
  }

  .file-group + .file-group {
    margin-top: 1rem;
  }

  h3 {
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  ul {
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    gap: 0.625rem;
    align-items: flex-start;
    width: 100%;
    padding: 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    color: var(--color-text);
    background: transparent;
    text-align: left;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .docs-action {
    width: auto;
    color: var(--color-text-muted);
    font-size: 0.7rem;
  }

  button:hover {
    background: var(--color-node);
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: -1px;
  }

  .indicator {
    width: 0.5rem;
    height: 0.5rem;
    flex: 0 0 0.5rem;
    margin-top: 0.25rem;
    border-radius: 50%;
    background: var(--color-warning);
  }

  .indicator.error {
    background: var(--color-error);
  }

  .issue-copy {
    display: grid;
    gap: 0.1875rem;
  }

  .issue-copy strong {
    font-size: 0.75rem;
  }

  .issue-copy span,
  .empty {
    color: var(--color-text-muted);
    font-size: 0.6875rem;
  }

  .empty {
    padding: 0.75rem;
  }
</style>
