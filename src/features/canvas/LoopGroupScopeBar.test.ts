import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
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
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'previous', token: '$LOOP_PREV.child.output' }),
    )
    expect(onAddDependency).toHaveBeenCalledWith('later')
    expect(screen.getByText(/add later as a dependency/i)).toBeVisible()
  })

  it('disables Insert unless the remembered target accepts the exact suggestion namespace', () => {
    render(LoopGroupScopeBar, {
      groupId: 'repeat',
      suggestions: [
        { namespace: 'outer', producerId: 'outer', token: '$outer.output', available: true, canAddDependency: false },
        {
          namespace: 'previous',
          producerId: 'child',
          token: '$LOOP_PREV.child.output',
          available: true,
          canAddDependency: false,
        },
      ],
      canInsert: (suggestion) => suggestion.namespace === 'outer',
    })
    expect(screen.getByRole('button', { name: 'Insert $outer.output' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Insert $LOOP_PREV.child.output' })).toBeDisabled()
  })

  it('keeps a large suggestion set DOM-bounded while every token remains keyboard searchable', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    render(LoopGroupScopeBar, {
      groupId: 'repeat',
      suggestions: Array.from({ length: 250 }, (_, index) => ({
        namespace: 'previous' as const,
        producerId: `child-${String(index).padStart(3, '0')}`,
        token: `$LOOP_PREV.child-${String(index).padStart(3, '0')}.output`,
        available: true,
        canAddDependency: false,
      })),
      onCopy,
    })

    expect(screen.getAllByRole('article')).toHaveLength(12)
    expect(screen.queryByRole('button', { name: 'Copy $LOOP_PREV.child-249.output' })).not.toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'Search scope references' })
    await user.type(search, 'child-249')
    const copyLast = screen.getByRole('button', { name: 'Copy $LOOP_PREV.child-249.output' })
    copyLast.focus()
    await user.keyboard('{Enter}')

    expect(onCopy).toHaveBeenCalledWith('$LOOP_PREV.child-249.output')
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })
})
