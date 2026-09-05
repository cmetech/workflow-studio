import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import LoopGroupScopeBar from './LoopGroupScopeBar.svelte'

describe('LoopGroupScopeBar', () => {
  it('wraps exact tokens in a bounded scope guide with explicit actions', async () => {
    const onCopy = vi.fn()
    const onInsert = vi.fn()
    const onAddDependency = vi.fn()
    render(LoopGroupScopeBar, {
      groupId: 'repeat',
      suggestions: [
        {
          namespace: 'outer',
          producerId: 'prepare',
          token: '$prepare.output',
          available: true,
          canAddDependency: false,
        },
        {
          namespace: 'previous',
          producerId: 'child',
          token: '$LOOP_PREV.child.output',
          available: true,
          canAddDependency: false,
        },
        {
          namespace: 'outer',
          producerId: 'later',
          token: '$later.output',
          available: false,
          canAddDependency: true,
          reason: 'Add later as a dependency of repeat to use this outer output.',
        },
      ],
      onCopy,
      onInsert,
      onAddDependency,
    })
    expect(screen.getByRole('region', { name: /references for repeat/i })).toHaveAttribute(
      'data-scroll-owner',
      'scope-references',
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Copy $prepare.output' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Insert $LOOP_PREV.child.output' }))
    await fireEvent.click(screen.getByRole('button', { name: /add later as group dependency/i }))
    expect(onCopy).toHaveBeenCalledWith('$prepare.output')
    expect(onInsert).toHaveBeenCalledWith('$LOOP_PREV.child.output')
    expect(onAddDependency).toHaveBeenCalledWith('later')
    expect(screen.getByText(/add later as a dependency/i)).toBeVisible()
  })
})
