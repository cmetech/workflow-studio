<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { setDiagnostics } from '@codemirror/lint'
  import { Compartment, EditorState, Transaction } from '@codemirror/state'
  import { EditorView, type ViewUpdate } from '@codemirror/view'
  import { executeCommand } from '$src/lib/commands/registry'
  import type { DocumentAnalysis, DocumentKind, DocumentRevision, ValidationIssue } from '$src/lib/documents/types'
  import type { ProjectedNode } from '$src/lib/projection/types'
  import { $canvasSelection as canvasSelectionStore, setCanvasSelection } from '$src/stores/canvas'
  import { selectProblem } from '$src/stores/documents'
  import type { DocumentSyncOrigin } from '$src/stores/documents'
  import { issuePositionForText, issuesToCodeMirrorDiagnostics } from './diagnostics'
  import {
    createEditorExtensions,
    editorSelectionSync,
    externalEditorChange,
    externalEditorUpdate,
    nodeAtCursor,
    rangeForSelectedNode,
    rangeSynchronizationIsCurrent,
  } from './editor-extensions'

  interface Props {
    document: DocumentKind
    text: string
    revision: DocumentRevision
    analysis: DocumentAnalysis | null
    nodes: readonly Pick<ProjectedNode, 'id' | 'source'>[]
    readOnly?: boolean
    active?: boolean
    focusOnSelection?: boolean
    syncOrigin?: DocumentSyncOrigin
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
    active = true,
    focusOnSelection = true,
    syncOrigin = 'unknown',
    label = documentKind === 'definition' ? 'Definition YAML' : 'Companion YAML',
    onTextChange,
  }: Props = $props()
  let host: HTMLDivElement
  let view: EditorView | null = null
  let unsubscribeSelection: (() => void) | null = null
  let editorPublishedNode: string | null | undefined
  let resettingExternalState = false
  let configuredReadOnly = false
  const accessCompartment = new Compartment()

  function onEditorUpdate(update: ViewUpdate): void {
    const externallyUpdated = update.transactions.some((transaction) => transaction.annotation(externalEditorUpdate))
    if (update.docChanged && !externallyUpdated && !resettingExternalState) onTextChange(update.state.doc.toString())

    const synchronizedSelection = update.transactions.some((transaction) => transaction.annotation(editorSelectionSync))
    if (
      documentKind !== 'definition' ||
      !update.selectionSet ||
      synchronizedSelection ||
      !rangeSynchronizationIsCurrent(revision, analysis)
    )
      return
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
    if (!view || documentKind !== 'definition' || !rangeSynchronizationIsCurrent(revision, analysis)) return
    const range = rangeForSelectedNode(nodes, nodeId, view.state.doc.length)
    if (!range) return
    view.dispatch({ selection: { anchor: range.from, head: range.to }, annotations: editorSelectionSync.of('canvas') })
    if (active && focusOnSelection) view.focus()
  }

  export function focusProblem(issue: ValidationIssue): boolean {
    if (!view || !active || issue.document !== documentKind) return false
    const position = issuePositionForText(view.state.doc.toString(), issue)
    view.dispatch({ selection: { anchor: position }, annotations: editorSelectionSync.of('problem') })
    view.focus()
    return true
  }

  export function getView(): EditorView {
    if (!view) throw new Error('The YAML editor has not mounted.')
    return view
  }

  function accessExtensions(value: boolean) {
    return [EditorView.editable.of(!value), EditorState.readOnly.of(value)]
  }

  function createState(doc: string): EditorState {
    configuredReadOnly = readOnly
    return EditorState.create({
      doc,
      extensions: [...createEditorExtensions(onEditorUpdate, label), accessCompartment.of(accessExtensions(readOnly))],
    })
  }

  $effect(() => {
    const nextText = text
    if (!view) return
    if (configuredReadOnly !== readOnly) {
      configuredReadOnly = readOnly
      view.dispatch({ effects: accessCompartment.reconfigure(accessExtensions(readOnly)) })
    }
    if (view.state.doc.toString() !== nextText) {
      const external = externalEditorChange(view.state.doc.toString(), nextText, syncOrigin)
      if (external.kind === 'mapped') {
        view.dispatch({
          changes: external.change,
          annotations: [externalEditorUpdate.of(true), Transaction.addToHistory.of(false)],
        })
      } else {
        resettingExternalState = true
        view.setState(createState(nextText))
        resettingExternalState = false
      }
    }
    refreshDiagnostics()
  })

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: createState(text),
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
