<script lang="ts">
  interface Props {
    root: string
    onConfirm: () => void | Promise<void>
    onCancel: () => void
  }
  let { root, onConfirm, onCancel }: Props = $props()
</script>

<dialog open aria-labelledby="initialize-repository-title">
  <h2 id="initialize-repository-title">Initialize repository</h2>
  <p>Git will initialize exactly this selected workspace root:</p>
  <code>{root}</code>
  <p>This does not create a commit or add any workflow files.</p>
  <footer>
    <button type="button" onclick={onCancel}>Cancel</button>
    <button type="button" onclick={() => void onConfirm()}>Initialize repository</button>
  </footer>
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
</style>
