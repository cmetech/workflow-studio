<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { setDiagnostics } from '@codemirror/lint'
  import { EditorState, Transaction } from '@codemirror/state'
  import { EditorView, type ViewUpdate } from '@codemirror/view'
  import { executeCommand } from '$src/lib/commands/registry'
  import type { DocumentAnalysis, DocumentKind, DocumentRevision, ValidationIssue } from '$src/lib/documents/types'
  import type { ProjectedNode } from '$src/lib/projection/types'
  import { $canvasSelection as canvasSelectionStore, setCanvasSelection } from '$src/stores/canvas'
  import { selectProblem } from '$src/stores/documents'
  import { issuesToCodeMirrorDiagnostics } from './diagnostics'
  import {
    createEditorExtensions,
    editorSelectionSync,
    externalEditorUpdate,
    nodeAtCursor,
    rangeForSelectedNode,
  } from './editor-extensions'

  interface Props {
    document: DocumentKind
    text: string
    revision: DocumentRevision
    analysis: DocumentAnalysis | null
    nodes: readonly Pick<ProjectedNode, 'id' | 'source'>[]
    readOnly?: boolean
    focusOnSelection?: boolean
    label?: string
    onTextChange: (text: string) => void
  }

  let {
    document: documentKind,
    text,
    revision,
    analysis,
    nodes,
    readOnly = false,
    focusOnSelection = true,
    label = documentKind === 'definition' ? 'Definition YAML' : 'Companion YAML',
    onTextChange,
  }: Props = $props()
  let host: HTMLDivElement
  let view: EditorView | null = null
  let unsubscribeSelection: (() => void) | null = null
  let editorPublishedNode: string | null | undefined

  function onEditorUpdate(update: ViewUpdate): void {
    const externallyUpdated = update.transactions.some((transaction) => transaction.annotation(externalEditorUpdate))
    if (update.docChanged && !externallyUpdated) onTextChange(update.state.doc.toString())

    const synchronizedSelection = update.transactions.some((transaction) => transaction.annotation(editorSelectionSync))
    if (documentKind !== 'definition' || !update.selectionSet || synchronizedSelection) return
    const selectedNode = nodeAtCursor(nodes, update.state.selection.main.head)
    if ((canvasSelectionStore.get()[0] ?? null) === selectedNode && canvasSelectionStore.get().length <= 1) return
    editorPublishedNode = selectedNode
    setCanvasSelection(selectedNode ? [selectedNode] : [])
  }

  function focusIssue(issue: ValidationIssue): void {
    selectProblem(issue)
    void executeCommand('problems.focus', { surface: 'yaml', canMutate: !readOnly, hasSelection: true })
  }

  function refreshDiagnostics(): void {
    if (!view) return
    view.dispatch(
      setDiagnostics(
        view.state,
        issuesToCodeMirrorDiagnostics({
          text: view.state.doc.toString(),
          document: documentKind,
          revision,
          analysis,
          onFocus: focusIssue,
        }),
      ),
    )
  }

  function focusNode(nodeId: string): void {
    if (!view || documentKind !== 'definition') return
    const range = rangeForSelectedNode(nodes, nodeId, view.state.doc.length)
    if (!range) return
    view.dispatch({ selection: { anchor: range.from, head: range.to }, annotations: editorSelectionSync.of('canvas') })
    if (focusOnSelection) view.focus()
  }

  export function getView(): EditorView {
    if (!view) throw new Error('The YAML editor has not mounted.')
    return view
  }

  $effect(() => {
    const nextText = text
    if (!view) return
    if (view.state.doc.toString() !== nextText) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextText },
        annotations: [externalEditorUpdate.of(true), Transaction.addToHistory.of(false)],
      })
    }
    refreshDiagnostics()
  })

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          ...createEditorExtensions(onEditorUpdate, label),
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
        ],
      }),
    })
    host.setAttribute('aria-label', label)
    refreshDiagnostics()
    unsubscribeSelection = canvasSelectionStore.subscribe((selection) => {
      const nodeId = selection.length === 1 ? selection[0] : undefined
      if (editorPublishedNode !== undefined && editorPublishedNode === (nodeId ?? null)) {
        editorPublishedNode = undefined
        return
      }
      if (nodeId) focusNode(nodeId)
    })
  })

  onDestroy(() => {
    unsubscribeSelection?.()
    view?.destroy()
    view = null
  })
</script>

<div class="yaml-editor" bind:this={host} data-document={documentKind}></div>

<style>
  .yaml-editor {
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    background: var(--color-surface);
  }
</style>
