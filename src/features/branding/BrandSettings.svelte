<script lang="ts">
  import { tick } from 'svelte'
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
  let removalOpener: HTMLElement | null = null

  function openRemovalModal(node: HTMLDialogElement): { destroy: () => void } {
    if (typeof node.showModal === 'function') {
      node.showModal()
    } else {
      node.setAttribute('open', '')
    }
    void tick().then(() => node.querySelector<HTMLButtonElement>('[data-removal-cancel]')?.focus())

    return {
      destroy: () => {
        if (node.open && typeof node.close === 'function') node.close()
      },
    }
  }

  function beginRemoval(pack: RuntimeBrandPack, opener: HTMLElement): void {
    removalOpener = opener
    removal = pack
  }

  async function closeRemoval(): Promise<void> {
    if (pending) return
    const opener = removalOpener
    removal = null
    await tick()
    if (opener?.isConnected) opener.focus()
    removalOpener = null
  }

  function handleRemovalKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      void closeRemoval()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = event.currentTarget as HTMLDialogElement
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'))
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleRemovalCancel(event: Event): void {
    event.preventDefault()
    void closeRemoval()
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
    <button type="button" data-variant="primary" disabled={pending} onclick={() => void onImport()}>Import brand pack</button>
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
  <dialog
    use:openRemovalModal
    aria-modal="true"
    aria-labelledby="remove-active-brand-title"
    aria-busy={pending}
    onkeydown={handleRemovalKeydown}
    oncancel={handleRemovalCancel}
  >
    <h2 id="remove-active-brand-title">Revert active brand</h2>
    <p>{removal.manifest.displayName} is active. Workflow Studio must atomically revert to LOOP24 before removal.</p>
    <footer>
      <button data-removal-cancel type="button" data-variant="secondary" disabled={pending} onclick={() => void closeRemoval()}>Cancel</button>
      <button type="button" data-variant="danger" disabled={pending} onclick={confirmRemoval}>Revert to LOOP24 and remove</button>
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
  .inspection-report {
    grid-template-columns: minmax(0, 1fr);
  }
  dialog {
    max-width: 32rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
  }
  button:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
