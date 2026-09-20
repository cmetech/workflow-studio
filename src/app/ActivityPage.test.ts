import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ActivityPage from './ActivityPage.svelte'
import { tick } from 'svelte'

describe('ActivityPage', () => {
  it('yields navigation updates before focusing the destination heading', async () => {
    let frame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const rendered = render(ActivityPage, { activity: 'settings', title: 'Settings', description: 'Preferences' })
    try {
      await tick()
      const heading = screen.getByRole('heading', { name: 'Settings' })
      expect(heading).not.toHaveFocus()
      expect(frame).toBeDefined()
      frame!(0)
      expect(heading).toHaveFocus()
    } finally {
      rendered.unmount()
      vi.unstubAllGlobals()
    }
  })

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
