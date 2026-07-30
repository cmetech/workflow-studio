<script lang="ts">
  interface Props {
    files: readonly string[]
    diff: string
    findings: readonly string[]
    ready: boolean
    onCreate: (message: string) => void | Promise<void>
    onCancel: () => void
  }

  let { files, diff, findings, ready, onCreate, onCancel }: Props = $props()
  let message = $state('')

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const value = message.trim()
    if (!ready || !value) return
    void onCreate(value)
  }
</script>

<dialog open aria-labelledby="create-version-title">
  <form onsubmit={submit}>
    <h2 id="create-version-title">Create local version</h2>
    <p>Only these workflow files will be committed:</p>
    <ul class="files">
      {#each files as file (file)}
        <li><code>{file}</code></li>
      {/each}
    </ul>
    <label>
      Version message
      <input bind:value={message} required />
    </label>
    <p class="note">Local Git hooks may run and can reject this version.</p>
    {#if findings.length > 0}
      <h3>Warnings and advisories</h3>
      <ul>
        {#each findings as finding, index (index)}<li>{finding}</li>{/each}
      </ul>
    {/if}
    <h3>Combined pair diff</h3>
    <pre>{diff || 'No diff available.'}</pre>
    {#if !ready}<p role="status">Save the current structurally valid YAML before creating a version.</p>{/if}
    <footer>
      <button type="button" onclick={onCancel}>Cancel</button>
      <button type="submit" disabled={!ready || !message.trim()}>Create version</button>
    </footer>
  </form>
</dialog>

<style>
  dialog {
    max-width: 44rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
  }
  form,
  label {
    display: grid;
    gap: 0.625rem;
  }
  ul {
    margin: 0;
  }
  pre {
    max-height: 16rem;
    overflow: auto;
    padding: 0.75rem;
    background: var(--color-canvas);
    white-space: pre-wrap;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .note {
    color: var(--color-text-muted);
  }
</style>
