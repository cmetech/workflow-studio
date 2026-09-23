<script lang="ts">
  import { onDestroy } from 'svelte'
  import PackageMutationDialog from './PackageMutationDialog.svelte'
  import TransactionRecoveryDetails from './TransactionRecoveryDetails.svelte'
  import { extractTransactionRecovery, type TransactionRecoveryReceipt } from '$src/lib/native/transaction-recovery'
  import type { PackageArtifactAction } from '$src/lib/packages/package-mutations'
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { WorkflowPackageProjection } from '$src/lib/packages/types'
  import CreatePackageDialog from './CreatePackageDialog.svelte'
  import ImportWorkflowPackageDialog from './ImportWorkflowPackageDialog.svelte'
  import {
    createPackageAuthoringController,
    type PackageAuthoringDependencies,
    type PackageAuthoringSession,
  } from './package-authoring-controller'
  interface Props {
    deps: PackageAuthoringDependencies
    onCancel?: () => void
    onHelp?: (topicId: string) => void
  }
  let { deps, onCancel, onHelp }: Props = $props()
  let mode = $state<'create' | 'import' | 'artifact' | 'mutation' | 'receipt' | 'recovery-error' | null>(null)
  let session = $state.raw<PackageAuthoringSession | null>(null)
  let pkg = $state.raw<WorkflowPackageProjection | null>(null)
  let opener = $state.raw<HTMLElement | null>(null)
  let error = $state('')
  let busy = $state(false)
  let filename = $state('assets/new-file.txt')
  let initialText = $state('')
  let mutationMode = $state<'rename' | 'replace' | 'trash' | 'remove-workflow'>('rename')
  let mutationPath = $state('')
  let recovery = $state.raw<TransactionRecoveryReceipt>({ pathResults: [], omittedPathResults: 0 })
  let generation = 0
  const controller = createPackageAuthoringController({
    getContext: () => deps.getContext(),
    get analyzePair() {
      return deps.analyzePair
    },
    get native() {
      return deps.native
    },
    get contract() {
      return deps.contract
    },
    get resourceContract() {
      return deps.resourceContract
    },
    get workflowExamples() {
      return deps.workflowExamples ?? []
    },
    onCompleted: (root, path) => deps.onCompleted(root, path),
    assertCanMutatePackage: async (root) => {
      await deps.assertCanMutatePackage?.(root)
    },
    onRecovery: (receipt) => {
      recovery = receipt
      deps.onRecovery?.(receipt)
    },
  })
  function close() {
    if (busy) return
    generation++
    mode = null
    session = null
    onCancel?.()
  }
  onDestroy(() => {
    generation++
  })
  async function open(next: typeof mode, selected: WorkflowPackageProjection | null, element?: HTMLElement | null) {
    if (busy) return
    const token = ++generation
    mode = next
    pkg = selected
    opener = element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    error = ''
    session = null
    filename = 'assets/new-file.txt'
    initialText = ''
    recovery = { pathResults: [], omittedPathResults: 0 }
    try {
      const loaded = await controller.prepare()
      if (token === generation) session = loaded
    } catch (cause) {
      if (token === generation) error = cause instanceof Error ? cause.message : String(cause)
    }
  }
  export function isBusy(): boolean {
    return busy
  }
  export async function openCreate(element?: HTMLElement | null) {
    await open('create', null, element)
  }
  export async function openImport(selected: WorkflowPackageProjection, element?: HTMLElement | null) {
    await open('import', selected, element)
  }
  export async function openArtifact(selected: WorkflowPackageProjection, element?: HTMLElement | null) {
    await open('artifact', selected, element)
  }
  export async function openMutation(
    selected: WorkflowPackageProjection,
    action: PackageArtifactAction,
    path: string,
    element?: HTMLElement | null,
  ) {
    if (busy || action === 'reveal' || action === 'open-externally') return
    mutationMode = action
    mutationPath = path
    await open('mutation', selected, element)
  }
  function finish() {
    mode = recovery.pathResults.length || recovery.omittedPathResults ? 'receipt' : null
    session = null
  }
  function recordFailure(cause: unknown) {
    error = cause instanceof Error ? cause.message : String(cause)
    const receipt = extractTransactionRecovery(cause)
    if (receipt.pathResults.length || receipt.omittedPathResults) recovery = receipt
    if (recovery.pathResults.length || recovery.omittedPathResults) mode = 'recovery-error'
  }
  async function artifact(importFile: boolean) {
    if (!session || !pkg || busy) return
    busy = true
    error = ''
    try {
      if (importFile) {
        if (!(await controller.importArtifact(session, pkg.root, filename))) return
      } else await controller.addTextArtifact(session, pkg.root, filename, initialText)
      finish()
    } catch (cause) {
      recordFailure(cause)
    } finally {
      busy = false
    }
  }
