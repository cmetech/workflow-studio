import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageMutationDialog from './PackageMutationDialog.svelte'
const preview = {
  root: 'pkg',
  request: { kind: 'trash-artifact', path: 'notes.txt' },
  changes: [{ path: 'pkg/notes.txt', operation: 'trash', expectedHash: 'a'.repeat(64) }],
  referenceChanges: [],
  plan: {},
}
it('offers membership-only, trash-pair and cancel with no mutation before explicit confirmation', async () => {
  const onPreview = vi.fn().mockResolvedValue(preview),
    onCommit = vi.fn(),
    onCancel = vi.fn()
  render(PackageMutationDialog, {
    root: 'pkg',
    mode: 'remove-workflow',
    path: 'main.yaml',
    onPreview,
    onCommit,
    onCancel,
  })
  expect(screen.getByRole('button', { name: 'Remove membership only' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Trash declared pair' })).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(onPreview).not.toHaveBeenCalled()
  expect(onCommit).not.toHaveBeenCalled()
})
it('shows the exact path/hash preview and invalidates rename confirmation when its destination changes', async () => {
  const onPreview = vi.fn().mockResolvedValue(preview),
    onCommit = vi.fn()
  render(PackageMutationDialog, {
    root: 'pkg',
    mode: 'rename',
    path: 'notes.txt',
    onPreview,
    onCommit,
    onCancel: vi.fn(),
  })
  await fireEvent.input(screen.getByLabelText('New package-relative path'), { target: { value: 'renamed.txt' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
  expect(await screen.findByText('pkg/notes.txt')).toBeVisible()
  expect(screen.getByText('a'.repeat(64))).toBeVisible()
  await fireEvent.input(screen.getByLabelText('New package-relative path'), { target: { value: 'other.txt' } })
  expect(screen.queryByRole('button', { name: 'Confirm changes' })).not.toBeInTheDocument()
  expect(onCommit).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
  await fireEvent.click(await screen.findByRole('button', { name: 'Confirm changes' }))
  await waitFor(() => expect(onCommit).toHaveBeenCalledWith(preview))
})
it('keeps the dialog and exact recovery destination after native failure', async () => {
  const failure = Object.assign(Error('Recovery required'), {
    pathResults: [
      {
        relativePath: 'pkg/notes.txt',
        destinationPath: 'pkg/.recovery/exact',
        status: 'partial',
        message: 'Retained original',
      },
    ],
  })
  const onCommit = vi.fn().mockRejectedValue(failure),
    onCancel = vi.fn()
  render(PackageMutationDialog, {
    root: 'pkg',
    mode: 'trash',
    path: 'notes.txt',
    onPreview: vi.fn().mockResolvedValue(preview),
    onCommit,
    onCancel,
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
  await fireEvent.click(await screen.findByRole('button', { name: 'Confirm changes' }))
  expect(await screen.findByText('pkg/.recovery/exact')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('Recovery required')
  expect(onCancel).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
})
