import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { undoDepth } from '@codemirror/commands'
import TextArtifactEditor from './TextArtifactEditor.svelte'

it('focuses a one-based source position after mount without editing or creating undo history', async () => {
  const onTextChange = vi.fn()
  const props = {
    path: 'source.txt',
    language: 'text' as const,
    text: 'first\nsecond\nlast',
    onTextChange,
    onSave: vi.fn(),
    focusRequest: { id: 1, line: 2, column: 3 },
  }
  const { container, rerender } = render(TextArtifactEditor, props)
  await tick()
  const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  expect(view.state.selection.main.anchor).toBe(8)
  expect(screen.getByRole('textbox', { name: props.path })).toHaveFocus()
  expect(view.state.doc.toString()).toBe(props.text)
  expect(undoDepth(view.state)).toBe(0)
  expect(onTextChange).not.toHaveBeenCalled()
  view.dispatch({ selection: { anchor: 0 } })
  await rerender({ ...props, dirty: true })
  expect(view.state.selection.main.anchor).toBe(0)
})

it('clamps new focus requests against the current source document', async () => {
  const props = {
    path: 'source.txt',
    language: 'text' as const,
    text: 'first\nlast',
    onTextChange: vi.fn(),
    onSave: vi.fn(),
  }
  const { container, rerender } = render(TextArtifactEditor, props)
  await tick()
  const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  await rerender({ ...props, focusRequest: { id: 'last', line: 999, column: 999 } })
  expect(view.state.selection.main.anchor).toBe(props.text.length)
  await rerender({ ...props, focusRequest: { id: 'invalid', line: -4, column: Number.NaN } })
  expect(view.state.selection.main.anchor).toBe(0)
  await rerender({ ...props, text: 'a\nbcd', focusRequest: { id: 'updated', line: 2.9, column: 2.8 } })
  expect(view.state.selection.main.anchor).toBe(3)
  expect(props.onTextChange).not.toHaveBeenCalled()
  expect(undoDepth(view.state)).toBe(0)
})

it('edits invalid scripts, reports diagnostics and allows saving the exact draft', async () => {
  const onTextChange = vi.fn(),
    onSave = vi.fn()
  const { container } = render(TextArtifactEditor, {
    path: 'scripts/test.py',
    language: 'python',
    text: 'def broken(:\n',
    dirty: true,
    onTextChange,
    onSave,
  })
  await tick()
  expect(screen.getByRole('textbox', { name: 'scripts/test.py' })).toBeVisible()
  expect(container.querySelector('.cm-lineNumbers')).not.toBeNull()
  expect(screen.getByText('Unsaved changes')).toBeVisible()
  expect(screen.getByRole('list', { name: 'Artifact problems' }).children.length).toBeGreaterThan(0)
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledOnce()
  const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'print(1)' } })
  expect(onTextChange).toHaveBeenCalledWith('print(1)')
})
it('reconfigures language and read-only access without replacing the editor', async () => {
  const props = {
    path: 'script',
    language: 'python' as const,
    text: 'print(1)',
    onTextChange: vi.fn(),
    onSave: vi.fn(),
  }
  const { container, rerender } = render(TextArtifactEditor, props)
  await tick()
  const original = container.querySelector('.cm-editor')
  await rerender({ ...props, language: 'typescript', text: 'const a = 1', readOnly: true })
  expect(container.querySelector('.cm-editor')).toBe(original)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false')
})
it('opens search and moves focus to a diagnostic', async () => {
  render(TextArtifactEditor, {
    path: 'bad.js',
    language: 'javascript',
    text: 'function (',
    onTextChange: vi.fn(),
    onSave: vi.fn(),
  })
  await tick()
  await fireEvent.click(screen.getByRole('button', { name: 'Find' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Find' })).toBeVisible())
  await fireEvent.click(screen.getAllByRole('button', { name: /Line .*Syntax/ })[0]!)
  expect(screen.getByRole('textbox', { name: 'bad.js' })).toHaveFocus()
})
