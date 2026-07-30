<script lang="ts">
  import type { RuntimeBrandPack } from '$src/lib/branding/types'

  interface Props {
    packs: readonly RuntimeBrandPack[]
    activeId: string
    pending: boolean
    warning: string | null
    onImport: () => void | Promise<void>
    onPreview: (id: string) => void
    onActivate: (id: string) => void | Promise<void>
    onRemove: (id: string, revertActive: boolean) => void | Promise<void>
  }

  let { packs, activeId, pending, warning, onImport, onPreview, onActivate, onRemove }: Props = $props()
  let removal: RuntimeBrandPack | null = $state(null)
</script>

<section class="brand-settings" aria-labelledby="brand-settings-title" aria-busy={pending}>
  <header>
    <h2 id="brand-settings-title">Brand and theme packs</h2>
    <p>Runtime packs change in-app identity and semantic colors only. Installed application icons remain LOOP24.</p>
    <button type="button" disabled={pending} onclick={() => void onImport()}>Import brand pack</button>
  </header>
  {#if warning}<p role="status">{warning}</p>{/if}
  <ul aria-label="Available brand packs">
    {#each packs as pack (pack.manifest.id)}
      <li>
        <img src={pack.assetUrls.mark} alt="" />
        <div class="identity">
          <strong>{pack.manifest.displayName}</strong>
          <span
            >{pack.builtIn ? 'Bundled' : pack.previewOnly ? 'Preview only' : 'Imported'}{activeId === pack.manifest.id
              ? ' · Active'
              : ''}</span
          >
        </div>
        <div class="actions">
          <button type="button" disabled={pending} onclick={() => onPreview(pack.manifest.id)}>
            Preview {pack.manifest.displayName}
          </button>
          <button
            type="button"
            disabled={pending || !pack.canActivate || activeId === pack.manifest.id}
            onclick={() => void onActivate(pack.manifest.id)}>Activate {pack.manifest.displayName}</button
          >
          <button
            type="button"
            disabled={pending || pack.builtIn}
            onclick={() => (activeId === pack.manifest.id ? (removal = pack) : void onRemove(pack.manifest.id, false))}
            >Remove {pack.manifest.displayName}</button
          >
        </div>
        {#each pack.issues as issue (issue.code + issue.mode)}
          <p role={issue.severity === 'error' ? 'alert' : 'status'}>{issue.mode}: {issue.message}</p>
        {/each}
      </li>
    {/each}
  </ul>
</section>

{#if removal}
  <dialog open aria-modal="true" aria-labelledby="remove-active-brand-title">
    <h2 id="remove-active-brand-title">Revert active brand</h2>
    <p>{removal.manifest.displayName} is active. Workflow Studio must atomically revert to LOOP24 before removal.</p>
    <footer>
      <button type="button" disabled={pending} onclick={() => (removal = null)}>Cancel</button>
      <button
        type="button"
        disabled={pending}
        onclick={() => {
          const id = removal?.manifest.id
          removal = null
          if (id) void onRemove(id, true)
        }}>Revert to LOOP24 and remove</button
      >
    </footer>
  </dialog>
{/if}

<style>
  .brand-settings,
  header,
  li {
    display: grid;
    gap: 0.75rem;
  }
  .brand-settings {
    padding: 1rem;
  }
  header p,
  header h2,
  li p {
    margin: 0;
  }
  ul {
    display: grid;
    gap: 0.625rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  li {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
  }
  li img {
    width: 2.5rem;
    height: 2.5rem;
    object-fit: contain;
  }
  .identity {
    display: grid;
  }
  .identity span {
    color: var(--color-text-muted);
  }
  .actions,
  dialog footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    grid-column: 1 / -1;
  }
  li p {
    grid-column: 1 / -1;
  }
  dialog {
    max-width: 32rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
