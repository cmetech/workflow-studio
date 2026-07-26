import { openCommandPalette, openFolder, showActivity, showEditorMode } from '$src/stores/shell'
import type { ActivityId, AppCommand, CommandContext, EditorMode } from './types'

export interface BindingConflictDiagnostic {
  type: 'binding_conflict'
  binding: string
  commandIds: readonly string[]
  contexts: readonly CommandContext[]
}

export interface CommandRegistry {
  registerCommand(command: AppCommand): void
  listCommands(): readonly AppCommand[]
  listBindingConflicts(): readonly BindingConflictDiagnostic[]
  executeCommand(id: string, context: CommandContext): Promise<void>
}

export class CommandDisabledError extends Error {
  constructor(id: string) {
    super(`Command is disabled: ${id}`)
    this.name = 'CommandDisabledError'
  }
}

export class CommandNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown command: ${id}`)
    this.name = 'CommandNotFoundError'
  }
}

const commandSurfaces: readonly CommandContext['surface'][] = ['global', 'canvas', 'yaml', 'form']

const commandContexts: readonly CommandContext[] = commandSurfaces.flatMap((surface) =>
  [false, true].flatMap((canMutate) => [false, true].map((hasSelection) => ({ surface, canMutate, hasSelection }))),
)

function normalizeBinding(binding: string): string {
  return binding
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('+')
}

function compareCommands(left: AppCommand, right: AppCommand): number {
  return (
    left.category.localeCompare(right.category) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  )
}

function createBindingConflicts(commands: readonly AppCommand[]): readonly BindingConflictDiagnostic[] {
  const byBinding = new Map<string, AppCommand[]>()

  for (const command of commands) {
    for (const binding of command.defaultBindings) {
      const normalized = normalizeBinding(binding)

      if (normalized.length === 0) {
        continue
      }

      const registered = byBinding.get(normalized)
      if (registered) {
        registered.push(command)
      } else {
        byBinding.set(normalized, [command])
      }
    }
  }

  const conflicts: BindingConflictDiagnostic[] = []

  for (const [binding, registered] of byBinding) {
    const commandIds = [...new Set(registered.map(({ id }) => id))].sort()
    const contexts = commandContexts.filter(
      (context) => registered.filter((command) => command.enabled(context)).length > 1,
    )

    if (commandIds.length > 1 && contexts.length > 0) {
      conflicts.push({ type: 'binding_conflict', binding, commandIds, contexts })
    }
  }

  return conflicts.sort((left, right) => left.binding.localeCompare(right.binding))
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, AppCommand>()

  return {
    registerCommand(command) {
      if (commands.has(command.id)) {
        throw new Error(`Duplicate command ID: ${command.id}`)
      }

      commands.set(command.id, command)
    },
    listCommands() {
      return [...commands.values()].sort(compareCommands)
    },
    listBindingConflicts() {
      return createBindingConflicts([...commands.values()])
    },
    async executeCommand(id, context) {
      const command = commands.get(id)

      if (!command) {
        throw new CommandNotFoundError(id)
      }

      if (!command.enabled(context)) {
        throw new CommandDisabledError(id)
      }

      await command.run(context)
    },
  }
}

function activityCommand(activity: ActivityId, label: string, defaultBindings: readonly string[] = []): AppCommand {
  return {
    id: `view.activity.${activity}`,
    label,
    category: 'View',
    defaultBindings,
    enabled: () => true,
    run: () => showActivity(activity),
  }
}

function editorModeCommand(mode: EditorMode, label: string, binding: string): AppCommand {
  return {
    id: `view.editor.${mode}`,
    label,
    category: 'View',
    defaultBindings: [binding],
    enabled: () => true,
    run: () => showEditorMode(mode),
  }
}

const initialCommands: readonly AppCommand[] = [
  {
    id: 'workspace.open-folder',
    label: 'Open Folder',
    category: 'File',
    defaultBindings: ['Mod+O'],
    enabled: () => true,
    run: openFolder,
  },
  {
    id: 'workbench.command-palette',
    label: 'Command Palette',
    category: 'View',
    defaultBindings: ['Mod+Shift+P', 'F1'],
    enabled: () => true,
    run: openCommandPalette,
  },
  activityCommand('explorer', 'Explorer', ['Mod+B']),
  activityCommand('nodes', 'Nodes'),
  activityCommand('examples', 'Examples'),
  activityCommand('git', 'Git'),
  activityCommand('settings', 'Settings'),
  editorModeCommand('visual', 'Visual', 'Mod+1'),
  editorModeCommand('split', 'Split', 'Mod+2'),
  editorModeCommand('yaml', 'YAML', 'Mod+3'),
]

const applicationCommands = createCommandRegistry()

for (const command of initialCommands) {
  applicationCommands.registerCommand(command)
}

export const registerCommand = applicationCommands.registerCommand
export const listCommands = applicationCommands.listCommands
export const listBindingConflicts = applicationCommands.listBindingConflicts
export const executeCommand = applicationCommands.executeCommand
