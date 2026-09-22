<script lang="ts">
  import { tick } from 'svelte'
  import { analyzeCommandMarkdown } from '$src/lib/packages/command-markdown'
  import type { PackageReference } from '$src/lib/packages/package-references'
  import TextArtifactEditor, { type ArtifactFocusRequest } from './TextArtifactEditor.svelte'
  import CommandPreview from './CommandPreview.svelte'
  interface Props {
    path: string
    text: string
    dirty?: boolean
    readOnly?: boolean
    schema?: object
    references?: readonly PackageReference[]
    focusRequest?: ArtifactFocusRequest | null
    onTextChange: (text: string) => void
    onSave: () => void | Promise<void>
  }
  let {
    path,
    text,
    dirty = false,
    readOnly = false,
    schema,
    references = [],
    focusRequest = null,
    onTextChange,
    onSave,
  }: Props = $props()
  const id = $props.id()
  const tabs = ['Edit', 'Preview', 'References'] as const
  let selected = $state(0)
  let lastFocus: { id: string | number; path: string } | null = null
  $effect(() => {
    if (!focusRequest || (lastFocus?.id === focusRequest.id && lastFocus.path === path)) return
    lastFocus = { id: focusRequest.id, path }
    selected = 0
  })
  let buttons = $state<HTMLButtonElement[]>([])
  const analysis = $derived(analyzeCommandMarkdown(path, text, schema))
  async function key(event: KeyboardEvent, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    selected = next
    await tick()
    buttons[next]?.focus()
  }
</script>

<div class="command-editor">
  <div role="tablist" aria-label="Command views">
    {#each tabs as tab, index (tab)}
      <button
        type="button"
        role="tab"
        id={`${id}-tab-${index}`}
        aria-controls={`${id}-panel-${index}`}
        aria-selected={selected === index}
        tabindex={selected === index ? 0 : -1}
        bind:this={buttons[index]}
        onclick={() => (selected = index)}
        onkeydown={(event) => key(event, index)}>{tab}</button
      >
    {/each}
  </div>
  <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={selected !== 0}>
    <TextArtifactEditor {path} {text} {dirty} {readOnly} {focusRequest} language="markdown" {onTextChange} {onSave} />
    {#if analysis.findings.length}
      <ul aria-label="Command problems">
        {#each analysis.findings as finding, index (index)}<li>Line {finding.line ?? 1}: {finding.message}</li>{/each}
      </ul>
    {/if}
  </div>
  <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={selected !== 1}>
    {#if selected === 1}<CommandPreview markdown={analysis.body} />{/if}
  </div>
  <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={selected !== 2}>
    {#if references.length}<ul aria-label="Referencing workflow nodes">
        {#each references as reference, index (index)}<li>{reference.workflowPath} — {reference.nodeId}</li>{/each}
      </ul>
    {:else}<p>No workflow references this command.</p>{/if}
  </div>
</div>

<style>
  .command-editor {
    display: flex;
    flex-direction: column;
    min-height: 16rem;
    height: 100%;
  }
  [role='tablist'] {
    display: flex;
    gap: 0.5rem;
    border-bottom: 1px solid var(--color-border);
  }
  [role='tabpanel']:not([hidden]) {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  button {
    min-height: 2.25rem;
    padding: 0.5rem 0.75rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
  button[aria-selected='true'] {
    border-bottom: 3px solid var(--color-primary);
  }
  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
</style>
