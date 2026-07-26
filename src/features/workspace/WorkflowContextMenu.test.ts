import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import type { AppCommand } from '$src/lib/commands/types'
import WorkflowContextMenu from './WorkflowContextMenu.svelte'

function command(id: string, label: string, enabled = true): AppCommand {
  return { id, label, category: 'Workflow', defaultBindings: [], enabled: () => enabled, run: () => undefined }
}

describe('WorkflowContextMenu', () => {
  it('derives stable accessible actions from registered commands and closes on Escape', async () => {
    const onRun = vi.fn()
    const onClose = vi.fn()
    render(WorkflowContextMenu, {
      commands: [
        command('workflow.rename', 'Rename Pair'),
        command('unrelated', 'Ignore'),
        command('workflow.open', 'Open'),
      ],
      onRun,
      onClose,
    })
    const menu = screen.getByRole('menu', { name: 'Workflow actions' })
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open', 'Rename Pair'])
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Pair' }))
    expect(onRun).toHaveBeenCalledWith('workflow.rename')
    await fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focuses the first enabled item, skips disabled items, and restores the opener on Escape', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    render(WorkflowContextMenu, {
      commands: [
        command('workflow.open', 'Open', false),
        command('workflow.duplicate', 'Duplicate Pair'),
        command('workflow.rename', 'Rename Pair'),
      ],
      opener,
    })
    await tick()
    expect(screen.getByRole('menuitem', { name: 'Duplicate Pair' })).toHaveFocus()
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Rename Pair' })).toHaveFocus()
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('restores the retained opener after a successful context action', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onRun = vi.fn(async () => undefined)
    render(WorkflowContextMenu, {
      commands: [command('workflow.duplicate', 'Duplicate Pair')],
      opener,
      onRun,
    })
    await tick()

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Pair' }))
    expect(onRun).toHaveBeenCalledWith('workflow.duplicate')
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('restores the retained opener when the parent unmounts the menu', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(WorkflowContextMenu, {
      commands: [command('workflow.open', 'Open')],
      opener,
    })
    await tick()
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()

    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
