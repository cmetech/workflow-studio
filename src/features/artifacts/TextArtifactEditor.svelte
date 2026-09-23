<script module lang="ts">
  export interface ArtifactFocusRequest {
    readonly id: string | number
    readonly line: number
    readonly column: number
  }
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack, tick } from 'svelte'
  import { basicSetup } from 'codemirror'
  import { Compartment, EditorState, Transaction, Annotation } from '@codemirror/state'
  import { EditorView, keymap } from '@codemirror/view'
  import { openSearchPanel } from '@codemirror/search'
  import { lintGutter, setDiagnostics } from '@codemirror/lint'
  import type { ArtifactLanguage } from '$src/lib/artifacts/types'
  import { languageExtension, artifactEditorTheme } from './artifact-editor-extensions'
  import { staticDiagnostics, type ArtifactDiagnostic } from './static-diagnostics'

  interface Props {
    path: string
    language: ArtifactLanguage
    text: string
    dirty?: boolean
    readOnly?: boolean
    focusRequest?: ArtifactFocusRequest | null
    onTextChange: (text: string) => void
    onSave: () => void | Promise<void>
  }
  let {
    path,
    language,
    text,
    dirty = false,
    readOnly = false,
    focusRequest = null,
    onTextChange,
    onSave,
  }: Props = $props()
  let host: HTMLDivElement
  let view = $state.raw<EditorView | null>(null)
  let localText = $state(untrack(() => text))
  let saving = $state(false)
  let error = $state('')
  let disposed = false
  let lastFocus: { id: string | number; path: string } | null = null
  const languageSlot = new Compartment(),
    accessSlot = new Compartment(),
    labelSlot = new Compartment()
  const external = Annotation.define<boolean>()
  let configuredLanguage: ArtifactLanguage, configuredAccess: boolean, configuredPath: string
  const problems = $derived(staticDiagnostics(language, localText))
  const access = () => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]

  async function save() {
    if (readOnly || saving) return
    saving = true
    error = ''
    try {
      await onSave()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save the artifact.'
    } finally {
      saving = false
    }
  }
  function focusProblem(problem: ArtifactDiagnostic) {
    view?.dispatch({ selection: { anchor: Math.min(problem.from, view.state.doc.length) }, scrollIntoView: true })
    view?.focus()
  }
  onMount(() => {
    configuredLanguage = language
    configuredAccess = readOnly
    configuredPath = path
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          lintGutter(),
          artifactEditorTheme,
          languageSlot.of(languageExtension(language)),
          accessSlot.of(access()),
          labelSlot.of(EditorView.contentAttributes.of({ 'aria-label': path })),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                void save()
                return true
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            localText = update.state.doc.toString()
            if (!update.transactions.some((t) => t.annotation(external))) onTextChange(localText)
          }),
        ],
      }),
    })
  })
  $effect(() => {
    if (!view) return
    if (configuredLanguage !== language) {
      view.dispatch({ effects: languageSlot.reconfigure(languageExtension(language)) })
      configuredLanguage = language
    }
    if (configuredAccess !== readOnly) {
      view.dispatch({ effects: accessSlot.reconfigure(access()) })
      configuredAccess = readOnly
    }
    if (configuredPath !== path) {
      view.dispatch({ effects: labelSlot.reconfigure(EditorView.contentAttributes.of({ 'aria-label': path })) })
      configuredPath = path
    }
    if (view.state.doc.toString() !== text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      })
    }
  })
  $effect(() => {
    const request = focusRequest,
      target = view,
      targetPath = path
    if (!request || !target || (lastFocus?.id === request.id && lastFocus.path === targetPath)) return
    lastFocus = { id: request.id, path: targetPath }
    void tick().then(() => {
      if (disposed || view !== target || path !== targetPath || focusRequest?.id !== request.id) return
      const lineNumber = Math.max(
        1,
        Math.min(target.state.doc.lines, Number.isFinite(request.line) ? Math.floor(request.line) : 1),
      )
      const line = target.state.doc.line(lineNumber)
      const column = Math.max(
        1,
        Math.min(line.length + 1, Number.isFinite(request.column) ? Math.floor(request.column) : 1),
      )
      target.dispatch({
        selection: { anchor: line.from + column - 1 },
        scrollIntoView: true,
        annotations: Transaction.addToHistory.of(false),
      })
      target.focus()
    })
  })
  $effect(() => {
    if (view)
      view.dispatch(
        setDiagnostics(
          view.state,
          problems.map((p) => ({ from: p.from, to: p.to, severity: 'error' as const, message: p.message })),
        ),
      )
  })
  onDestroy(() => {
    disposed = true
    view?.destroy()
  })
</script>

<section aria-label="Artifact text editor">
  <header>
    <strong>{path}</strong>
    <span role="status">{readOnly ? 'Read-only' : dirty ? 'Unsaved changes' : 'Saved'}</span>
    <button type="button" onclick={() => view && openSearchPanel(view)}>Find</button>
    <button type="button" disabled={readOnly || saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</button>
  </header>
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="editor-host" bind:this={host}></div>
  {#if problems.length}
    <ul aria-label="Artifact problems">
      {#each problems as problem, index (index)}
        <li>
          <button type="button" onclick={() => focusProblem(problem)}>Line {problem.line}: {problem.message}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 16rem;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    flex-wrap: wrap;
  }
  strong {
    overflow-wrap: anywhere;
  }
  .editor-host {
    flex: 1;
    min-height: 12rem;
    overflow: auto;
  }
  button {
    min-height: 2rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
  }
  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  ul {
    max-height: 10rem;
    overflow: auto;
  }
</style>
