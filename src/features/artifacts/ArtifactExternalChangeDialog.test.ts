import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import ArtifactExternalChangeDialog from './ArtifactExternalChangeDialog.svelte'

it('names the exact artifact, requires comparison, and restores editor focus', async () => {
  const editor = document.createElement('textarea')
  document.body.append(editor)
  editor.focus()
  const onChoice = vi.fn()
  const view = render(ArtifactExternalChangeDialog, {
    path: 'scripts/<unsafe>.py',
    diffViewed: false,
    onChoice,
    opener: editor,
  })
  expect(screen.getByRole('dialog', { name: 'Artifact changed on disk' })).toBeVisible()
  expect(screen.getByText('scripts/<unsafe>.py')).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compare' })).toHaveFocus())
  expect(screen.getByRole('button', { name: 'Keep Mine' })).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
  expect(onChoice).toHaveBeenCalledWith('compare')
  await view.rerender({ path: 'scripts/<unsafe>.py', diffViewed: true, onChoice, opener: editor })
  await fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
  expect(onChoice).toHaveBeenCalledWith('keep-mine')
  view.unmount()
  await waitFor(() => expect(editor).toHaveFocus())
  editor.remove()
})
