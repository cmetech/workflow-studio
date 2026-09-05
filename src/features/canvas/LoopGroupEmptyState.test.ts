import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import LoopGroupEmptyState from './LoopGroupEmptyState.svelte'

describe('LoopGroupEmptyState', () => {
  it('explains the exact repairable draft and offers explicit repair actions without inventing values', async () => {
    const onAddNode = vi.fn()
    const onEditGroupSettings = vi.fn()
    render(LoopGroupEmptyState, { groupId: 'repeat', onAddNode, onEditGroupSettings })

    expect(screen.getByText('loop_group:')).toBeVisible()
    expect(screen.getByText('nodes: []')).toBeVisible()
    expect(screen.getByText(/save and export remain blocked/i)).toBeVisible()
    expect(screen.queryByText(/max_iterations:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/until:/)).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Add First Node' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Group Settings' }))
    expect(onAddNode).toHaveBeenCalledOnce()
    expect(onEditGroupSettings).toHaveBeenCalledOnce()
  })
})
