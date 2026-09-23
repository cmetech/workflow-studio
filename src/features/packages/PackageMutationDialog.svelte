<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import TransactionRecoveryDetails from './TransactionRecoveryDetails.svelte'
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { PackageMutationRequest, PackageMutationPreview } from '$src/lib/packages/package-mutations'
  import type { PackageChangePreview, PackageReplacementPreview } from './package-authoring-controller'
  import { extractTransactionRecovery, type TransactionRecoveryReceipt } from '$src/lib/native/transaction-recovery'
  let {
    root,
    mode,
    path,
    opener = null,
    onPreview,
    onChooseReplacement,
    onCommit,
    onCancel,
    onBusyChanged,
  }: {
    root: string
    mode: 'rename' | 'trash' | 'replace' | 'remove-workflow'
    path: string
    opener?: HTMLElement | null
    onPreview: (request: PackageMutationRequest) => Promise<PackageMutationPreview>
    onChooseReplacement?: () => Promise<PackageReplacementPreview | null>
    onCommit: (preview: PackageChangePreview) => Promise<void>
    onCancel: () => void
    onBusyChanged?: (busy: boolean) => void
  } = $props()
  let destination = $state(untrack(() => path))
  let preview = $state.raw<PackageChangePreview | null>(null)
  let previewDestination = $state('')
  let busy = $state(false)
  let error = $state('')
  let recovery = $state.raw<TransactionRecoveryReceipt>({ pathResults: [], omittedPathResults: 0 })
  let manual = $state.raw<readonly string[]>([])
  let disposed = false
  const title = $derived(
    mode === 'remove-workflow'
      ? 'Remove workflow'
      : mode === 'rename'
        ? 'Rename artifact'
        : mode === 'replace'
          ? 'Replace artifact'
          : 'Trash artifact',
  )
  const currentPreview = $derived(mode !== 'rename' || destination === previewDestination ? preview : null)
  onDestroy(() => {
    disposed = true
    onBusyChanged?.(false)
  })
  async function run(operation: () => Promise<void>) {
    if (busy) return
    busy = true
    onBusyChanged?.(true)
    error = ''
    recovery = { pathResults: [], omittedPathResults: 0 }
    manual = []
    try {
      await operation()
    } catch (cause) {
      if (disposed) return
      error = cause instanceof Error ? cause.message : String(cause)
      recovery = extractTransactionRecovery(cause)
      if (cause && typeof cause === 'object') {
        const values = (
          'manualReferences' in cause && Array.isArray(cause.manualReferences) ? cause.manualReferences : []
        ).map((entry: { path?: unknown; line?: unknown }) =>
          typeof entry.path === 'string'
            ? `${entry.path}${typeof entry.line === 'number' ? ':' + entry.line : ''}`
            : '',
        )
        const consumers = ('references' in cause && Array.isArray(cause.references) ? cause.references : []).map(
          (entry: { workflowPath?: unknown; nodeId?: unknown }) =>
            typeof entry.workflowPath === 'string' ? `${entry.workflowPath} / ${String(entry.nodeId ?? '')}` : '',
        )
        manual = [...values, ...consumers].filter(Boolean).slice(0, 128)
      }
      preview = null
    } finally {
      busy = false
      onBusyChanged?.(false)
    }
  }
  async function prepare(trashPair = false) {
    const requestedDestination = destination
    preview = null
    await run(async () => {
      const request: PackageMutationRequest =
        mode === 'remove-workflow'
          ? { kind: 'remove-workflow', definition: path, trashPair }
          : mode === 'rename'
            ? { kind: 'rename-artifact', path, destination: requestedDestination }
            : { kind: 'trash-artifact', path }
      const prepared = await onPreview(request)
      if (!disposed) {
        preview = prepared
        previewDestination = requestedDestination
      }
    })
  }
</script>

<ModalShell titleId="package-mutation-title" {opener} {busy} dismissible={!busy} {onCancel}>
  <h2 id="package-mutation-title">{title}</h2>
  <p>Selected path: {root ? root + '/' : ''}{path}</p>
  {#if mode === 'remove-workflow'}
    <p>Shared commands, scripts, and supporting resources remain in the package.</p>
    <button disabled={busy} onclick={() => prepare(false)}>Remove membership only</button>
    <button disabled={busy} onclick={() => prepare(true)}>Trash declared pair</button>
  {:else if mode === 'rename'}
    <label>New package-relative path<input bind:value={destination} disabled={busy} /></label>
    <button disabled={busy || !destination || destination === path} onclick={() => prepare()}>Preview changes</button>
  {:else if mode === 'replace'}
    <p>
      The chosen source bytes are not read into this preview. Confirm the exact destination and its current hash before
      replacement.
    </p>
    <button
      disabled={busy || !onChooseReplacement}
      onclick={() =>
        run(async () => {
          const selected = await onChooseReplacement?.()
          if (!disposed) preview = selected ?? null
        })}>Choose replacement file</button
    >
  {:else}
    <p>Only this artifact will move to Trash. Referenced artifacts must be detached from their consumers first.</p>
    <button disabled={busy} onclick={() => prepare()}>Preview changes</button>
  {/if}
  {#if busy}<p role="status">Checking package changes...</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if manual.length}<h3>References requiring manual edits</h3>
    <ul>
      {#each manual as item, index (index)}<li>{item}</li>{/each}
    </ul>{/if}
  <TransactionRecoveryDetails receipt={recovery} />
  {#if currentPreview}
    <section aria-label="Exact package changes">
      <h3>Review exact changes</h3>
      {#each currentPreview.changes as change, index (index)}
        <article>
          <h4>{change.operation}</h4>
          <p>{change.path}</p>
          {#if change.destination}<p>Destination: {change.destination}</p>{/if}
          <p>Current SHA-256</p>
          <code>{change.expectedHash ?? 'Must not exist'}</code>
          {#if change.before !== undefined}<details>
              <summary>Before</summary>
              <pre>{change.before}</pre>
            </details>{/if}
          {#if change.after !== undefined}<details open>
              <summary>After</summary>
              <pre>{change.after}</pre>
            </details>{/if}
        </article>
      {/each}
      {#each currentPreview.referenceChanges as change, index (index)}<p>
          {change.workflowPath} / {change.nodeId}: {change.from} to {change.to}
        </p>{/each}
    </section>
  {/if}
  {#snippet actions()}
    <button disabled={busy} onclick={onCancel}>Cancel</button>
    {#if currentPreview}<button
        disabled={busy}
        onclick={() => {
          const selected = currentPreview
          if (selected) void run(() => onCommit(selected))
        }}>Confirm changes</button
      >{/if}
  {/snippet}
</ModalShell>

<style>
  label {
    display: grid;
    gap: var(--space-2);
  }
  input {
    width: 100%;
  }
  article {
    border: 1px solid var(--color-border);
    padding: var(--space-3);
    margin-block: var(--space-3);
  }
  p,
  code {
    overflow-wrap: anywhere;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  button {
    margin: var(--space-2);
  }
</style>
