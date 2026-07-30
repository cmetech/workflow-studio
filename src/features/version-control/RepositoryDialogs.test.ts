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
})
