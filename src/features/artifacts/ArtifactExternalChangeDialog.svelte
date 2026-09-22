<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { ArtifactExternalChangeChoice } from './artifact-workspace-controller'

  interface Props {
    path: string
    missing?: boolean
    diffViewed: boolean
    onChoice: (choice: ArtifactExternalChangeChoice) => void
    opener?: HTMLElement | null
  }

  let { path, diffViewed, onChoice, opener, missing = false }: Props = $props()
</script>

<ModalShell
  titleId="artifact-external-change-title"
  opener={opener ?? null}
  dismissible={false}
  onCancel={() => undefined}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <div class="external-change-body" data-modal-background="blocked">
    <header>
      <p class="eyebrow">External change</p>
      <h2 id="artifact-external-change-title">Artifact changed on disk</h2>
    </header>
    {#if missing}
      <p>
        The artifact was removed from disk. Keep Mine recreates it. Reload Disk closes the editor and retains your
        recovery draft.
      </p>
    {:else}
      <p>Your unsaved edits differ from the newer artifact on disk.</p>
    {/if}
    <p><strong>{path}</strong></p>
    {#if !diffViewed}
      <p class="hint">Compare the versions before choosing Keep Mine.</p>
    {/if}
  </div>
  {#snippet actions()}
    <button type="button" class="secondary" onclick={() => onChoice('reload-disk')}>Reload Disk</button>
    <button type="button" class="secondary" disabled={!diffViewed} onclick={() => onChoice('keep-mine')}
      >Keep Mine</button
    >
    <button data-modal-initial-focus type="button" class="primary" onclick={() => onChoice('compare')}>Compare</button>
  {/snippet}
</ModalShell>

<style>
  .external-change-body {
    min-width: 0;
  }

  header {
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
    color: var(--color-accent-on-surface);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .external-change-body > p {
    margin-top: 1rem;
  }

  .hint {
    color: var(--color-text-muted);
    font-size: 0.75rem;
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
    border-color: var(--color-primary);
    color: var(--color-primary-contrast);
    background: var(--color-primary);
  }

  button.primary:hover:not(:disabled) {
    border-color: var(--color-primary-hover);
    color: var(--color-primary-hover-contrast);
    background: var(--color-primary-hover);
  }

  button.primary:active:not(:disabled) {
    border-color: var(--color-primary-active);
    color: var(--color-primary-active-contrast);
    background: var(--color-primary-active);
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
