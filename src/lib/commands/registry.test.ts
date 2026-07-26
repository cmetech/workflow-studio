import { describe, expect, it } from 'vitest'
import { CommandDisabledError, createCommandRegistry, listCommands, type CommandRegistry } from './registry'
import type { AppCommand, CommandContext } from './types'

const globalContext: CommandContext = {
  surface: 'global',
  canMutate: false,
  hasSelection: false,
}

function command(overrides: Partial<AppCommand> & Pick<AppCommand, 'id' | 'label'>): AppCommand {
  return {
    id: overrides.id,
    label: overrides.label,
    category: overrides.category ?? 'General',
    defaultBindings: overrides.defaultBindings ?? [],
    enabled: overrides.enabled ?? (() => true),
    run: overrides.run ?? (() => {}),
  }
}

function registryWith(...commands: AppCommand[]): CommandRegistry {
  const registry = createCommandRegistry()

  for (const appCommand of commands) {
    registry.registerCommand(appCommand)
  }

  return registry
}

describe('command registry', () => {
  it('registers the initial shell commands from one table', () => {
    expect(listCommands().map(({ id }) => id)).toEqual([
      'workspace.open-folder',
      'workbench.command-palette',
      'view.activity.examples',
      'view.activity.explorer',
      'view.activity.git',
      'view.activity.nodes',
      'view.activity.settings',
      'view.editor.split',
      'view.editor.visual',
      'view.editor.yaml',
    ])
  })

  it('rejects duplicate command IDs during registration', () => {
    const registry = registryWith(command({ id: 'workspace.open', label: 'Open Folder' }))

    expect(() => registry.registerCommand(command({ id: 'workspace.open', label: 'Open Another Folder' }))).toThrow(
      /duplicate command id/i,
    )
  })

  it('reports a normalized binding conflict when commands can run in the same context', () => {
    const registry = registryWith(
      command({ id: 'palette.open', label: 'Command Palette', defaultBindings: ['Mod + Shift + P'] }),
      command({ id: 'palette.secondary', label: 'Other Palette', defaultBindings: ['mod+shift+p'] }),
    )

    expect(registry.listBindingConflicts()).toEqual([
      expect.objectContaining({
        type: 'binding_conflict',
        binding: 'mod+shift+p',
        commandIds: ['palette.open', 'palette.secondary'],
      }),
    ])
  })

  it('allows a shared binding when the commands never share an enabled context', () => {
    const registry = registryWith(
      command({
        id: 'canvas.copy',
        label: 'Copy Canvas Selection',
        defaultBindings: ['Mod+C'],
        enabled: (context) => context.surface === 'canvas',
      }),
      command({
        id: 'yaml.copy',
        label: 'Copy YAML Selection',
        defaultBindings: ['mod + c'],
        enabled: (context) => context.surface === 'yaml',
      }),
    )

    expect(registry.listBindingConflicts()).toEqual([])
  })

  it('lists commands by category and label in a stable order', () => {
    const registry = registryWith(
      command({ id: 'view.yaml', label: 'YAML', category: 'View' }),
      command({ id: 'file.open', label: 'Open Folder', category: 'File' }),
      command({ id: 'view.visual', label: 'Visual', category: 'View' }),
    )

    expect(registry.listCommands().map(({ id }) => id)).toEqual(['file.open', 'view.visual', 'view.yaml'])
  })

  it('rejects disabled commands without calling their handler', async () => {
    let executions = 0
    const registry = registryWith(
      command({
        id: 'workflow.save',
        label: 'Save Pair',
        enabled: () => false,
        run: () => {
          executions += 1
        },
      }),
    )

    await expect(registry.executeCommand('workflow.save', globalContext)).rejects.toBeInstanceOf(CommandDisabledError)
    expect(executions).toBe(0)
  })

  it('runs an enabled command with its command context', async () => {
    let receivedContext: CommandContext | undefined
    const registry = registryWith(
      command({
        id: 'workspace.open',
        label: 'Open Folder',
        run: (context) => {
          receivedContext = context
        },
      }),
    )

    await registry.executeCommand('workspace.open', globalContext)

    expect(receivedContext).toEqual(globalContext)
  })
})
