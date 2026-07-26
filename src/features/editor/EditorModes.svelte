<script lang="ts">
  import type { EditorView } from '@codemirror/view'
  import type { EditorMode } from '$src/lib/commands/types'
  import type { DocumentAnalysis, DocumentKind, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
  import type { WorkflowProjection } from '$src/lib/projection/types'
  import { activeYamlDocument, showYamlDocument } from '$src/stores/shell'
  import YamlEditor from './YamlEditor.svelte'

  interface Props {
    pair: WorkflowPairText
    revision: DocumentRevision
    analysis: DocumentAnalysis | null
    projection: WorkflowProjection | null
    mode: EditorMode
    readOnly?: boolean
    onTextChange: (document: DocumentKind, text: string) => void
  }

  let { pair, revision, analysis, projection, mode, readOnly = false, onTextChange }: Props = $props()
  let definitionEditor = $state<ReturnType<typeof YamlEditor>>()
  let companionEditor = $state<ReturnType<typeof YamlEditor>>()

  $effect(() => {
    if (!pair.companion && $activeYamlDocument === 'companion') showYamlDocument('definition')
  })

  export function getView(document: DocumentKind): EditorView {
    if (document === 'definition' && definitionEditor) return definitionEditor.getView()
    if (document === 'definition') throw new Error('The definition editor has not mounted.')
    if (!companionEditor) throw new Error('The active workflow has no companion editor.')
    return companionEditor.getView()
  }
</script>

<section class:hidden={mode === 'visual'} class="editor-modes" aria-label="YAML editors" data-mode={mode}>
  <div class="yaml-tabs" role="tablist" aria-label="Workflow YAML files">
    <button
      type="button"
      role="tab"
      aria-selected={$activeYamlDocument === 'definition'}
      aria-controls="definition-yaml-panel"
      onclick={() => showYamlDocument('definition')}>Definition</button
    >
    {#if pair.companion}
      <button
        type="button"
        role="tab"
        aria-selected={$activeYamlDocument === 'companion'}
        aria-controls="companion-yaml-panel"
        onclick={() => showYamlDocument('companion')}>Companion</button
      >
    {/if}
  </div>
  <div
    id="definition-yaml-panel"
    role="tabpanel"
    aria-label="Definition YAML"
    class:inactive={$activeYamlDocument !== 'definition'}
  >
    <YamlEditor
      bind:this={definitionEditor}
      document="definition"
      text={pair.definition.text}
      {revision}
      {analysis}
      nodes={projection?.nodes ?? []}
      {readOnly}
      focusOnSelection={mode !== 'visual'}
      onTextChange={(text) => onTextChange('definition', text)}
    />
  </div>
  {#if pair.companion}
    <div
      id="companion-yaml-panel"
      role="tabpanel"
      aria-label="Companion YAML"
      class:inactive={$activeYamlDocument !== 'companion'}
    >
      <YamlEditor
        bind:this={companionEditor}
        document="companion"
        text={pair.companion.text}
        {revision}
        {analysis}
        nodes={[]}
        {readOnly}
        focusOnSelection={mode !== 'visual'}
        onTextChange={(text) => onTextChange('companion', text)}
      />
    </div>
  {/if}
</section>

<style>
  .editor-modes {
    display: grid;
    grid-template-rows: 2.25rem minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--color-surface);
  }

  .hidden,
  .inactive {
    display: none;
  }

  .yaml-tabs {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-yaml-gutter);
  }

  .yaml-tabs button {
    min-height: 1.75rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    color: var(--color-text-muted);
    background: transparent;
  }

  .yaml-tabs button[aria-selected='true'] {
    border-color: var(--color-edge);
    color: var(--color-text);
    background: var(--color-node-selected);
  }

  [role='tabpanel'] {
    min-width: 0;
    min-height: 0;
  }
</style>
