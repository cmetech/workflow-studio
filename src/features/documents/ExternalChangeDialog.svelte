<script lang="ts">
  import { onMount } from 'svelte'
  import type { ExternalChangeChoice } from './document-actions'

  interface ChangedFile {
    readonly relativePath: string
    readonly modifiedAt: string
  }

  interface Props {
    files: readonly ChangedFile[]
    diffViewed: boolean
    onChoice: (choice: ExternalChangeChoice) => void
  }

  let { files, diffViewed, onChoice }: Props = $props()
  let compareButton: HTMLButtonElement

  onMount(() => compareButton.focus())
</script>

<section class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="external-change-title">
    <header>
      <p class="eyebrow">External change</p>
      <h2 id="external-change-title">Workflow changed on disk</h2>
    </header>
    <p>Your unsaved edits differ from newer workspace files.</p>
    <ul aria-label="Changed files">
      {#each files as file (file.relativePath)}
        <li>
          <strong>{file.relativePath}</strong>
          <time datetime={file.modifiedAt}>{file.modifiedAt}</time>
        </li>
      {/each}
    </ul>
    {#if !diffViewed}
      <p class="hint">Compare the versions before choosing Keep Mine.</p>
    {/if}
    <footer>
      <button type="button" class="secondary" onclick={() => onChoice('reload-disk')}>Reload Disk</button>
      <button type="button" class="secondary" disabled={!diffViewed} onclick={() => onChoice('keep-mine')}
        >Keep Mine</button
      >
      <button bind:this={compareButton} type="button" class="primary" onclick={() => onChoice('compare')}
        >Compare</button
      >
    </footer>
  </div>
</section>

<style>
  .backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: color-mix(in srgb, var(--color-background) 72%, transparent);
  }

  .dialog {
    width: min(34rem, 100%);
    padding: 1.25rem;
    border: 1px solid var(--color-border);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 1.25rem 4rem var(--color-shadow);
  }

  header,
  footer {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  header {
    align-items: baseline;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 1.125rem;
  }

  .eyebrow {
    color: var(--color-accent);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .dialog > p,
  ul {
    margin-top: 1rem;
  }

  ul {
    display: grid;
    gap: 0.375rem;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    background: var(--color-yaml-gutter);
  }

  time,
  .hint {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }

  footer {
    justify-content: flex-end;
    margin-top: 1.25rem;
  }

  button {
    min-height: 2.25rem;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.375rem;
    color: var(--color-text);
    background: transparent;
  }

  button.primary {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
