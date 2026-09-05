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
    await fireEvent.click(screen.getByRole('button', { name: 'Back to root workflow' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
