import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry } from './registry'
import { dispatchKeybinding, normalizeKeybinding } from './keybindings'
import type { CommandContext } from './types'

const canvas: CommandContext = { surface: 'canvas', canMutate: true, hasSelection: true }

function keyboard(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
}

describe('keybindings', () => {
  it('normalizes Mod to the current platform without changing fixed bindings', () => {
    expect(normalizeKeybinding('Mod + Shift + P', 'mac')).toBe('meta+shift+p')
    expect(normalizeKeybinding('Mod + Shift + P', 'windows')).toBe('ctrl+shift+p')
    expect(normalizeKeybinding('Shift + Mod + P', 'linux')).toBe('ctrl+shift+p')
    expect(normalizeKeybinding('+', 'mac')).toBe('+')
  })

  it('dispatches plus from either keyboard representation and supports both delete keys', async () => {
    const run = vi.fn()
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'canvas.zoom',
      label: 'Zoom In',
      category: 'Canvas',
      defaultBindings: ['+'],
      enabled: () => true,
      run,
    })
    registry.registerCommand({
      id: 'canvas.delete',
      label: 'Delete',
      category: 'Canvas',
      defaultBindings: ['Delete', 'Backspace'],
      enabled: () => true,
      run,
    })
    await dispatchKeybinding(keyboard('=', { shiftKey: true }), { registry, context: canvas, platform: 'windows' })
    await dispatchKeybinding(keyboard('Backspace'), { registry, context: canvas, platform: 'windows' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('dispatches one enabled matching command and reports disabled reasons deterministically', async () => {
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
      run,
    })

    const added = await dispatchKeybinding(keyboard('n'), { registry, context: canvas, platform: 'mac' })
    expect(added).toMatchObject({ status: 'executed', commandId: 'canvas.add-node' })
    expect(run).toHaveBeenCalledOnce()

    const disabled = await dispatchKeybinding(keyboard('Delete'), { registry, context: canvas, platform: 'mac' })
    expect(disabled).toMatchObject({ status: 'disabled', commandId: 'canvas.delete', reason: 'Delete is unavailable.' })
  })

  it('leaves single-key canvas actions and native editing shortcuts alone inside editable targets', async () => {
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
      id: 'document.undo',
      label: 'Undo',
      category: 'Edit',
      defaultBindings: ['Mod+Z'],
      enabled: () => true,
      run,
    })
    const input = document.createElement('input')
    const editable = await dispatchKeybinding(keyboard('n'), {
      registry,
      context: canvas,
      target: input,
      platform: 'mac',
    })
    const undo = await dispatchKeybinding(keyboard('z', { metaKey: true }), {
      registry,
      context: canvas,
      target: input,
      platform: 'mac',
    })
    expect(editable.status).toBe('ignored-editable')
    expect(undo.status).toBe('ignored-editable')
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the highest-priority Escape cancellation before registry commands', async () => {
    const cancelled = vi.fn()
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'canvas.cancel',
      label: 'Cancel',
      category: 'Canvas',
      defaultBindings: ['Escape'],
      enabled: () => true,
      run: vi.fn(),
    })
    const result = await dispatchKeybinding(keyboard('Escape'), {
      registry,
      context: canvas,
      platform: 'mac',
      escape: [{ priority: 10, cancel: cancelled }],
    })
    expect(result).toMatchObject({ status: 'cancelled' })
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
