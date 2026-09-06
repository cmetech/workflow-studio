import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ActivityPage from './ActivityPage.svelte'

describe('ActivityPage', () => {
  it('provides a named, focusable page frame with a bounded body and workflow return control', async () => {
    const onBack = vi.fn()
    const { container } = render(ActivityPage, {
      activity: 'settings',
      title: 'Settings',
      description: 'Manage the application.',
      showBack: true,
      onBack,
    })

    expect(screen.getByRole('region', { name: 'Settings' })).toHaveAttribute('data-workbench-page', 'settings')
    const heading = screen.getByRole('heading', { name: 'Settings' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    await waitFor(() => expect(heading).toHaveFocus())
    const back = screen.getByRole('button', { name: 'Back to Workflow' })
    expect(back).toHaveAttribute('data-variant', 'secondary')
    expect(back.querySelector('svg')).not.toBeNull()
    await fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-page-scroll]')).not.toBeNull()
  })
})
