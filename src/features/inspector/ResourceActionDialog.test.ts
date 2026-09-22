import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import ResourceActionDialog from './ResourceActionDialog.svelte'
it('previews exact planned path before explicitly committing creation', async () => {
  const onPreview = vi.fn(async () => ({ artifactPath: 'pkg/scripts/check.py', reference: 'check' }))
  const onCommit = vi.fn()
  render(ResourceActionDialog, { mode: 'create', opener: null, choices: [], onPreview, onCommit, onCancel: vi.fn() })
  await fireEvent.input(screen.getByLabelText('Resource name'), { target: { value: 'check' } })
  await fireEvent.input(screen.getByLabelText('Initial content'), { target: { value: 'print(1)' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Preview change' }))
  await screen.findByText('pkg/scripts/check.py')
  expect(onCommit).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: 'Create and update workflow' }))
  await waitFor(() => expect(onCommit).toHaveBeenCalledOnce())
  expect(onPreview).toHaveBeenCalledWith({ basename: 'check', initialText: 'print(1)' })
})
it('invalidates a preview after the request changes and preserves errors', async () => {
  const onPreview = vi.fn(async () => ({ artifactPath: 'p/a', reference: 'a' }))
  const onCommit = vi.fn(async () => {
    throw Error('disk changed')
  })
  render(ResourceActionDialog, { mode: 'select', choices: ['p/a', 'p/b'], onPreview, onCommit, onCancel: vi.fn() })
  await fireEvent.change(screen.getByLabelText('Package resource'), { target: { value: 'p/a' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Preview change' }))
  const confirm = await screen.findByRole('button', { name: 'Select and update workflow' })
  await fireEvent.change(screen.getByLabelText('Package resource'), { target: { value: 'p/b' } })
  expect(confirm).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Preview change' }))
  await waitFor(() => expect(confirm).not.toBeDisabled())
  await fireEvent.click(confirm)
  expect(await screen.findByRole('alert')).toHaveTextContent('disk changed')
})
