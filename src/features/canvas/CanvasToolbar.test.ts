import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
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
  command('canvas.zoom-in', 'Zoom In'),
  command('canvas.zoom-out', 'Zoom Out'),
  command('canvas.actual-size', 'Actual Size'),
  command('canvas.fit-graph', 'Fit Graph'),
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
    render(CanvasToolbar, { commands, onExecute })

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

  it.each([
    ['Zoom In', 'canvas.zoom-in'],
    ['Zoom Out', 'canvas.zoom-out'],
    ['Actual Size', 'canvas.actual-size'],
    ['Fit Graph', 'canvas.fit-graph'],
  ])('executes %s from More and restores focus after the action closes it', async (label, id) => {
    const onExecute = vi.fn()
    render(CanvasToolbar, { commands, onExecute })

    const more = screen.getByRole('button', { name: 'More canvas actions' })
    await fireEvent.click(more)
    await fireEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(onExecute).toHaveBeenCalledWith(id)
    expect(screen.queryByRole('menu', { name: 'More canvas actions' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('keeps duplicate, delete, and arrange in More without a minimap toggle', async () => {
    const onExecute = vi.fn()
    render(CanvasToolbar, { commands, onExecute })

    const more = screen.getByRole('button', { name: 'More canvas actions' })
    await fireEvent.click(more)
    expect(screen.getByRole('menuitem', { name: 'Duplicate Selection' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Delete Selection' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeEnabled()
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Selection' }))
    expect(onExecute).toHaveBeenCalledWith('canvas.duplicate-selection')
    expect(more).toHaveFocus()
  })

  it('moves focus into More, skips disabled items during keyboard navigation, and restores focus on Escape', async () => {
    render(CanvasToolbar, { commands, onExecute: vi.fn() })

    const more = screen.getByRole('button', { name: 'More canvas actions' })
    await fireEvent.click(more)
    const duplicate = screen.getByRole('menuitem', { name: 'Duplicate Selection' })
    const arrange = screen.getByRole('menuitem', { name: 'Arrange Graph' })
    const fitGraph = screen.getByRole('menuitem', { name: 'Fit Graph' })
    await waitFor(() => expect(duplicate).toHaveFocus())

    await fireEvent.keyDown(duplicate, { key: 'ArrowDown' })
    expect(arrange).toHaveFocus()
    await fireEvent.keyDown(arrange, { key: 'End' })
    expect(fitGraph).toHaveFocus()
    await fireEvent.keyDown(fitGraph, { key: 'Home' })
    expect(duplicate).toHaveFocus()

    await fireEvent.keyDown(duplicate, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More canvas actions' })).not.toBeInTheDocument())
    expect(more).toHaveFocus()
  })

  it('dismisses More on click-away without stealing focus from the clicked surface', async () => {
    render(CanvasToolbar, { commands, onExecute: vi.fn() })
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Duplicate Selection' })).toHaveFocus())

    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.append(outside)
    outside.focus()
    await fireEvent.pointerDown(outside)

    expect(screen.queryByRole('menu', { name: 'More canvas actions' })).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
    outside.remove()
  })
})
