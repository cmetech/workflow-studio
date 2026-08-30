<script lang="ts">
  import { executeCommand, type CommandSurface } from '$src/lib/commands/registry'
  import type { CommandContext } from '$src/lib/commands/types'
  import type { DocumentKind, IssueLayer, ValidationIssue } from '$src/lib/documents/types'
  import { selectProblem } from '$src/stores/documents'

  interface Props {
    issues: readonly ValidationIssue[]
    paths: Readonly<Record<DocumentKind, string | null>>
    execute?: CommandSurface['executeCommand']
    onDocumentation?: ((id: string) => void) | undefined
  }

  interface IssueGroup {
    readonly document: DocumentKind
    readonly path: string
    readonly layers: readonly { readonly layer: IssueLayer; readonly issues: readonly ValidationIssue[] }[]
  }

  let { issues, paths, execute = executeCommand, onDocumentation }: Props = $props()
  const groups = $derived(groupIssues(issues, paths))
  const blockingCount = $derived(issues.filter((issue) => issue.blocking).length)
  const focusContext: CommandContext = { surface: 'global', canMutate: false, hasSelection: true }

  function groupIssues(
    values: readonly ValidationIssue[],
    filePaths: Readonly<Record<DocumentKind, string | null>>,
  ): readonly IssueGroup[] {
    const documents: readonly DocumentKind[] = ['definition', 'companion']
    const layers: readonly IssueLayer[] = ['syntax', 'contract', 'semantic', 'compatibility', 'operational']
    return documents.flatMap((document) => {
      const documentIssues = values.filter((issue) => issue.document === document)
      if (documentIssues.length === 0) return []
      return [
        {
          document,
          path: filePaths[document] ?? document,
          layers: layers.flatMap((layer) => {
            const layerIssues = documentIssues.filter((issue) => issue.layer === layer)
            return layerIssues.length > 0 ? [{ layer, issues: layerIssues }] : []
          }),
        },
      ]
    })
  }

  function layerName(layer: IssueLayer): string {
    return layer[0]?.toUpperCase() + layer.slice(1)
  }

  function focusIssue(issue: ValidationIssue): void {
    if (issue.documentationId) {
      onDocumentation?.(issue.documentationId)
      return
    }
    selectProblem(issue)
    void execute('problems.focus', focusContext)
  }
</script>

<section class="problems" aria-labelledby="problems-heading">
  <header>
    <h2 id="problems-heading">Problems</h2>
    <p class="summary" aria-live="polite">
      {issues.length}
      {issues.length === 1 ? 'problem' : 'problems'}, {blockingCount} blocking
    </p>
  </header>

  {#if groups.length === 0}
    <p class="empty">No problems found.</p>
  {:else}
    <div class="groups">
      {#each groups as group (group.document)}
        <section class="file-group" aria-labelledby={`problems-${group.document}`}>
          <h3 id={`problems-${group.document}`}>{group.path}</h3>
          {#each group.layers as layer (`${group.document}:${layer.layer}`)}
            <section class="layer-group" aria-labelledby={`problems-${group.document}-${layer.layer}`}>
              <h4 id={`problems-${group.document}-${layer.layer}`}>{layerName(layer.layer)}</h4>
              <ul>
                {#each layer.issues as issue (`${issue.code}:${issue.path ?? ''}:${issue.message}`)}
                  <li>
                    <button
                      type="button"
                      aria-label={`${issue.message}. ${issue.blocking ? 'Blocks save and export' : 'Advisory'}`}
                      onclick={() => focusIssue(issue)}
                    >
                      <span class:error={issue.blocking} class="indicator" aria-hidden="true"></span>
                      <span class="issue-copy">
                        <strong>{issue.message}</strong>
                        <span>{issue.blocking ? 'Blocks save and export' : 'Advisory'}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</section>

<style>
  .problems {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    color: var(--color-text);
    background: var(--color-surface);
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
  h4,
  p,
  ul {
    margin: 0;
  }

  h2,
  h4 {
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

  h4 {
    margin-top: 0.625rem;
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
