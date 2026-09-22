<script module lang="ts">
  export type ResourceDialogMode = 'select' | 'create' | 'extract'
  export interface ResourceDialogRequest {
    basename?: string
    suffix?: string
    initialText?: string
    artifactPath?: string
  }
  export interface ResourceDialogPreview {
    artifactPath: string
    reference: string
  }
</script>

<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  interface Props {
    mode: ResourceDialogMode
    choices: readonly string[]
    opener?: HTMLElement | null
    onPreview: (request: ResourceDialogRequest) => Promise<ResourceDialogPreview>
    onCommit: () => Promise<void> | void
    onCancel: () => void
  }
  let { mode, choices, opener = null, onPreview, onCommit, onCancel }: Props = $props()
  let basename = $state('')
  let suffix = $state('')
  let initialText = $state('')
  let artifactPath = $state('')
  let preview = $state<ResourceDialogPreview | null>(null)
  let busy = $state(false)
  let error = $state('')
  let previewKey = $state('')
  const requestKey = $derived(JSON.stringify({ basename, suffix, initialText, artifactPath }))
  const ready = $derived(mode === 'select' ? Boolean(artifactPath) : Boolean(basename))
  const authorized = $derived(preview !== null && previewKey === requestKey)
  async function prepare() {
    if (busy || !ready) return
    busy = true
    error = ''
    preview = null
    const key = requestKey
    try {
      preview = await onPreview(
        mode === 'select'
          ? { artifactPath }
          : { basename, ...(suffix ? { suffix } : {}), ...(mode === 'create' ? { initialText } : {}) },
      )
      previewKey = key
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
  async function commit() {
    if (busy || !authorized) return
    busy = true
    error = ''
    try {
      await onCommit()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      preview = null
    } finally {
      busy = false
    }
  }
  const verb = $derived(mode === 'select' ? 'Select' : mode === 'extract' ? 'Extract' : 'Create')
</script>

<ModalShell
  titleId="resource-action-title"
  {opener}
  {busy}
  dismissible={!busy}
  onCancel={() => {
    if (!busy) onCancel()
  }}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <h2 id="resource-action-title">{verb} package resource</h2>
  <p>
    This action writes the resource and the selected workflow reference together. Existing resource files are never
    overwritten.
  </p>
  {#if mode === 'select'}<label
      >Package resource<select data-modal-initial-focus bind:value={artifactPath} disabled={busy}
        ><option value="">Choose a resource</option>{#each choices as path (path)}<option value={path}>{path}</option
          >{/each}</select
      ></label
    >
  {:else}<label>Resource name<input data-modal-initial-focus bind:value={basename} disabled={busy} /></label>
    <label>Extension (optional)<input bind:value={suffix} placeholder="Use runtime default" disabled={busy} /></label>
    {#if mode === 'create'}<label>Initial content<textarea bind:value={initialText} disabled={busy}></textarea></label
      >{:else}<p>The existing inline source is preserved exactly in the new resource.</p>{/if}{/if}
  <button disabled={busy || !ready} onclick={() => void prepare()}>Preview change</button>
  {#if authorized && preview}<p>Resource path: <code>{preview.artifactPath}</code></p>
    <p>Workflow reference: <code>{preview.reference}</code></p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#snippet actions()}<button disabled={busy} onclick={onCancel}>Cancel</button><button
      disabled={busy || !authorized}
      onclick={() => void commit()}>{verb} and update workflow</button
    >{/snippet}
</ModalShell>

<style>
  label {
    display: grid;
    gap: 0.375rem;
    margin-block: 0.75rem;
  }
  input,
  select,
  textarea {
    width: 100%;
    box-sizing: border-box;
  }
  textarea {
    min-height: 8rem;
    font-family: monospace;
  }
  code {
    overflow-wrap: anywhere;
  }
  button {
    min-height: 2rem;
  }
</style>
