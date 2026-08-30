import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedCommand } from '$src/lib/commands/surface'
import CanvasToolbar from './CanvasToolbar.svelte'

function command(id: string, label: string, overrides: Partial<ResolvedCommand> = {}): ResolvedCommand {
  return {
    id,
    label,
    category: 'Canvas',
    enabled: true,
    title: `${label} — shortcut`,
    ...overrides,
  }
}

const commands = [
  command('canvas.add-node', 'Add Node'),
  command('canvas.create-edge', 'Create Edge'),
  command('canvas.duplicate-selection', 'Duplicate Selection'),
  command('canvas.delete-selection', 'Delete Selection', {
    enabled: false,
    disabledReason: 'Select a node first.',
    title: 'Select a node first.',
  }),
  command('canvas.arrange', 'Arrange Graph'),
]

describe('CanvasToolbar', () => {
  it('keeps primary canvas commands visible and routes resolved command IDs with their enablement and tooltips', async () => {
    const onExecute = vi.fn()
    render(CanvasToolbar, { commands, minimapVisible: false, onExecute, onToggleMinimap: vi.fn() })

    const add = screen.getByRole('button', { name: 'Add Node' })
    const edge = screen.getByRole('button', { name: 'Create Edge' })
    expect(add).toHaveAttribute('title', 'Add Node — shortcut')
    expect(edge).toHaveAttribute('title', 'Create Edge — shortcut')
    expect(screen.queryByRole('menuitem', { name: 'Duplicate Selection' })).not.toBeInTheDocument()

    await fireEvent.click(add)
    await fireEvent.click(edge)
    expect(onExecute.mock.calls.map(([id]) => id)).toEqual(['canvas.add-node', 'canvas.create-edge'])

    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menu', { name: 'More canvas actions' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Delete Selection' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Delete Selection' })).toHaveAttribute('title', 'Select a node first.')
  })

  it('keeps duplicate, delete, arrange, and minimap in More and restores focus after an action closes it', async () => {
    const onExecute = vi.fn()
    const onToggleMinimap = vi.fn()
    render(CanvasToolbar, { commands, minimapVisible: true, onExecute, onToggleMinimap })

    const more = screen.getByRole('button', { name: 'More canvas actions' })
    await fireEvent.click(more)
    expect(screen.getByRole('menuitemcheckbox', { name: 'Hide minimap' })).toHaveAttribute('aria-checked', 'true')

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Selection' }))
    expect(onExecute).toHaveBeenCalledWith('canvas.duplicate-selection')
    expect(screen.queryByRole('menu', { name: 'More canvas actions' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()

    await fireEvent.click(more)
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hide minimap' }))
    expect(onToggleMinimap).toHaveBeenCalledOnce()
    expect(more).toHaveFocus()
  })
})
