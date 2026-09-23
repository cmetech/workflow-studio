<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import {
    packageWorkflowName,
    type ImportWorkflowPackageRequest,
    type PackageWorkflowOption,
  } from '$src/lib/packages/creation'
  import PackageWorkflowPicker from './PackageWorkflowPicker.svelte'
  interface Props {
    root: string
    packageName: string
    sources: readonly PackageWorkflowOption[]
    onImport: (request: ImportWorkflowPackageRequest) => void | Promise<void>
    onCancel: () => void
    opener?: HTMLElement | null
  }
  let { root, packageName, sources, onImport, onCancel, opener = null }: Props = $props()
  let selectedId = $state('')
  let mode = $state<'copy' | 'move'>('copy')
  let busy = $state(false)
  let error = $state('')
  let definitionOverride = $state<string | null>(null)
  let companionOverride = $state<string | null>(null)
  let nameOverride = $state<string | null>(null)
  const effectiveId = $derived(selectedId || sources.find((option) => !option.disabledReason)?.id || '')
  const selected = $derived(sources.find((option) => option.id === effectiveId && !option.disabledReason))
  const pair = $derived(
    selected ? [selected.source.definition, ...(selected.source.companion ? [selected.source.companion] : [])] : [],
  )
  const actualMode = $derived(selected?.source.kind === 'workspace' ? mode : 'copy')
  const definitionDestination = $derived(definitionOverride ?? selected?.source.definition.path ?? '')
  const companionDestination = $derived(companionOverride ?? selected?.source.companion?.path ?? '')
  const sourceName = $derived(selected ? packageWorkflowName(selected.source) : '')
  const workflowName = $derived(actualMode === 'move' ? sourceName : (nameOverride ?? sourceName))
  const destinationPath = (path: string) => (root ? `${root}/${path}` : path)
  async function confirm(): Promise<void> {
    if (!selected || busy) return
    busy = true
    error = ''
    try {
      await onImport({
        root,
        workflow: selected.source,
        mode: actualMode,
        destination: {
          definition: definitionDestination,
          ...(selected.source.companion ? { companion: companionDestination } : {}),
          ...(actualMode === 'copy' ? { name: workflowName } : {}),
        },
      })
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

<ModalShell
  titleId="import-package-workflow-title"
  {opener}
  onCancel={() => {
    if (!busy) onCancel()
  }}
  dismissible={!busy}
  initialFocusSelector="select"
>
  <h2 id="import-package-workflow-title">Add workflow to {packageName}</h2>
  <PackageWorkflowPicker
    {sources}
    selectedId={effectiveId}
    onSelect={(value) => {
      selectedId = value
      mode = 'copy'
      definitionOverride = null
      companionOverride = null
      nameOverride = null
    }}
    disabled={busy}
    label="Workflow"
  />
  {#if selected?.source.kind === 'workspace'}
    <fieldset disabled={busy}>
      <legend>Choose how to adopt the workflow</legend>
      <label><input type="radio" bind:group={mode} value="copy" />Copy workflow into package</label>
      <label><input type="radio" bind:group={mode} value="move" />Move workflow into package</label>
    </fieldset>
  {/if}
  {#if selected}
    <fieldset disabled={busy}>
      <legend>Destination within this package</legend>
      <label
        >Definition destination<input
          value={definitionDestination}
          oninput={(event) => (definitionOverride = event.currentTarget.value)}
        /></label
      >
      {#if selected.source.companion}
        <label
          >Companion destination<input
            value={companionDestination}
            oninput={(event) => (companionOverride = event.currentTarget.value)}
          /></label
        >
      {/if}
      <label
        >Workflow name<input
          value={workflowName}
          disabled={actualMode === 'move'}
          oninput={(event) => (nameOverride = event.currentTarget.value)}
        /></label
      >
      {#if actualMode === 'move'}<p>Moving preserves the source workflow name. Choose Copy to change it.</p>{/if}
    </fieldset>
    <p>The package manifest and these exact files change together:</p>
    <ul aria-label="Workflow file changes">
      <li><code>{destinationPath('workflow-package.json')} (update membership)</code></li>
      {#each pair as file, index (`${file.path}:${index}`)}<li>
          <code
            >{file.sourcePath ?? selected.label} to {destinationPath(
              index === 0 ? definitionDestination : companionDestination,
            )}</code
          >
        </li>{/each}
      {#each selected.source.resources as file, index (`${file.path}:${index}`)}<li>
          <code>{file.sourcePath ?? selected.label} to {destinationPath(file.path)} (copy)</code>
        </li>{/each}
    </ul>
    <p>Supporting resources are copied. Shared source resources remain in place.</p>
    {#if actualMode === 'copy' && workflowName !== sourceName}<p>
        Set copied workflow name to <strong>{workflowName}</strong>.
      </p>{/if}
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#snippet actions()}
    <button type="button" data-variant="secondary" disabled={busy} onclick={onCancel}>Cancel</button>
    <button type="button" data-variant="primary" disabled={!selected || busy} onclick={() => void confirm()}
      >{busy ? 'Adding...' : actualMode === 'move' ? 'Move Workflow' : 'Copy Workflow'}</button
    >
  {/snippet}
</ModalShell>

<style>
  h2 {
    margin-top: 0;
  }
  fieldset {
    margin-top: 1rem;
    display: grid;
    gap: 0.5rem;
    border: 1px solid var(--color-border);
  }
  code {
    overflow-wrap: anywhere;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  [role='alert'] {
    color: var(--color-error);
  }
</style>
