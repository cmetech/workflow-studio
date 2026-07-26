import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import type { DeleteImpact } from './canvas-actions'
import DeleteImpactDialog from './DeleteImpactDialog.svelte'

const referencedImpact: DeleteImpact = {
  nodeIds: ['middle'],
  dependencies: [{ nodeId: 'leaf', fieldPath: ['depends_on'], dependencyId: 'middle' }],
  references: [{ nodeId: 'leaf', fieldPath: ['prompt'], value: 'Use $middle.output', referencedId: 'middle' }],
}

describe('DeleteImpactDialog', () => {
  it('lists exact dependency and textual-reference nodes and fields without offering an unsafe delete', () => {
    render(DeleteImpactDialog, { impact: referencedImpact })

    expect(screen.getByRole('dialog', { name: 'Delete selected nodes' })).toHaveTextContent('middle')
    expect(screen.getByText('leaf · depends_on')).toBeVisible()
    expect(screen.getByText('leaf · prompt')).toBeVisible()
    expect(screen.getByText('Use $middle.output')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(/resolve.*reference/i)
    expect(screen.getByRole('button', { name: 'Delete nodes' })).toBeDisabled()
  })

  it('confirms dependency-only deletion and restores focus to the opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onConfirm = vi.fn()
    render(DeleteImpactDialog, {
      impact: { ...referencedImpact, references: [] },
      onConfirm,
      opener,
    })
    await tick()

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await fireEvent.click(screen.getByRole('button', { name: 'Delete nodes' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('traps focus and cancels with Escape', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCancel = vi.fn()
    render(DeleteImpactDialog, {
      impact: { ...referencedImpact, references: [] },
      onCancel,
      opener,
    })
    await tick()
    const dialog = screen.getByRole('dialog', { name: 'Delete selected nodes' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete nodes' })

    confirm.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
