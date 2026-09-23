<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { CreatePackageRequest, PackageWorkflowOption } from '$src/lib/packages/creation'
  import { packagePathError } from '$src/lib/packages/paths'
  import PackageWorkflowPicker from './PackageWorkflowPicker.svelte'
  interface Props {
    sources: readonly PackageWorkflowOption[]
    onCreate: (request: CreatePackageRequest) => void | Promise<void>
    onCancel: () => void
    opener?: HTMLElement | null
  }
  let { sources, onCreate, onCancel, opener = null }: Props = $props()
  let id = $state('')
  let version = $state('1.0.0')
  let displayName = $state('')
  let description = $state('')
  let license = $state('')
  let publisher = $state('')
  let tags = $state('')
  let root = $state('packages/new-package')
  let runtimes = $state('')
  let tools = $state('')
  let providers = $state('')
  let services = $state('')
  let secrets = $state('')
  const items = (value: string) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  let selectedId = $state('')
  let mode = $state<'copy' | 'move'>('copy')
  let busy = $state(false)
  let error = $state('')
  const effectiveId = $derived(selectedId || sources.find((option) => !option.disabledReason)?.id || '')
  const selected = $derived(sources.find((option) => option.id === effectiveId && !option.disabledReason))
  const files = $derived(
    selected
      ? [
          'workflow-package.json',
          selected.source.definition.path,
          ...(selected.source.companion ? [selected.source.companion.path] : []),
          ...selected.source.resources.map((file) => file.path),
        ]
      : [],
  )
  const ready = $derived(
    Boolean(
      selected &&
      id.trim() &&
      version.trim() &&
      displayName.trim() &&
      description.trim() &&
      license.trim() &&
      publisher.trim() &&
      !packagePathError(root),
    ),
  )
  async function create(): Promise<void> {
    if (!ready || !selected || busy) return
    busy = true
    error = ''
    try {
      await onCreate({
        root,
        metadata: {
          id,
          version,
          displayName,
          description,
          license,
          publisher,
          tags: items(tags),
          externalRequirements: {
            runtimes: items(runtimes),
            tools: items(tools),
            providers: items(providers),
            services: items(services),
            secrets: items(secrets),
          },
        },
        workflow: selected.source,
        mode: selected.source.kind === 'workspace' ? mode : 'copy',
      })
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

<ModalShell
  titleId="create-package-title"
  {opener}
  onCancel={() => {
    if (!busy) onCancel()
  }}
  dismissible={!busy}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <h2 id="create-package-title">New Package</h2>
  <form
    onsubmit={(event) => {
      event.preventDefault()
      void create()
    }}
  >
    <fieldset disabled={busy}>
      <label>Package ID<input data-modal-initial-focus bind:value={id} required /></label>
      <label>Version<input bind:value={version} required /></label>
      <label>Display name<input bind:value={displayName} required /></label>
      <label>Description<textarea bind:value={description} required></textarea></label>
      <label>License<input bind:value={license} required /></label>
      <label>Publisher<input bind:value={publisher} required /></label>
      <label>Tags (comma separated)<input bind:value={tags} /></label>
      <details>
        <summary>External requirements</summary>
        <p>Declare names, not credentials. Availability is checked at the destination.</p>
        <label>External runtimes<input bind:value={runtimes} /></label>
        <label>External tools<input bind:value={tools} /></label>
        <label>External providers<input bind:value={providers} /></label>
        <label>External services<input bind:value={services} /></label>
        <label>External secrets<input bind:value={secrets} /></label>
      </details>
      <label>Destination folder<input bind:value={root} required /></label>
      <PackageWorkflowPicker
        {sources}
        selectedId={effectiveId}
        onSelect={(value) => {
          selectedId = value
          mode = 'copy'
        }}
      />
      {#if selected?.source.kind === 'workspace'}
        <label><input type="radio" bind:group={mode} value="copy" />Copy workflow into package</label>
        <label><input type="radio" bind:group={mode} value="move" />Move workflow into package</label>
      {/if}
    </fieldset>
  </form>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if files.length}
    <p>Review the exact destination files. Existing files will not be overwritten.</p>
    <ul aria-label="Package files">
      {#each files as file, index (`${file}:${index}`)}<li><code>{root}/{file}</code></li>{/each}
    </ul>
    {#if selected?.source.kind === 'workspace' && mode === 'move'}<p>
        Only the workflow pair moves. Supporting resources are copied so other workflows retain their files.
      </p>{/if}
  {/if}
  {#snippet actions()}
    <button type="button" data-variant="secondary" disabled={busy} onclick={onCancel}>Cancel</button>
    <button type="button" data-variant="primary" disabled={!ready || busy} onclick={() => void create()}
      >{busy ? 'Creating...' : 'Create Package'}</button
    >
  {/snippet}
</ModalShell>

<style>
  h2 {
    margin-top: 0;
  }
  fieldset {
    display: grid;
    gap: 0.75rem;
    border: 0;
    padding: 0;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  input:not([type='radio']),
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.25rem;
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
    color: var(--color-text);
    background: var(--color-surface);
    padding: 0.35rem;
  }
  input:focus-visible,
  textarea:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  code {
    overflow-wrap: anywhere;
  }
  [role='alert'] {
    color: var(--color-error);
  }
</style>
