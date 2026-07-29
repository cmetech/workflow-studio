import { fireEvent, render, screen } from '@testing-library/svelte'
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
    await fireEvent.input(input, { target: { value: 'delete' } })
    expect(screen.getByText('Select a node first.')).toBeVisible()
    await fireEvent.input(input, { target: { value: 'add' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(run).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
