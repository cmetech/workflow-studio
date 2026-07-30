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
})
