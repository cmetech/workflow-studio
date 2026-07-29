<script lang="ts">
  import { tick } from 'svelte'
  import type { EditorView } from '@codemirror/view'
  import { openSearchPanel } from '@codemirror/search'
  import type { EditorMode } from '$src/lib/commands/types'
  import { isAnalysisCurrent } from '$src/lib/documents/revisions'
  import type { DocumentAnalysis, DocumentKind, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
  import type { WorkflowProjection } from '$src/lib/projection/types'
  import {
    $problemFocus as problemFocusStore,
    acknowledgeProblemFocus,
    type DocumentSyncOrigin,
  } from '$src/stores/documents'
  import { activeYamlDocument, showEditorMode, showYamlDocument } from '$src/stores/shell'
  import YamlEditor from './YamlEditor.svelte'

  interface Props {
    pair: WorkflowPairText
    revision: DocumentRevision
    analysis: DocumentAnalysis | null
    projection: WorkflowProjection | null
    mode: EditorMode
    readOnly?: boolean
    syncOrigins?: Readonly<Record<DocumentKind, DocumentSyncOrigin>>
    onTextChange: (document: DocumentKind, text: string) => void
  }

  let {
    pair,
    revision,
    analysis,
    projection,
    mode,
    readOnly = false,
    syncOrigins = { definition: 'unknown', companion: 'unknown' },
    onTextChange,
  }: Props = $props()
  let definitionEditor = $state<ReturnType<typeof YamlEditor>>()
  let companionEditor = $state<ReturnType<typeof YamlEditor>>()
  let definitionTab = $state<HTMLButtonElement>()
  let companionTab = $state<HTMLButtonElement>()
  let handledProblemRequest = 0
  const tabPrefix = $derived(`yaml-${encodeURIComponent(pair.workflowId)}`)
  const definitionTabId = $derived(`${tabPrefix}-definition-tab`)
  const companionTabId = $derived(`${tabPrefix}-companion-tab`)
  const definitionPanelId = $derived(`${tabPrefix}-definition-panel`)
  const companionPanelId = $derived(`${tabPrefix}-companion-panel`)

  $effect(() => {
    if (!pair.companion && $activeYamlDocument === 'companion') showYamlDocument('definition')
  })

  $effect(() => {
    const request = $problemFocusStore
    if (!request.requested || request.requestRevision === handledProblemRequest) return
    handledProblemRequest = request.requestRevision
    void consumeProblemFocus(request.requestRevision)
  })

  async function consumeProblemFocus(requestRevision: number): Promise<void> {
    const request = problemFocusStore.get()
    const issue = request.issue
    const target = request.targetRevision
    if (
      !request.requested ||
      request.requestRevision !== requestRevision ||
      !issue ||
      !target ||
      !isAnalysisCurrent(revision, target) ||
      (issue.document === 'companion' && !pair.companion)
    ) {
      acknowledgeProblemFocus(requestRevision)
      return
    }
    showYamlDocument(issue.document)
    if (mode === 'visual') showEditorMode('yaml')
    await tick()
    const editor = issue.document === 'definition' ? definitionEditor : companionEditor
    editor?.focusProblem(issue)
    acknowledgeProblemFocus(requestRevision)
  }

  function activateTab(document: DocumentKind, focus: boolean): void {
    if (document === 'companion' && !pair.companion) return
    showYamlDocument(document)
    if (focus) void tick().then(() => (document === 'definition' ? definitionTab : companionTab)?.focus())
  }

  function handleTabKey(event: KeyboardEvent, document: DocumentKind): void {
    const target =
      event.key === 'Home'
        ? 'definition'
        : event.key === 'End'
          ? pair.companion
            ? 'companion'
            : 'definition'
          : event.key === 'ArrowRight'
            ? document === 'definition' && pair.companion
              ? 'companion'
              : 'definition'
            : event.key === 'ArrowLeft'
              ? document === 'companion'
                ? 'definition'
                : pair.companion
                  ? 'companion'
                  : 'definition'
              : null
    if (!target) return
    event.preventDefault()
    activateTab(target, true)
  }

  export function getView(document: DocumentKind): EditorView {
    if (document === 'definition' && definitionEditor) return definitionEditor.getView()
    if (document === 'definition') throw new Error('The definition editor has not mounted.')
    if (!companionEditor) throw new Error('The active workflow has no companion editor.')
    return companionEditor.getView()
  }

  export function openFind(): boolean {
    if (mode === 'visual') return false
    const editor = $activeYamlDocument === 'definition' ? definitionEditor : companionEditor
    if (!editor) return false
    openSearchPanel(editor.getView())
    return true
  }
</script>

<section class:hidden={mode === 'visual'} class="editor-modes" aria-label="YAML editors" data-mode={mode}>
  <div class="yaml-tabs" role="tablist" aria-label="Workflow YAML files">
    <button
      bind:this={definitionTab}
      id={definitionTabId}
      type="button"
      role="tab"
      aria-label="Definition YAML"
      aria-selected={$activeYamlDocument === 'definition'}
      aria-controls={definitionPanelId}
      tabindex={$activeYamlDocument === 'definition' ? 0 : -1}
      onclick={() => activateTab('definition', false)}
      onkeydown={(event) => handleTabKey(event, 'definition')}>Definition</button
    >
    {#if pair.companion}
      <button
        bind:this={companionTab}
        id={companionTabId}
        type="button"
        role="tab"
        aria-label="Companion YAML"
        aria-selected={$activeYamlDocument === 'companion'}
        aria-controls={companionPanelId}
        tabindex={$activeYamlDocument === 'companion' ? 0 : -1}
        onclick={() => activateTab('companion', false)}
        onkeydown={(event) => handleTabKey(event, 'companion')}>Companion</button
      >
    {/if}
  </div>
  <div
    id={definitionPanelId}
    role="tabpanel"
    aria-labelledby={definitionTabId}
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
      active={$activeYamlDocument === 'definition' && mode !== 'visual'}
      focusOnSelection={mode !== 'visual'}
      syncOrigin={syncOrigins.definition}
      onTextChange={(text) => onTextChange('definition', text)}
    />
  </div>
  {#if pair.companion}
    <div
      id={companionPanelId}
      role="tabpanel"
      aria-labelledby={companionTabId}
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
        active={$activeYamlDocument === 'companion' && mode !== 'visual'}
        focusOnSelection={mode !== 'visual'}
        syncOrigin={syncOrigins.companion}
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