</script>

{#if mode === 'create' && session}
  <CreatePackageDialog
    sources={session.sources}
    {opener}
    onCancel={close}
    onCreate={async (request) => {
      if (!session) return
      busy = true
      try {
        await controller.create(session, request)
        finish()
      } catch (cause) {
        recordFailure(cause)
        throw cause
      } finally {
        busy = false
      }
    }}
  />
{:else if mode === 'import' && session && pkg}
  <ImportWorkflowPackageDialog
    root={pkg.root}
    packageName={pkg.manifest.displayName}
    sources={session.sources}
    {opener}
    onCancel={close}
    onImport={async (request) => {
      if (!session) return
      busy = true
      try {
        await controller.importWorkflow(session, request)
        finish()
      } catch (cause) {
        recordFailure(cause)
        throw cause
      } finally {
        busy = false
      }
    }}
  />
{:else if mode === 'mutation' && session && pkg}
  <PackageMutationDialog
    root={pkg.root}
    mode={mutationMode}
    path={mutationPath}
    {opener}
    onCancel={close}
    onBusyChanged={(value) => {
      busy = value
    }}
    onPreview={(request) => controller.previewMutation(session!, pkg!.root, request)}
    onChooseReplacement={() => controller.previewReplacement(session!, pkg!.root, mutationPath)}
    onCommit={async (preview) => {
      await controller.commitMutation(session!, preview)
      finish()
    }}
  />
{:else if mode}
  <ModalShell titleId="package-authoring-title" {opener} {busy} dismissible={!busy} onCancel={close}>
    <h2 id="package-authoring-title">
      {mode === 'receipt'
        ? 'Changes saved with retained recovery files'
        : mode === 'recovery-error'
          ? 'Package operation recovery'
          : mode === 'artifact'
            ? 'Add Artifact'
            : 'Package authoring'}
    </h2>
    {#if error}<p role="alert">{error}</p>{/if}
    <TransactionRecoveryDetails
      receipt={recovery}
      title={mode === 'receipt' ? 'Retained recovery files' : 'Transaction recovery locations'}
    />
    {#if !session && !error && mode !== 'receipt'}<p role="status">Reading verified workspace sources...</p>{/if}
    {#if mode === 'artifact' && session}
      <p>
        Create or import a file with this exact name inside {pkg?.manifest.displayName}. Existing files cannot be
        overwritten.
      </p>
      <label>Package-relative filename<input bind:value={filename} disabled={busy} /></label>
      <label>Initial text<textarea bind:value={initialText} disabled={busy}></textarea></label>
      <button disabled={busy || !filename} onclick={() => artifact(false)}>Create text artifact</button>
      <button disabled={busy || !filename} onclick={() => artifact(true)}>Choose file to import</button>
    {/if}
    {#snippet actions()}
      {#if onHelp}<button
          disabled={busy}
          onclick={() => {
            close()
            onHelp?.('guide:creating-a-package')
          }}>Help</button
        >{/if}
      <button disabled={busy} onclick={close}>Close</button>
    {/snippet}
  </ModalShell>
{/if}

<style>
  label {
    display: grid;
    gap: 0.35rem;
    margin-block: 1rem;
  }
  input,
  textarea {
    width: 100%;
    padding: 0.5rem;
  }
  textarea {
    min-height: 8rem;
    font-family: monospace;
  }
  button {
    margin-inline-end: 0.5rem;
  }
</style>
