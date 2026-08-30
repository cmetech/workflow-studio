<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { CreateVersionOutcome } from '$src/lib/git/version-actions'

  interface Props {
    files: readonly string[]
    diff: string
    findings: readonly string[]
    ready: boolean
    onCreate: (message: string) => void | CreateVersionOutcome | Promise<void | CreateVersionOutcome>
    onCancel: () => void
    onComplete?: (() => void) | undefined
  }

  let { files, diff, findings, ready, onCreate, onCancel, onComplete }: Props = $props()
  let message = $state('')
  let pending = $state(false)
  let error = $state<string | null>(null)
  let terminal = $state<CreateVersionOutcome | null>(null)

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const value = message.trim()
    if (pending || terminal || !ready || !value) return
    pending = true
    error = null
    try {
      const result = await onCreate(value)
      if (result?.status === 'unknown' || (result?.status === 'committed' && result.warnings.length > 0)) {
        terminal = result
      } else {
        onComplete?.()
      }
    } catch (cause: unknown) {
      error = boundedError(cause, 'The local version could not be created.')
    } finally {
      pending = false
    }
  }

  function editMessage(event: Event): void {
    message = (event.currentTarget as HTMLInputElement).value
    error = null
  }

  function boundedError(cause: unknown, fallback: string): string {
    const message = cause instanceof Error && cause.message ? cause.message : fallback
    return message.length <= 4096 ? message : `${message.slice(0, 4096)}…`
  }
</script>

<ModalShell
  titleId="create-version-title"
  busy={pending}
  dismissible={!pending}
  initialFocusSelector="[data-version-message]"
  {onCancel}
>
  <form id="create-version-form" onsubmit={submit}>
    <h2 id="create-version-title">Create local version</h2>
    <p>Only these workflow files will be committed:</p>
    <ul class="files">
      {#each files as file (file)}
        <li><code>{file}</code></li>
      {/each}
    </ul>
    <label>
      Version message
      <input
        data-version-message
        value={message}
        oninput={editMessage}
        required
        disabled={pending || Boolean(terminal)}
      />
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
    {#if error}<p role="alert">{error}</p>{/if}
    {#if terminal?.status === 'committed'}
      <p role="status">Version {terminal.oid.slice(0, 12)} committed. {terminal.warnings.join(' ')}</p>
    {:else if terminal?.status === 'unknown'}
      <p role="alert">{terminal.message} Inspect repository before retrying.</p>
    {/if}
  </form>
  {#snippet actions()}
    <div class="dialog-actions">
      {#if terminal}
        <button type="button" onclick={onCancel}>Close</button>
      {:else}
        <button type="button" onclick={onCancel} disabled={pending}>Cancel</button>
        <button form="create-version-form" type="submit" disabled={pending || !ready || !message.trim()}
          >Create version</button
        >
      {/if}
    </div>
  {/snippet}
</ModalShell>

<style>
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
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  code,
  li {
    overflow-wrap: anywhere;
  }
  .note {
    color: var(--color-text-muted);
  }
</style>
