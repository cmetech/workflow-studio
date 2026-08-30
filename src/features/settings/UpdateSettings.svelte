<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import ExpandableLog from '$src/features/setup/ExpandableLog.svelte'
  import { formatBytes } from '$src/lib/updates/format'
  import type { UpdateState } from '$src/lib/updates/types'

  interface Props {
    startupCheckEnabled: boolean
    updateState: UpdateState | null
    oncheck: () => void | Promise<void>
    onstartupchange: (enabled: boolean) => void | Promise<void>
    ondownload?: (runId: string) => void | Promise<void>
    onopenlog?: (runId: string) => void | Promise<void>
    onrelaunch?: () => void | Promise<void>
  }

  let {
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
      if (generation === actionGeneration) pending.delete(key)
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

<section class="update-settings" aria-labelledby="update-settings-title">
  <header>
    <h2 id="update-settings-title">Updates</h2>
    <p>Manage signed application updates and startup checks.</p>
  </header>

  <div class="preference-card">
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
  </div>

  {#if updateState}
    <section class="update-detail" aria-label="Update details">
      <p role="status">Update status: {updateState.phase}</p>
      {#if updateState.release}
        <p><strong>Version <code class="technical-value">{updateState.release.version}</code></strong></p>
        <p><code class="technical-value">{updateState.release.platform}</code></p>
        {#if updateState.release.notes}<p class="notes">{updateState.release.notes.replace(/\s+/g, ' ').trim()}</p>{/if}
      {/if}
      {#if updateState.phase === 'downloading'}
        <p>
          {formatBytes(updateState.downloadedBytes)}{updateState.totalBytes === null
            ? ''
            : ` / ${formatBytes(updateState.totalBytes)}`}
        </p>
      {/if}
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
        {#if updateState.savedLogAvailable}
          <button
            type="button"
            disabled={pending.has('open')}
            onclick={() => void act('open', () => onopenlog(updateState.runId))}>Open Saved Log</button
          >
        {/if}
        {#if updateState.phase === 'available' || updateState.phase === 'deferred'}
          <button
            type="button"
            disabled={pending.has('download')}
            onclick={() => void act('download', () => ondownload(updateState.runId))}>Download / Install</button
          >
        {/if}
        {#if updateState.phase === 'restart-required'}
          <button type="button" disabled={pending.has('relaunch')} onclick={() => void act('relaunch', onrelaunch)}
            >Relaunch</button
          >
        {/if}
      </div>
    </section>
  {/if}
</section>

<style>
  .update-settings,
  header,
  .preference-card,
  .update-detail {
    display: grid;
    gap: 0.75rem;
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .update-settings {
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
  }

  h2,
  p {
    max-width: 100%;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .preference-card,
  .update-detail {
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
  }

  .preference {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
    align-items: center;
    overflow-wrap: anywhere;
  }

  .technical-value,
  .notes {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    min-width: 0;
  }

  button {
    min-width: 0;
    min-height: 2.25rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.375rem;
    color: var(--color-text);
    background: transparent;
    overflow-wrap: anywhere;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (max-width: 36rem) {
    .actions {
      flex-direction: column;
    }

    .actions button,
    .preference-card > button {
      width: 100%;
    }
  }
</style>
