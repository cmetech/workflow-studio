import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import GraphScopeHeader from './GraphScopeHeader.svelte'

describe('GraphScopeHeader', () => {
  it('names the workflow and group, exposes a focusable heading, and returns with a keyboard-operable Back control', async () => {
    const onBack = vi.fn()
    render(GraphScopeHeader, { workflowName: 'Release workflow', groupId: 'repeat', onBack })

    const heading = screen.getByRole('heading', { name: 'Release workflow / repeat loop body' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading).toHaveAttribute('data-scope-heading')
    const back = screen.getByRole('button', { name: 'Back to root workflow' })
    expect(back).toHaveAttribute('data-variant', 'secondary')
    expect(back).toHaveClass('back-button')
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(back).toHaveTextContent('Back')
    await fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
  })
})
