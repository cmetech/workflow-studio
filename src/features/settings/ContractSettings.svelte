<script lang="ts">
  import type { ContractCacheEntry } from '$src/lib/contract/contract-cache'

  interface Props {
    entries: readonly ContractCacheEntry[]
    onImportFile: () => void | Promise<void>
    onRefreshCli: () => void | Promise<void>
    onActivate: (digest: string) => void | Promise<void>
    onRemove: (digest: string) => void | Promise<void>
  }

  let { entries, onImportFile, onRefreshCli, onActivate, onRemove }: Props = $props()

  function profileLabel(profile: ContractCacheEntry['profile']): string {
    return profile === 'archon-2026-07' ? 'Archon 2026-07' : 'Hermes legacy'
  }
</script>

<section class="contract-settings" aria-label="Workflow contracts">
  <header>
    <h2>Workflow contracts</h2>
    <p>Contracts are local, verified authoring references. Refresh never contacts a network service.</p>
    <div class="actions">
      <button type="button" onclick={() => void onImportFile()}>Import Contract File</button>
      <button type="button" onclick={() => void onRefreshCli()}>Refresh From Hermes CLI</button>
    </div>
  </header>

  <ul aria-label="Available contracts">
    {#each entries as entry (entry.source + entry.digest)}
      <li>
        <div>
          <strong>{profileLabel(entry.profile)}</strong>
          <span>{entry.source === 'bundled' ? 'Bundled' : 'Cached'}</span>
          {#if entry.active}<span>Active</span>{/if}
        </div>
        <dl>
          <div><dt>Schema</dt><dd>{entry.schemaVersion}</dd></div>
          <div><dt>Normalizer</dt><dd>{entry.normalizerVersion}</dd></div>
          <div><dt>Reader</dt><dd>Reader {entry.readerVersion}</dd></div>
          <div><dt>Digest</dt><dd><code>{entry.digest}</code></dd></div>
        </dl>
        <div class="entry-actions">
          <button type="button" aria-label={`Activate ${entry.digest}`} disabled={!entry.canActivate || entry.active} onclick={() => void onActivate(entry.digest)}>Activate</button>
          <button type="button" aria-label={`Remove ${entry.digest}`} disabled={entry.source === 'bundled'} onclick={() => void onRemove(entry.digest)}>Remove</button>
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .contract-settings { display: grid; gap: 1rem; padding: 1rem; }
  header, li, .actions, .entry-actions { display: flex; gap: .5rem; }
  header { flex-direction: column; }
  li { flex-direction: column; padding: .75rem; border: 1px solid var(--color-border); border-radius: .375rem; }
  dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .25rem 1rem; margin: 0; }
  dl div { display: flex; gap: .25rem; min-width: 0; }
  dd { margin: 0; overflow-wrap: anywhere; }
  ul { display: grid; gap: .5rem; padding: 0; margin: 0; list-style: none; }
</style>
