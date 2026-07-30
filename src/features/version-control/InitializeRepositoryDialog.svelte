<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    root: string
    onConfirm: () => void | Promise<void>
    onCancel: () => void
  }
  let { root, onConfirm, onCancel }: Props = $props()
  let pending = $state(false)
  let error = $state<string | null>(null)
  let dialogElement: HTMLDialogElement
  let cancelButton: HTMLButtonElement

  onMount(() => cancelButton.focus())

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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!pending) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(dialogElement.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    if (controls.length === 0) return
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault()
      controls.at(-1)!.focus()
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault()
      controls[0]!.focus()
    }
  }

  function boundedError(cause: unknown, fallback: string): string {
    const message = cause instanceof Error && cause.message ? cause.message : fallback
    return message.length <= 4096 ? message : `${message.slice(0, 4096)}…`
  }
</script>

<dialog
  bind:this={dialogElement}
  open
  aria-labelledby="initialize-repository-title"
  aria-modal="true"
  aria-busy={pending}
  onkeydown={handleKeydown}
>
  <form onsubmit={submit}>
    <h2 id="initialize-repository-title">Initialize repository</h2>
    <p>Git will initialize exactly this selected workspace root:</p>
    <code>{root}</code>
    <p>This does not create a commit or add any workflow files.</p>
    {#if error}<p role="alert">{error}</p>{/if}
    <footer>
      <button bind:this={cancelButton} type="button" onclick={onCancel} disabled={pending}>Cancel</button>
      <button type="submit" disabled={pending}>Initialize repository</button>
    </footer>
  </form>
</dialog>

<style>
  dialog {
    max-width: 36rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  form {
    display: grid;
    gap: 0.75rem;
  }
</style>
