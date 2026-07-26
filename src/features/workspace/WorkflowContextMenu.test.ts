import { fireEvent, render, screen } from '@testing-library/svelte'
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
})
