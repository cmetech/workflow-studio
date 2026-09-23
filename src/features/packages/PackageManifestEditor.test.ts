import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageManifestEditor from './PackageManifestEditor.svelte'
import { createArtifactDocument } from '$src/lib/artifacts/artifact-session'
import { EditorView } from '@codemirror/view'
import { tick } from 'svelte'

it('opens Advanced Source at the requested finding without modifying the manifest', async () => {
  const doc = createArtifactDocument(
    'workspace',
    'workflow-package.json',
    'json',
    '{\n  "unknown": true\n}',
    'hash',
    false,
  )
  const onTextChange = vi.fn()
  const { container } = render(PackageManifestEditor, {
    document: doc,
    focusRequest: { id: 1, line: 2, column: 3 },
    onTextChange,
    onSave: vi.fn(),
  })
  await tick()
  expect(screen.getByRole('tab', { name: 'Advanced Source' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: doc.path })).toHaveFocus()
  expect(EditorView.findFromDOM(container.querySelector('.cm-content')!)!.state.selection.main.anchor).toBe(4)
  expect(onTextChange).not.toHaveBeenCalled()
})
it('switches to current source without replacing unknown manifest properties', async () => {
  const doc = createArtifactDocument(
    'workspace',
    'workflow-package.json',
    'json',
    '{"displayName":"Example","unknown":true}',
    'hash',
    false,
  )
  render(PackageManifestEditor, { document: doc, onTextChange: vi.fn(), onSave: vi.fn() })
  await fireEvent.click(screen.getByRole('tab', { name: 'Advanced Source' }))
  expect(screen.getByRole('textbox', { name: 'workflow-package.json' })).toBeVisible()
})
