import { describe, expect, it, vi } from 'vitest'
import { commandRegistry, createCommandRegistry } from './registry'
import { dispatchKeybinding, normalizeKeybinding } from './keybindings'
import type { CommandContext } from './types'
import { $keyboardShortcutsOpen, closeKeyboardShortcuts } from '$src/stores/shell'

const canvas: CommandContext = { surface: 'canvas', canMutate: true, hasSelection: true }

function keyboard(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
}

describe('keybindings', () => {
  it.each(['Enter', ' '])(
    'leaves native button activation for %j to the browser with a canvas selection',
    async (key) => {
      const executed: string[] = []
      const registry = createCommandRegistry()
      registry.registerCommand({
        id: 'canvas.inspect',
        label: 'Inspect',
        category: 'Canvas',
        defaultBindings: [key === ' ' ? 'space' : 'Enter'],
        enabled: () => true,
        run: () => {
          executed.push('inspect')
        },
      })
      const button = document.createElement('button')
      button.setAttribute('role', 'menuitem')
      const icon = document.createElement('span')
      button.append(icon)
      const event = keyboard(key)
      expect(await dispatchKeybinding(event, { registry, context: canvas, target: icon, platform: 'windows' })).toEqual(
        { status: 'unhandled' },
      )
      expect(event.defaultPrevented).toBe(false)
      expect(executed).toEqual([])
    },
  )

  it('retains Enter on canvas nodes and modified shortcuts on native buttons', async () => {
    const executed: string[] = []
    const registry = createCommandRegistry()
    for (const [id, binding] of [
      ['canvas.inspect', 'Enter'],
      ['document.save', 'Mod+S'],
    ]) {
      registry.registerCommand({
        id: id!,
        label: id!,
        category: 'Canvas',
        defaultBindings: [binding!],
        enabled: () => true,
        run: () => {
          executed.push(id!)
        },
      })
    }
    const node = document.createElement('div')
    node.setAttribute('role', 'button')
    const enter = keyboard('Enter')
    await dispatchKeybinding(enter, { registry, context: canvas, target: node, platform: 'windows' })
    const save = keyboard('s', { ctrlKey: true })
    await dispatchKeybinding(save, {
      registry,
      context: canvas,
      target: document.createElement('button'),
      platform: 'windows',
    })
    expect(executed).toEqual(['canvas.inspect', 'document.save'])
    expect(enter.defaultPrevented).toBe(true)
    expect(save.defaultPrevented).toBe(true)
  })

  it('normalizes Mod to the current platform without changing fixed bindings', () => {
    expect(normalizeKeybinding('Mod + Shift + P', 'mac')).toBe('meta+shift+p')
    expect(normalizeKeybinding('Mod + Shift + P', 'windows')).toBe('ctrl+shift+p')
    expect(normalizeKeybinding('Shift + Mod + P', 'linux')).toBe('ctrl+shift+p')
    expect(normalizeKeybinding('+', 'mac')).toBe('+')
  })

  it('dispatches the registry-owned Mod+/ shortcut to open keyboard help on each platform', async () => {
    const context: CommandContext = { surface: 'global', canMutate: false, hasSelection: false }
    try {
      const mac = keyboard('/', { metaKey: true })
      expect(await dispatchKeybinding(mac, { registry: commandRegistry, context, platform: 'mac' })).toEqual({
        status: 'executed',
        commandId: 'workbench.keyboard-shortcuts',
      })
      expect(mac.defaultPrevented).toBe(true)
      expect($keyboardShortcutsOpen.get()).toBe(true)

      closeKeyboardShortcuts()
      const windows = keyboard('/', { ctrlKey: true })
      expect(await dispatchKeybinding(windows, { registry: commandRegistry, context, platform: 'windows' })).toEqual({
        status: 'executed',
        commandId: 'workbench.keyboard-shortcuts',
      })
      expect(windows.defaultPrevented).toBe(true)
      expect($keyboardShortcutsOpen.get()).toBe(true)

      closeKeyboardShortcuts()
      const linux = keyboard('/', { ctrlKey: true })
      expect(await dispatchKeybinding(linux, { registry: commandRegistry, context, platform: 'linux' })).toEqual({
        status: 'executed',
        commandId: 'workbench.keyboard-shortcuts',
      })
      expect(linux.defaultPrevented).toBe(true)
      expect($keyboardShortcutsOpen.get()).toBe(true)
    } finally {
      closeKeyboardShortcuts()
    }
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

  it('opens the advertised F1 command palette while CodeMirror owns focus', async () => {
    const run = vi.fn()
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'workbench.command-palette',
      label: 'Command Palette',
      category: 'View',
      defaultBindings: ['F1'],
      enabled: () => true,
      run,
    })
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    content.className = 'cm-content'
    content.contentEditable = 'true'
    editor.append(content)

    const result = await dispatchKeybinding(keyboard('F1'), {
      registry,
      context: { surface: 'yaml', canMutate: true, hasSelection: false },
      target: content,
      platform: 'mac',
    })

    expect(result).toMatchObject({ status: 'executed', commandId: 'workbench.command-palette' })
    expect(run).toHaveBeenCalledOnce()
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
