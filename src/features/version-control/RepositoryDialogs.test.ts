import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import InitializeRepositoryDialog from './InitializeRepositoryDialog.svelte'
import RepositoryIdentityDialog from './RepositoryIdentityDialog.svelte'

describe('repository mutation confirmations', () => {
  it('names the exact initialization root and makes the no-commit behavior explicit', async () => {
    const confirm = vi.fn()
    render(InitializeRepositoryDialog, { root: '/selected/workspace', onConfirm: confirm, onCancel: vi.fn() })

    expect(screen.getByText('/selected/workspace')).toBeInTheDocument()
    expect(screen.getByText(/does not create a commit/i)).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Initialize repository' }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('requires both identity values and labels them repository-local', async () => {
    const save = vi.fn()
    render(RepositoryIdentityDialog, { root: '/selected/workspace', onSave: save, onCancel: vi.fn() })

    expect(screen.getByText(/only this repository/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Save repository identity' })
    expect(button).toBeDisabled()
    await fireEvent.input(screen.getByLabelText('Author name'), { target: { value: 'Local User' } })
    await fireEvent.input(screen.getByLabelText('Author email'), { target: { value: 'local@example.test' } })
    await fireEvent.click(button)
    expect(save).toHaveBeenCalledWith({ userName: 'Local User', userEmail: 'local@example.test' })
  })

  it('guards initialization and identity promises and renders accessible errors', async () => {
    let rejectInitialize!: (error: Error) => void
    const initialize = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInitialize = reject
        }),
    )
    const { unmount } = render(InitializeRepositoryDialog, {
      root: '/selected/workspace',
      onConfirm: initialize,
      onCancel: vi.fn(),
    })
    const initializeButton = screen.getByRole('button', { name: 'Initialize repository' })
    await fireEvent.click(initializeButton)
    await fireEvent.click(initializeButton)
    expect(initialize).toHaveBeenCalledOnce()
    expect(initializeButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    rejectInitialize(new Error('initialization denied'))
    expect(await screen.findByRole('alert')).toHaveTextContent('initialization denied')
    unmount()

    let rejectIdentity!: (error: Error) => void
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectIdentity = reject
        }),
    )
    render(RepositoryIdentityDialog, { root: '/selected/workspace', onSave: save, onCancel: vi.fn() })
    await fireEvent.input(screen.getByLabelText('Author name'), { target: { value: 'Local User' } })
    await fireEvent.input(screen.getByLabelText('Author email'), { target: { value: 'local@example.test' } })
    await fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(save).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Author name')).toBeDisabled()
    expect(screen.getByLabelText('Author email')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    rejectIdentity(new Error('identity rejected'))
    expect(await screen.findByRole('alert')).toHaveTextContent('identity rejected')
  })
})
