<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    root: string
    onSave: (identity: { userName: string; userEmail: string }) => void | Promise<void>
    onCancel: () => void
  }
  let { root, onSave, onCancel }: Props = $props()
  let userName = $state('')
  let userEmail = $state('')
  let pending = $state(false)
  let error = $state<string | null>(null)
  let dialogElement: HTMLDialogElement
  let nameInput: HTMLInputElement

  onMount(() => nameInput.focus())

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const identity = { userName: userName.trim(), userEmail: userEmail.trim() }
    if (pending || !identity.userName || !identity.userEmail) return
    pending = true
    error = null
    try {
      await onSave(identity)
    } catch (cause: unknown) {
      error = boundedError(cause, 'The repository identity could not be saved.')
    } finally {
      pending = false
    }
  }

  function editName(event: Event): void {
    userName = (event.currentTarget as HTMLInputElement).value
    error = null
  }

  function editEmail(event: Event): void {
    userEmail = (event.currentTarget as HTMLInputElement).value
    error = null
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!pending) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(
      dialogElement.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    )
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
  aria-labelledby="repository-identity-title"
  aria-modal="true"
  aria-busy={pending}
  onkeydown={handleKeydown}
>
  <form onsubmit={submit}>
    <h2 id="repository-identity-title">Repository identity</h2>
    <p>
      This author name and email apply to only this repository at <code>{root}</code>. Global Git configuration is
      unchanged.
    </p>
    <label
      >Author name <input
        bind:this={nameInput}
        value={userName}
        oninput={editName}
        required
        disabled={pending}
      /></label
    >
    <label>Author email <input value={userEmail} oninput={editEmail} type="email" required disabled={pending} /></label>
    {#if error}<p role="alert">{error}</p>{/if}
    <footer>
      <button type="button" onclick={onCancel} disabled={pending}>Cancel</button>
      <button type="submit" disabled={pending || !userName.trim() || !userEmail.trim()}>Save repository identity</button
      >
    </footer>
  </form>
</dialog>

<style>
  form,
  label {
    display: grid;
    gap: 0.75rem;
  }
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
</style>
