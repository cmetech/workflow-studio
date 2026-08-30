<script lang="ts">
  import type { GitDiff } from '$src/lib/git/types'

  interface Props {
    diff: GitDiff
    availableWidth?: number
  }
  let { diff, availableWidth = Number.POSITIVE_INFINITY }: Props = $props()
  let mode = $state<'unified' | 'side-by-side'>('unified')
  let insufficientWidth = $state(false)
  const sideBySideAvailable = $derived(availableWidth >= 2 * 360 + 1 + 24)

  $effect(() => {
    if (sideBySideAvailable || mode !== 'side-by-side') return
    mode = 'unified'
    insufficientWidth = true
  })

  interface SideRow {
    readonly before: string
    readonly after: string
  }

  function sideRows(patch: string): readonly SideRow[] {
    const lines = patch.split('\n')
    const rows: SideRow[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
      if (line.startsWith('-')) {
        const next = lines[index + 1]
        if (next?.startsWith('+') && !next.startsWith('+++ ')) {
          rows.push({ before: line.slice(1), after: next.slice(1) })
          index += 1
        } else rows.push({ before: line.slice(1), after: '' })
      } else if (line.startsWith('+')) rows.push({ before: '', after: line.slice(1) })
      else {
        const content = line.startsWith(' ') ? line.slice(1) : line
        rows.push({ before: content, after: content })
      }
    }
    return rows
  }

  function selectUnified(): void {
    mode = 'unified'
    insufficientWidth = false
  }

  function selectSideBySide(): void {
    if (!sideBySideAvailable) {
      mode = 'unified'
      insufficientWidth = true
      return
    }
    mode = 'side-by-side'
    insufficientWidth = false
  }
</script>

<section class="diff-view" aria-label="Workflow pair diff">
  <div class="mode" role="group" aria-label="Diff presentation">
    <button type="button" aria-label="Unified diff" aria-pressed={mode === 'unified'} onclick={selectUnified}
      >Unified</button
    >
    <button
      type="button"
      aria-label="Side-by-side diff"
      aria-pressed={mode === 'side-by-side'}
      onclick={selectSideBySide}>Side by side</button
    >
  </div>
  {#if insufficientWidth}
    <p class="presentation-note" role="status">Side-by-side diff needs more horizontal space. Showing unified diff.</p>
  {/if}
  <h3>Working tree</h3>
  {#if mode === 'unified'}
    <pre>{diff.working || 'No unstaged pair changes.'}</pre>
  {:else}
    <table aria-label="Working tree side-by-side diff">
      <thead><tr><th>Before</th><th>After</th></tr></thead>
      <tbody>
        {#each sideRows(diff.working) as row, index (`${index}:${row.before}:${row.after}`)}
          <tr><td>{row.before}</td><td>{row.after}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <h3>Index</h3>
  {#if mode === 'unified'}
    <pre>{diff.index || 'No staged pair changes.'}</pre>
  {:else}
    <table aria-label="Index side-by-side diff">
      <thead><tr><th>Before</th><th>After</th></tr></thead>
      <tbody>
        {#each sideRows(diff.index) as row, index (`${index}:${row.before}:${row.after}`)}
          <tr><td>{row.before}</td><td>{row.after}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .diff-view {
    display: grid;
    gap: 0.375rem;
    min-width: 0;
  }
  .mode {
    display: flex;
    gap: 0.25rem;
  }
  button {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
    color: var(--color-text);
    background: var(--color-node);
  }
  button[aria-pressed='true'] {
    border-color: var(--color-focus);
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  h3 {
    margin: 0.5rem 0 0;
    font-size: 0.8125rem;
  }
  pre {
    min-width: 0;
    max-height: 12rem;
    margin: 0;
    overflow: auto;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    background: var(--color-yaml-gutter);
    font-size: 0.6875rem;
    white-space: pre-wrap;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
  }
  .presentation-note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  th,
  td {
    padding: 0.25rem;
    overflow-wrap: anywhere;
    border: 1px solid var(--color-border);
    text-align: left;
    vertical-align: top;
  }
</style>
