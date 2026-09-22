import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import TextArtifactEditor from './TextArtifactEditor.svelte'

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
