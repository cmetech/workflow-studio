import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ApplicationNotice from './ApplicationNotice.svelte'

describe('ApplicationNotice', () => {
  it('renders bounded wrapping error content with an optional named dismissal', async () => {
    const onDismiss = vi.fn()
    const message = `Could not open ${'C:\\very-long-workspace-path\\'.repeat(20)}`
    const { container } = render(ApplicationNotice, {
      kind: 'error',
      message,
      dismissible: true,
      onDismiss,
    })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(container.querySelector('[data-application-notice]')).toHaveAttribute('data-kind', 'error')
    expect(container.querySelector('[data-notice-scroll]')).toHaveTextContent(message)
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it.each([
    ['warning', 'status'],
    ['info', 'status'],
  ] as const)('uses a quiet %s announcement and omits dismissal by default', (kind, role) => {
    render(ApplicationNotice, { kind, message: `${kind} message` })

    expect(screen.getByRole(role)).toHaveTextContent(`${kind} message`)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })
})
