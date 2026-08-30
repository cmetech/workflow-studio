<script lang="ts">
  import type { GitCommitSummary } from '$src/lib/git/types'

  interface Props {
    history: readonly GitCommitSummary[]
    selectedOid: string | undefined
    onSelect: (oid: string) => void | Promise<void>
    onRestore?: ((oid: string) => void | Promise<void>) | undefined
  }
  let { history, selectedOid, onSelect, onRestore }: Props = $props()
</script>

<section class="history-view" aria-labelledby="git-history-title">
  <h3 id="git-history-title">History</h3>
  {#if history.length === 0}
    <p>No commits touch this workflow pair.</p>
  {:else}
    <ol>
      {#each history as commit (commit.oid)}
        <li>
          <button type="button" aria-pressed={selectedOid === commit.oid} onclick={() => onSelect(commit.oid)}>
            <strong>{commit.subject || '(no subject)'}</strong>
            <span>{commit.shortOid} · {commit.authorName}</span>
            <time datetime={commit.authoredAt}>{commit.authoredAt}</time>
          </button>
          {#if selectedOid === commit.oid && onRestore}
            <button class="restore" type="button" onclick={() => onRestore?.(commit.oid)}>Load as unsaved draft</button>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  h3 {
    margin-bottom: 0.375rem;
  }
  .history-view,
  li,
  button,
  strong,
  span,
  time {
    min-width: 0;
    max-width: 100%;
  }
  ol {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  button {
    display: grid;
    width: 100%;
    gap: 0.125rem;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    color: var(--color-text);
    background: var(--color-node);
    text-align: left;
  }
  button[aria-pressed='true'] {
    border-color: var(--color-focus);
  }
  .restore {
    margin-top: 0.25rem;
    border-color: var(--color-focus);
  }
  span,
  time,
  p {
    color: var(--color-text-muted);
    font-size: 0.6875rem;
  }
  strong,
  span,
  time {
    overflow-wrap: anywhere;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
</style>
