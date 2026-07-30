import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import CreateVersionDialog from './CreateVersionDialog.svelte'

describe('CreateVersionDialog', () => {
  it('shows exact pair context and gates creation on readiness and message', async () => {
    const onCreate = vi.fn()
    const { rerender } = render(CreateVersionDialog, {
      files: ['nested/flow.yaml', 'nested/flow.hermes.yaml'],
      diff: 'diff --git a/nested/flow.yaml b/nested/flow.yaml',
      findings: ['Missing provider is advisory'],
      ready: false,
      onCreate,
      onCancel: vi.fn(),
    })

    expect(screen.getByText('nested/flow.yaml')).toBeInTheDocument()
    expect(screen.getByText('nested/flow.hermes.yaml')).toBeInTheDocument()
    expect(screen.getByText('Missing provider is advisory')).toBeInTheDocument()
    expect(screen.getByText(/local Git hooks may run/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create version' })).toBeDisabled()

    await rerender({
      files: ['nested/flow.yaml', 'nested/flow.hermes.yaml'],
      diff: 'diff --git a/nested/flow.yaml b/nested/flow.yaml',
      findings: ['Missing provider is advisory'],
      ready: true,
      onCreate,
      onCancel: vi.fn(),
    })
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Pair checkpoint' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create version' }))

    expect(onCreate).toHaveBeenCalledWith('Pair checkpoint')
  })

  it('guards duplicate submission, disables closing while pending, and renders a bounded rejection', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<never>((_resolve, fail) => {
      reject = fail
    })
    const onCreate = vi.fn(() => pending)
    const onCancel = vi.fn()
    render(CreateVersionDialog, {
      files: ['flow.yaml'],
      diff: 'pair diff',
      findings: [],
      ready: true,
      onCreate,
      onCancel,
    })
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Checkpoint' } })
    const submit = screen.getByRole('button', { name: 'Create version' })

    await fireEvent.click(submit)
    await fireEvent.click(submit)

    expect(onCreate).toHaveBeenCalledOnce()
    expect(submit).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Version message')).toBeDisabled()
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    reject(new Error('hook rejected the exact pair'))
    expect(await screen.findByRole('alert')).toHaveTextContent('hook rejected the exact pair')
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Version message')).toHaveValue('Checkpoint')
  })

  it('renders committed warnings and unknown outcomes as terminal non-repeatable states', async () => {
    const onCreate = vi
      .fn()
      .mockResolvedValueOnce({ status: 'committed', oid: 'a'.repeat(40), warnings: ['Status refresh failed'] })
    const { unmount } = render(CreateVersionDialog, {
      files: ['flow.yaml'],
      diff: 'pair diff',
      findings: [],
      ready: true,
      onCreate,
      onCancel: vi.fn(),
    })
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Checkpoint' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create version' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/committed.*status refresh failed/i)
    expect(screen.queryByRole('button', { name: 'Create version' })).not.toBeInTheDocument()
    unmount()

    const unknownCreate = vi.fn(async () => ({
      status: 'unknown' as const,
      code: 'git_commit_outcome_unknown' as const,
      message: 'Inspect repository before retrying.',
    }))
    render(CreateVersionDialog, {
      files: ['flow.yaml'],
      diff: 'pair diff',
      findings: [],
      ready: true,
      onCreate: unknownCreate,
      onCancel: vi.fn(),
    })
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Checkpoint' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create version' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/inspect repository before retry/i)
    expect(screen.queryByRole('button', { name: 'Create version' })).not.toBeInTheDocument()
    await fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(unknownCreate).toHaveBeenCalledOnce()
  })

  it('focuses the message, traps keyboard focus, and closes with Escape when idle', async () => {
    const onCancel = vi.fn()
    render(CreateVersionDialog, {
      files: ['flow.yaml'],
      diff: 'pair diff',
      findings: [],
      ready: true,
      onCreate: vi.fn(),
      onCancel,
    })
    const dialog = screen.getByRole('dialog')
    const message = screen.getByLabelText('Version message')
    const submit = screen.getByRole('button', { name: 'Create version' })
    expect(message).toHaveFocus()
    await fireEvent.input(message, { target: { value: 'Checkpoint' } })

    submit.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(message).toHaveFocus()
    message.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(submit).toHaveFocus()

    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
