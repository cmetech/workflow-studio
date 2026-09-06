import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import LoopGroupScopeBar from './LoopGroupScopeBar.svelte'

describe('LoopGroupScopeBar', () => {
  it('groups reusable output tokens by scope with explicit actions', async () => {
    const onCopy = vi.fn()
    const onInsert = vi.fn()
    const onAddDependency = vi.fn()
    render(LoopGroupScopeBar, {
      groupId: 'repeat',
      suggestions: [
        {
          namespace: 'current',
          producerId: 'draft',
          token: '$draft.output',
          available: true,
          canAddDependency: false,
        },
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
      insertionTargetLabel: 'Review Prompt',
      onCopy,
      onInsert,
      onAddDependency,
    })
    expect(screen.getByRole('region', { name: /references for repeat/i })).toHaveAttribute(
      'data-scroll-owner',
      'scope-references',
    )
    expect(screen.getByText(/reuse another node's output/i)).toBeVisible()
    expect(screen.getByText(/copy works at any time/i)).toBeVisible()
    expect(screen.getByText(/compatible Inspector text field/i)).toBeVisible()
    expect(screen.getByText('Insert target: Review Prompt')).toBeVisible()

    expect(groupFor('Earlier nodes in this iteration')).toHaveTextContent('$draft.output')
    expect(groupFor('Inputs from the main workflow')).toHaveTextContent('$prepare.output')
    expect(groupFor('Outputs from the previous iteration')).toHaveTextContent('$LOOP_PREV.child.output')
    expect(groupFor('More workflow outputs')).toHaveTextContent('$later.output')

    await fireEvent.click(screen.getByRole('button', { name: 'Copy $prepare.output' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Insert $LOOP_PREV.child.output' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Allow this loop to use later' }))
    expect(onCopy).toHaveBeenCalledWith('$prepare.output')
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'previous', token: '$LOOP_PREV.child.output' }),
    )
    expect(onAddDependency).toHaveBeenCalledWith('later')
    expect(screen.getByText(/add later as a dependency/i)).toBeVisible()
  })

  it('explains how to enable Insert when no compatible Inspector field is focused', () => {
    render(LoopGroupScopeBar, {
      groupId: 'repeat',
      suggestions: [],
    })

    expect(
      screen.getByText('Focus a compatible Inspector text field to enable Insert. Copy works at any time.'),
    ).toBeVisible()
  })

  it('explains when no earlier node is available for the focused body field', () => {
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
      ],
    })

    expect(groupFor('Earlier nodes in this iteration')).toHaveTextContent(
      'Earlier nodes become available when the focused body field can use one of its direct dependencies.',
    )
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

function groupFor(heading: string): HTMLElement {
  const element = screen.getByRole('heading', { name: heading })
  const group = element.closest('section')
  if (!group) throw new Error(`Missing reference group for ${heading}`)
  return group
}
