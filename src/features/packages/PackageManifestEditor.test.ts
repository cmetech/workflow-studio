import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageManifestEditor from './PackageManifestEditor.svelte'
import { createArtifactDocument } from '$src/lib/artifacts/artifact-session'
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
