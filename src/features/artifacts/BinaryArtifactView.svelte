<script lang="ts">
  import type { WorkspaceArtifactMetadata } from '$src/lib/native/types'
  interface Props {
    metadata: WorkspaceArtifactMetadata
    onReplace: () => void | Promise<void>
    onReveal: () => void | Promise<void>
    onOpen: () => void | Promise<void>
  }
  let { metadata, onReplace, onReveal, onOpen }: Props = $props()
  let busy = $state(false),
    error = $state('')
  async function act(action: () => void | Promise<void>) {
    if (busy) return
    busy = true
    error = ''
    try {
      await action()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The resource action failed.'
    } finally {
      busy = false
    }
  }
</script>

<section aria-label="Binary resource">
  <h2>{metadata.relativePath}</h2>
  <dl>
    <dt>Media type</dt>
    <dd>{metadata.mediaType}</dd>
    <dt>Size</dt>
    <dd>{metadata.size} bytes</dd>
    <dt>SHA-256</dt>
    <dd class="digest">{metadata.sha256}</dd>
  </dl>
  <p>This file is included in the package digest.</p>
  <div class="actions">
    <button type="button" disabled={busy || metadata.readOnly} onclick={() => act(onReplace)}>Replace</button>
    <button type="button" disabled={busy} onclick={() => act(onReveal)}>Reveal</button>
    <button type="button" disabled={busy || metadata.mediaType !== 'image/png'} onclick={() => act(onOpen)}
      >Open Externally</button
    >
  </div>
  {#if metadata.mediaType !== 'image/png'}<p>
      Reveal this resource to choose an application. External opening supports verified PNG images.
    </p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>

<style>
  section {
    padding: 1rem;
    min-width: 0;
  }
  h2,
  dd {
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
  }
  dd {
    margin: 0;
  }
  .digest {
    font-family: var(--font-mono);
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  button {
    min-height: 2.25rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
  }
  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
