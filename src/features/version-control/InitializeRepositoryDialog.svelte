<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'

  interface Props {
    root: string
    onConfirm: () => void | Promise<void>
    onCancel: () => void
  }
  let { root, onConfirm, onCancel }: Props = $props()
  let pending = $state(false)
  let error = $state<string | null>(null)

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (pending) return
    pending = true
    error = null
    try {
      await onConfirm()
    } catch (cause: unknown) {
      error = boundedError(cause, 'The repository could not be initialized.')
    } finally {
      pending = false
    }
  }

  function boundedError(cause: unknown, fallback: string): string {
    const message = cause instanceof Error && cause.message ? cause.message : fallback
    return message.length <= 4096 ? message : `${message.slice(0, 4096)}…`
  }
</script>

<ModalShell
  titleId="initialize-repository-title"
  busy={pending}
  dismissible={!pending}
  initialFocusSelector="[data-initialize-cancel]"
  {onCancel}
>
  <form id="initialize-repository-form" onsubmit={submit}>
    <h2 id="initialize-repository-title">Initialize repository</h2>
    <p>Git will initialize exactly this selected workspace root:</p>
    <code>{root}</code>
    <p>This does not create a commit or add any workflow files.</p>
    {#if error}<p role="alert">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <div class="dialog-actions">
      <button data-initialize-cancel type="button" onclick={onCancel} disabled={pending}>Cancel</button>
      <button form="initialize-repository-form" type="submit" disabled={pending}>Initialize repository</button>
    </div>
  {/snippet}
</ModalShell>

<style>
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  form {
    display: grid;
    gap: 0.75rem;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
