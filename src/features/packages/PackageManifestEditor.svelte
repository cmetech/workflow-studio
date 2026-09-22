<script lang="ts">
  import type { ArtifactDocument } from '$src/lib/artifacts/types'
  import PackageInspector from './PackageInspector.svelte'
  import ArtifactEditor from '$src/features/artifacts/ArtifactEditor.svelte'
  import type { ArtifactFocusRequest } from '$src/features/artifacts/TextArtifactEditor.svelte'
  let {
    document,
    focusRequest = null,
    onTextChange,
    onSave,
  }: {
    document: ArtifactDocument
    focusRequest?: ArtifactFocusRequest | null
    onTextChange: (text: string) => void
    onSave: () => void | Promise<void>
  } = $props()
  let source = $state(false)
  let lastFocus: { id: string | number; path: string } | null = null
  $effect(() => {
    if (!focusRequest || (lastFocus?.id === focusRequest.id && lastFocus.path === document.path)) return
    lastFocus = { id: focusRequest.id, path: document.path }
    source = true
  })
  export function showSource(): void {
    source = true
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      source = !source
      const tabs = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]')
      tabs[source ? 1 : 0]?.focus()
    }
  }
</script>

<section aria-label="Package manifest editor">
  <div tabindex="-1" role="tablist" aria-label="Manifest mode" onkeydown={keys}>
    <button role="tab" aria-selected={!source} tabindex={source ? -1 : 0} onclick={() => (source = false)}
      >Publishing fields</button
    ><button role="tab" aria-selected={source} tabindex={source ? 0 : -1} onclick={() => (source = true)}
      >Advanced Source</button
    >
  </div>
  {#if source}<ArtifactEditor {document} {focusRequest} {onTextChange} {onSave} />{:else}<PackageInspector
      text={document.text}
      readOnly={document.readOnly}
      {onTextChange}
      onAdvanced={() => (source = true)}
    /><button disabled={document.readOnly || !document.dirty} onclick={onSave}>Save</button>{/if}
</section>

<style>
  section {
    min-height: 0;
    overflow: auto;
  }
  [role='tablist'] {
    display: flex;
    gap: var(--space-2);
  }
</style>
