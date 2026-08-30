<script lang="ts">
  import { tick } from 'svelte'
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { RuntimeBrandPack, RuntimeBrandReport } from '$src/lib/branding/types'

  interface Props {
    packs: readonly RuntimeBrandPack[]
    reports?: readonly RuntimeBrandReport[]
    activeId: string
    pending: boolean
    warning: string | null
    onImport: () => void | Promise<void>
    onPreview: (id: string) => void
    onActivate: (id: string) => void | Promise<void>
    onRemove: (id: string, revertActive: boolean) => void | Promise<void>
  }

  let { packs, reports = [], activeId, pending, warning, onImport, onPreview, onActivate, onRemove }: Props = $props()
  let removal: RuntimeBrandPack | null = $state(null)
  let removalOpener: HTMLElement | null = $state(null)

  function beginRemoval(pack: RuntimeBrandPack, opener: HTMLElement): void {
    removalOpener = opener
    removal = pack
  }

  async function closeRemoval(): Promise<void> {
    if (pending) return
    removal = null
    await tick()
    removalOpener = null
  }

  function confirmRemoval(): void {
    if (pending) return
    const id = removal?.manifest.id
    void closeRemoval()
    if (id) void onRemove(id, true)
  }
</script>

<section class="brand-settings" aria-labelledby="brand-settings-title" aria-busy={pending}>
  <header>
    <h2 id="brand-settings-title">Brand and theme packs</h2>
    <p>Runtime packs change in-app identity and semantic colors only. Installed application icons remain LOOP24.</p>
    <button type="button" data-variant="primary" disabled={pending} onclick={() => void onImport()}
      >Import brand pack</button
    >
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
          <button type="button" data-variant="ghost" disabled={pending} onclick={() => onPreview(pack.manifest.id)}>
            Preview {pack.manifest.displayName}
          </button>
          <button
            type="button"
            data-variant="secondary"
            disabled={pending || !pack.canActivate || activeId === pack.manifest.id}
            onclick={() => void onActivate(pack.manifest.id)}>Activate {pack.manifest.displayName}</button
          >
          <button
            type="button"
            data-variant="danger"
            disabled={pending || pack.builtIn}
            onclick={(event) =>
              activeId === pack.manifest.id
                ? beginRemoval(pack, event.currentTarget)
                : void onRemove(pack.manifest.id, false)}>Remove {pack.manifest.displayName}</button
          >
        </div>
        {#each pack.issues as issue (issue.code + issue.mode)}
          <p role={issue.severity === 'error' ? 'alert' : 'status'}>{issue.mode}: {issue.message}</p>
        {/each}
      </li>
    {/each}
  </ul>
  {#if reports.length > 0}
    <ul aria-label="Rejected brand pack reports">
      {#each reports as report (report.reportId)}
        <li class="inspection-report">
          <strong>{report.displayName}</strong>
          <p role="alert">{report.message}</p>
          <span>Preview and activation are unavailable because this pack is not safe to render.</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if removal}
  <ModalShell
    titleId="remove-active-brand-title"
    busy={pending}
    dismissible={!pending}
    initialFocusSelector="[data-removal-cancel]"
    opener={removalOpener}
    onCancel={closeRemoval}
  >
    <h2 id="remove-active-brand-title">Revert active brand</h2>
    <p>{removal.manifest.displayName} is active. Workflow Studio must atomically revert to LOOP24 before removal.</p>
    {#snippet actions()}
      <div class="removal-actions">
        <button
          data-removal-cancel
          type="button"
          data-variant="secondary"
          disabled={pending}
          onclick={() => void closeRemoval()}>Cancel</button
        >
        <button type="button" data-variant="danger" disabled={pending} onclick={confirmRemoval}
          >Revert to LOOP24 and remove</button
        >
      </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  .brand-settings,
  header,
  li {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    max-width: 100%;
  }
  .brand-settings {
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
  }
  header p,
  header h2,
  li p {
    margin: 0;
  }
  ul {
    display: grid;
    gap: 0.625rem;
    min-width: 0;
    max-width: 100%;
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
    min-width: 0;
  }
  .identity strong,
  .identity span,
  li p,
  .inspection-report span {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .identity span {
    color: var(--color-text-muted);
  }
  .actions,
  .removal-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    grid-column: 1 / -1;
    min-width: 0;
  }
  .actions button,
  header button {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  li p {
    grid-column: 1 / -1;
  }
  .inspection-report {
    grid-template-columns: minmax(0, 1fr);
  }
  button:focus-visible {
    box-shadow: var(--focus-ring);
  }

  @media (max-width: 36rem) {
    .actions {
      flex-direction: column;
    }

    .actions button,
    header button {
      width: 100%;
    }
  }
</style>
