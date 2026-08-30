<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import { applyBrandTheme } from '$src/lib/branding/load-brand'
  import type { RuntimeBrandPack, ThemeMode } from '$src/lib/branding/types'

  interface Props {
    pack: RuntimeBrandPack
    mode: ThemeMode
    pending?: boolean
    opener?: HTMLElement | undefined
    onClose: () => void
    onActivate: () => void | Promise<void>
  }

  let { pack, mode, pending = false, opener, onClose, onActivate }: Props = $props()
  let previewRoot: HTMLElement

  $effect(() => {
    if (previewRoot) applyBrandTheme(pack.manifest, mode, previewRoot)
  })
</script>

<ModalShell
  titleId="brand-preview-title"
  busy={pending}
  dismissible={!pending}
  initialFocusSelector="[data-preview-close]"
  opener={opener ?? null}
  onCancel={onClose}
>
  <section bind:this={previewRoot} data-testid="brand-preview-root" class="preview-root">
    <header>
      <img src={pack.assetUrls.logo} alt="" />
      <div>
        <p>Runtime brand preview</p>
        <h2 id="brand-preview-title">Preview {pack.manifest.displayName}</h2>
      </div>
    </header>
    <div class="sample-card">
      <strong>Workflow authoring</strong>
      <p>This preview is isolated. It does not change the active application theme.</p>
      <button type="button">Sample focused control</button>
    </div>
    {#each pack.issues as issue (issue.code + issue.mode)}
      <p role={issue.severity === 'error' ? 'alert' : 'status'}>{issue.mode}: {issue.message}</p>
    {/each}
  </section>
  {#snippet actions()}
    <div class="preview-actions">
      <button data-preview-close type="button" disabled={pending} onclick={onClose}>Close preview</button>
      <button type="button" disabled={pending || !pack.canActivate} onclick={() => void onActivate()}>
        Activate {pack.manifest.displayName}
      </button>
    </div>
  {/snippet}
</ModalShell>

<style>
  .preview-root {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    color: var(--color-text);
    background: var(--color-background);
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  header,
  .preview-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  header img {
    width: 8rem;
    max-height: 3rem;
    object-fit: contain;
  }
  header p,
  header h2 {
    margin: 0;
  }
  .sample-card {
    display: grid;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface);
  }
  .preview-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .preview-root {
      transition: none;
    }
  }
</style>
