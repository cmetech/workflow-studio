import { render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { expect, it, vi } from 'vitest'
import ArtifactEditor from './ArtifactEditor.svelte'
import type { ArtifactDocument } from '$src/lib/artifacts/types'
import { EditorView } from '@codemirror/view'

const document: ArtifactDocument = {
  artifactId: 'artifact:workspace:file',
  workspaceId: 'workspace',
  path: 'digests.json',
  language: 'json',
  text: '{}',
  revision: 1,
  savedRevision: 1,
  diskHash: 'hash',
  origin: 'disk',
  dirty: false,
  readOnly: false,
}
it.each([false, true])('forwards source focus through the command=%s route', async (command) => {
  const onTextChange = vi.fn()
  const { container } = render(ArtifactEditor, {
    document: { ...document, path: 'commands/test.md', language: 'markdown', text: 'one\ntwo' },
    command,
    focusRequest: { id: 'problem', line: 2, column: 2 },
    onTextChange,
    onSave: vi.fn(),
  })
  await tick()
  const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  expect(view.state.selection.main.anchor).toBe(5)
  expect(screen.getByRole('textbox', { name: 'commands/test.md' })).toHaveFocus()
  expect(onTextChange).not.toHaveBeenCalled()
})
it('explains generated files and enforces read-only editing', async () => {
  render(ArtifactEditor, { document, generated: true, onTextChange: vi.fn(), onSave: vi.fn() })
  await tick()
  expect(screen.getByText(/Regenerate this file/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})
it('opens script drafts with the selected language', async () => {
  render(ArtifactEditor, {
    document: { ...document, path: 'scripts/test.py', language: 'python', text: 'print(1)', dirty: true },
    onTextChange: vi.fn(),
    onSave: vi.fn(),
  })
  await tick()
  expect(screen.getByRole('textbox', { name: 'scripts/test.py' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})
it('routes command resources to the Markdown edit and preview surface', async () => {
  render(ArtifactEditor, {
    document: { ...document, path: 'commands/review.md', language: 'markdown' },
    command: true,
    onTextChange: vi.fn(),
    onSave: vi.fn(),
  })
  await tick()
  expect(screen.getByRole('tab', { name: 'Preview' })).toBeVisible()
})
