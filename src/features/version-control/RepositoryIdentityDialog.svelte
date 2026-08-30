<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'

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

  function boundedError(cause: unknown, fallback: string): string {
    const message = cause instanceof Error && cause.message ? cause.message : fallback
    return message.length <= 4096 ? message : `${message.slice(0, 4096)}…`
  }
</script>

<ModalShell
  titleId="repository-identity-title"
  busy={pending}
  dismissible={!pending}
  initialFocusSelector="[data-identity-name]"
  {onCancel}
>
  <form id="repository-identity-form" onsubmit={submit}>
    <h2 id="repository-identity-title">Repository identity</h2>
    <p>
      This author name and email apply to only this repository at <code>{root}</code>. Global Git configuration is
      unchanged.
    </p>
    <label
      >Author name <input data-identity-name value={userName} oninput={editName} required disabled={pending} /></label
    >
    <label>Author email <input value={userEmail} oninput={editEmail} type="email" required disabled={pending} /></label>
    {#if error}<p role="alert">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <div class="dialog-actions">
      <button type="button" onclick={onCancel} disabled={pending}>Cancel</button>
      <button form="repository-identity-form" type="submit" disabled={pending || !userName.trim() || !userEmail.trim()}
        >Save repository identity</button
      >
    </div>
  {/snippet}
</ModalShell>

<style>
  form,
  label {
    display: grid;
    gap: 0.75rem;
  }
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
