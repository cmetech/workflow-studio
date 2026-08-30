import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import CommandPalette from './CommandPalette.svelte'
import { createCommandRegistry } from '$src/lib/commands/registry'

describe('CommandPalette', () => {
  it('searches registry commands, describes disabled entries, and executes enabled selection with Enter', async () => {
    const run = vi.fn()
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'canvas.add-node',
      label: 'Add Node',
      category: 'Canvas',
      defaultBindings: ['N'],
      enabled: () => true,
      run,
    })
    registry.registerCommand({
      id: 'canvas.delete',
      label: 'Delete',
      category: 'Canvas',
      defaultBindings: ['Delete'],
      enabled: () => false,
      disabledReason: () => 'Select a node first.',
      run,
    })
    const close = vi.fn()
    render(CommandPalette, {
      props: { registry, context: { surface: 'canvas', canMutate: true, hasSelection: false }, onClose: close },
    })
    const input = screen.getByRole('combobox', { name: 'Search commands' })
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.querySelector('[data-modal-body]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Canvas' })).toBeVisible()
    await fireEvent.input(input, { target: { value: 'delete' } })
    expect(screen.getByText('Select a node first.')).toBeVisible()
    await fireEvent.input(input, { target: { value: 'add' } })
    await tick()
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(run).toHaveBeenCalledOnce())
    expect(close).toHaveBeenCalledOnce()
  })

  it('honors an executed command result that keeps the palette as a persistent search surface', async () => {
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'document.find',
      label: 'Find',
      category: 'Edit',
      defaultBindings: ['Mod+F'],
      enabled: () => true,
      run: () => ({ commandPalette: 'keep-open' }),
    })
    const close = vi.fn()
    render(CommandPalette, {
      props: { registry, context: { surface: 'global', canMutate: false, hasSelection: false }, onClose: close },
    })

    await fireEvent.click(screen.getByRole('option', { name: /find/i }))

    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })
})
