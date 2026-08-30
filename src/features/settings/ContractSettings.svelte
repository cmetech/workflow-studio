<script lang="ts">
  import type { ContractCacheEntry } from '$src/lib/contract/contract-cache'

  interface Props {
    entries: readonly ContractCacheEntry[]
    onImportFile: () => void | Promise<void>
    onRefreshCli: (profile: ContractCacheEntry['profile']) => void | Promise<void>
    onActivate: (digest: string) => void | Promise<void>
    onRemove: (digest: string) => void | Promise<void>
  }

  let { entries, onImportFile, onRefreshCli, onActivate, onRemove }: Props = $props()
  let refreshProfile = $state<ContractCacheEntry['profile']>('archon-2026-07')

  function profileLabel(profile: ContractCacheEntry['profile']): string {
    return profile === 'archon-2026-07' ? 'Archon 2026-07' : 'Hermes legacy'
  }
  function sourceLabel(entry: ContractCacheEntry): string {
    const prefix =
      entry.provenance.kind === 'user' ? 'Selected file' : entry.provenance.kind === 'cli' ? 'Hermes CLI' : 'Bundled'
    return `${prefix}: ${entry.provenance.identifier}`
  }
</script>

<section class="contract-settings" aria-label="Workflow contracts">
  <header>
    <h2>Workflow contracts</h2>
    <p>Contracts are local, verified authoring references. Refresh never contacts a network service.</p>
    <div class="actions">
      <button type="button" onclick={() => void onImportFile()}>Import Contract File</button>
      <label
        >CLI profile
        <select aria-label="CLI profile" bind:value={refreshProfile}>
          <option value="archon-2026-07">Archon 2026-07</option>
          <option value="hermes-legacy">Hermes legacy</option>
        </select>
      </label>
      <button type="button" onclick={() => void onRefreshCli(refreshProfile)}>Refresh From Hermes CLI</button>
    </div>
  </header>

  <ul aria-label="Available contracts">
    {#each entries as entry (entry.status + entry.digest)}
      <li>
        <div>
          <strong>{profileLabel(entry.profile)}</strong>
          <span>{entry.status === 'bundled' ? 'Bundled' : 'Cached'}</span>
          {#if entry.active}<span>Active</span>{/if}
        </div>
        <dl>
          <div>
            <dt>Schema</dt>
            <dd>{entry.schemaVersion}</dd>
          </div>
          <div>
            <dt>Normalizer</dt>
            <dd>{entry.normalizerVersion}</dd>
          </div>
          <div>
            <dt>Reader</dt>
            <dd>Reader {entry.readerVersion}</dd>
          </div>
          <div>
            <dt>Digest</dt>
            <dd><code>{entry.digest}</code></dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{sourceLabel(entry)}</dd>
          </div>
        </dl>
        <div class="entry-actions">
          <button
            type="button"
            aria-label={`Activate ${entry.digest}`}
            disabled={!entry.canActivate || entry.active}
            onclick={() => void onActivate(entry.digest)}>Activate</button
          >
          <button
            type="button"
            aria-label={`Remove ${entry.digest}`}
            disabled={entry.status === 'bundled'}
            onclick={() => void onRemove(entry.digest)}>Remove</button
          >
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .contract-settings {
    display: grid;
    gap: 1rem;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
  }
  header,
  li,
  .actions,
  .entry-actions {
    display: flex;
    gap: 0.5rem;
  }
  header {
    flex-direction: column;
    min-width: 0;
    max-width: 100%;
  }
  li {
    flex-direction: column;
    min-width: 0;
    max-width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem 1rem;
    margin: 0;
  }
  dl div {
    display: flex;
    gap: 0.25rem;
    min-width: 0;
  }
  dd {
    min-width: 0;
    max-width: 100%;
    margin: 0;
    overflow-wrap: anywhere;
  }
  code {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  ul {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .actions,
  .entry-actions {
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }
  .actions label,
  .actions button,
  .entry-actions button {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  @media (max-width: 36rem) {
    dl {
      grid-template-columns: minmax(0, 1fr);
    }

    .actions,
    .entry-actions {
      flex-direction: column;
    }

    .actions button,
    .entry-actions button,
    .actions label,
    .actions select {
      width: 100%;
    }
  }
</style>
