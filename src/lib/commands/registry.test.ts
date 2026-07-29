import { describe, expect, it, vi } from 'vitest'
import {
  CommandDisabledError,
  createCommandRegistry,
  executeCommand,
  setCanvasCommandHandlers,
  setDocumentSaveHandler,
  listCommands,
  type CommandRegistry,
} from './registry'
import type { AppCommand, CommandContext } from './types'
import { workspaceIntent } from '$src/stores/shell'

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
    const commands = listCommands()
    expect(commands.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'document.save',
        'document.undo',
        'document.redo',
        'document.find',
        'workspace.quick-open',
        'workbench.command-palette',
        'workbench.keyboard-shortcuts',
        'canvas.add-node',
        'canvas.add-after-selection',
        'canvas.select-all',
        'canvas.create-edge',
        'canvas.zoom-in',
        'canvas.zoom-out',
        'canvas.actual-size',
        'canvas.fit-graph',
        'canvas.fit-selection',
        'canvas.nudge-up',
        'canvas.open-inspector',
        'canvas.cancel',
        'canvas.arrange',
        'workflow.validate',
      ]),
    )
    expect(commands.find(({ id }) => id === 'canvas.add-node')?.defaultBindings).toEqual(['N'])
    expect(commands.find(({ id }) => id === 'canvas.add-after-selection')?.defaultBindings).toEqual(['Shift+N'])
    expect(listCommands().map(({ id }) => id)).toHaveLength(new Set(commands.map(({ id }) => id)).size)
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

  it('canonicalizes modifier order when detecting binding conflicts', () => {
    const registry = registryWith(
      command({ id: 'palette.open', label: 'Command Palette', defaultBindings: ['Mod+Shift+P'] }),
      command({ id: 'palette.secondary', label: 'Other Palette', defaultBindings: ['Shift+Mod+P'] }),
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

  it('ignores duplicate normalized bindings from one command when checking overlapping contexts', () => {
    const registry = registryWith(
      command({
        id: 'workspace.quick-open',
        label: 'Quick Open',
        defaultBindings: ['Mod+P', 'mod+p'],
        enabled: (context) => context.surface === 'global',
      }),
      command({
        id: 'canvas.palette',
        label: 'Canvas Palette',
        defaultBindings: ['mod+p'],
        enabled: (context) => context.surface === 'canvas',
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

  it('routes every workflow action with the exact target identity from command context', async () => {
    const context: CommandContext = {
      surface: 'global',
      canMutate: true,
      hasSelection: true,
      targetEntryId: 'workspace:ops/flow.yaml',
      contractAvailable: true,
    }
    const ids = [
      'workflow.open',
      'workflow.duplicate',
      'workflow.rename',
      'workflow.create-companion',
      'workflow.remove-companion',
      'workflow.export',
      'workflow.trash',
    ] as const

    for (const id of ids) {
      await executeCommand(id, context)
      expect(workspaceIntent.get()).toMatchObject({ kind: id, targetEntryId: 'workspace:ops/flow.yaml' })
    }
  })

  it('keeps workflow pair commands out of canvas contexts so Mod+D has one deterministic owner', async () => {
    const canvasContext: CommandContext = { surface: 'canvas', canMutate: true, hasSelection: true }
    expect(
      listCommands()
        .find(({ id }) => id === 'workflow.duplicate')
        ?.enabled(canvasContext),
    ).toBe(false)
    expect(
      listCommands()
        .find(({ id }) => id === 'canvas.duplicate-selection')
        ?.enabled(canvasContext),
    ).toBe(true)
  })

  it('routes the Mod+S document command to the active lifecycle handler', async () => {
    const save = vi.fn(async () => undefined)
    const unbind = setDocumentSaveHandler(save)
    try {
      const command = listCommands().find(({ id }) => id === 'document.save')
      expect(command?.defaultBindings).toEqual(['Mod+S'])
      await executeCommand('document.save', { ...globalContext, canMutate: true })
      expect(save).toHaveBeenCalledOnce()
    } finally {
      unbind()
    }
  })

  it('routes enabled canvas authoring commands through the active canvas handlers', async () => {
    const handlers = {
      addNode: vi.fn(),
      addAfterSelection: vi.fn(),
      selectAll: vi.fn(),
      copySelection: vi.fn(),
      deleteSelection: vi.fn(),
      duplicateSelection: vi.fn(),
      pasteSelection: vi.fn(),
      arrange: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      actualSize: vi.fn(),
      fitGraph: vi.fn(),
      fitSelection: vi.fn(),
      nudge: vi.fn(),
      openInspector: vi.fn(),
      cancel: vi.fn(),
      createEdge: vi.fn(),
    }
    const unbind = setCanvasCommandHandlers(handlers)
    const context: CommandContext = { surface: 'canvas', canMutate: true, hasSelection: true }
    try {
      for (const [id, handler] of [
        ['canvas.add-node', handlers.addNode],
        ['canvas.copy-selection', handlers.copySelection],
        ['canvas.delete-selection', handlers.deleteSelection],
        ['canvas.duplicate-selection', handlers.duplicateSelection],
        ['canvas.paste-selection', handlers.pasteSelection],
      ] as const) {
        await executeCommand(id, context)
        expect(handler).toHaveBeenCalledOnce()
      }
    } finally {
      unbind()
    }
  })
})
