<script lang="ts">
  import ExpandableLog from '$src/features/setup/ExpandableLog.svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { formatBytes } from '$src/lib/updates/format'
  import type { UpdateState } from '$src/lib/updates/types'
  import type { HostInfo } from '$src/lib/native/types'

  interface ContractIdentity {
    readonly profile: string
    readonly schemaVersion: number
    readonly digest: string
  }
  interface Props {
    host: HostInfo
    contracts: readonly ContractIdentity[]
    startupCheckEnabled: boolean
    updateState: UpdateState | null
    oncheck: () => void | Promise<void>
    onstartupchange: (enabled: boolean) => void | Promise<void>
    ondownload?: (runId: string) => void | Promise<void>
    onopenlog?: (runId: string) => void | Promise<void>
    onrelaunch?: () => void | Promise<void>
  }
  let {
    host,
    contracts,
    startupCheckEnabled,
    updateState,
    oncheck,
    onstartupchange,
    ondownload = () => undefined,
    onopenlog = () => undefined,
    onrelaunch = () => undefined,
  }: Props = $props()
  let checking = $state(false)
  let preferencePending = $state(false)
  let details = $state(false)
  let actionIdentity = $state('')
  let actionGeneration = 0
  const pending = new SvelteSet<string>()

  $effect(() => {
    const next = `${updateState?.runId ?? 'none'}\0${updateState?.phase ?? 'none'}`
    if (next === actionIdentity) return
    actionIdentity = next
    actionGeneration += 1
    pending.clear()
  })

  async function act(key: string, action: () => void | Promise<void>): Promise<void> {
    if (pending.has(key)) return
    pending.add(key)
    const generation = actionGeneration
    try {
      await action()
    } finally {
      if (generation === actionGeneration) {
        pending.delete(key)
      }
    }
  }

  async function check(): Promise<void> {
    if (checking) return
    checking = true
    try {
      await oncheck()
    } finally {
      checking = false
    }
  }
  async function setPreference(enabled: boolean): Promise<void> {
    if (preferencePending) return
    preferencePending = true
    try {
      await onstartupchange(enabled)
    } finally {
      preferencePending = false
    }
  }
</script>

<section class="about" aria-label="About Workflow Studio">
  <header>
    <h2>About</h2>
    <p>Application, authoring contract, and signed update status.</p>
  </header>
  <dl class="identity">
    <div>
      <dt>Version</dt>
      <dd>{host.appVersion}</dd>
    </div>
    <div>
      <dt>Platform</dt>
      <dd>{host.os} / {host.arch}</dd>
    </div>
  </dl>
  <ul aria-label="Authoring contracts">
    {#each contracts as contract (contract.profile + contract.digest)}
      <li>
        <strong>{contract.profile}</strong><span>Schema {contract.schemaVersion}</span><code class="digest"
          >{contract.digest}</code
        >
      </li>
    {/each}
  </ul>
  <label class="preference"
    ><input
      type="checkbox"
      checked={startupCheckEnabled}
      disabled={preferencePending}
      onchange={(event) => void setPreference(event.currentTarget.checked)}
    /> Check for updates at startup</label
  >
  <button
    type="button"
    disabled={checking || updateState?.phase === 'checking'}
    aria-busy={checking}
    onclick={() => void check()}>{checking ? 'Checking…' : 'Check for Updates'}</button
  >

  {#if updateState}
    <section class="update-detail" aria-label="Update details">
      <p role="status">Update status: {updateState.phase}</p>
      {#if updateState.release}
        <p><strong>Version {updateState.release.version}</strong> · {updateState.release.platform}</p>
        {#if updateState.release.notes}<p class="notes">{updateState.release.notes.replace(/\s+/g, ' ').trim()}</p>{/if}
      {/if}
      {#if updateState.phase === 'downloading'}<p>
          {formatBytes(updateState.downloadedBytes)}{updateState.totalBytes === null
            ? ''
            : ` / ${formatBytes(updateState.totalBytes)}`}
        </p>{/if}
      {#if updateState.failure}<p role="alert">{updateState.failure.message}</p>{/if}
      <button type="button" aria-expanded={details} onclick={() => (details = !details)}
        >{details ? 'Hide update log' : 'Show update log'}</button
      >
      <ExpandableLog
        expanded={details || updateState.logExpanded}
        lines={updateState.logs}
        label="Update output"
        dataAttribute="update"
      />
      <div class="actions">
        {#if updateState.savedLogAvailable}<button
            type="button"
            disabled={pending.has('open')}
            onclick={() => void act('open', () => onopenlog(updateState.runId))}>Open Saved Log</button
          >{/if}
        {#if updateState.phase === 'available' || updateState.phase === 'deferred'}<button
            type="button"
            disabled={pending.has('download')}
            onclick={() => void act('download', () => ondownload(updateState.runId))}>Download / Install</button
          >{/if}
        {#if updateState.phase === 'restart-required'}<button
            type="button"
            disabled={pending.has('relaunch')}
            onclick={() => void act('relaunch', onrelaunch)}>Relaunch</button
          >{/if}
      </div>
    </section>
  {/if}
</section>

<style>
  .about {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border-top: 1px solid var(--color-border);
  }
  header h2,
  header p,
  .update-detail p {
    margin: 0;
  }
  .identity {
    display: grid;
    gap: 0.35rem;
    margin: 0;
  }
  .identity div {
    display: grid;
    grid-template-columns: 5rem minmax(0, 1fr);
    gap: 0.5rem;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  ul {
    display: grid;
    gap: 0.5rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }
  .digest,
  .notes {
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .preference {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .update-detail {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    min-height: 2.25rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.375rem;
    color: var(--color-text);
    background: transparent;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
