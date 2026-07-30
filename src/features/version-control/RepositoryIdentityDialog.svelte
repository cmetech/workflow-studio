<script lang="ts">
  interface Props {
    root: string
    onSave: (identity: { userName: string; userEmail: string }) => void | Promise<void>
    onCancel: () => void
  }
  let { root, onSave, onCancel }: Props = $props()
  let userName = $state('')
  let userEmail = $state('')

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const identity = { userName: userName.trim(), userEmail: userEmail.trim() }
    if (!identity.userName || !identity.userEmail) return
    void onSave(identity)
  }
</script>

<dialog open aria-labelledby="repository-identity-title">
  <form onsubmit={submit}>
    <h2 id="repository-identity-title">Repository identity</h2>
    <p>
      This author name and email apply to only this repository at <code>{root}</code>. Global Git configuration is
      unchanged.
    </p>
    <label>Author name <input bind:value={userName} required /></label>
    <label>Author email <input bind:value={userEmail} type="email" required /></label>
    <footer>
      <button type="button" onclick={onCancel}>Cancel</button>
      <button type="submit" disabled={!userName.trim() || !userEmail.trim()}>Save repository identity</button>
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
