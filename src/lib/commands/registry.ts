import {
  openCommandPalette,
  openFolder,
  openQuickOpen,
  requestWorkflowAction,
  showActivity,
  showEditorMode,
} from '$src/stores/shell'
import { requestProblemFocus } from '$src/stores/documents'
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

const modifierOrder = new Map([
  ['mod', 0],
  ['ctrl', 1],
  ['control', 1],
  ['meta', 2],
  ['cmd', 2],
  ['command', 2],
  ['alt', 3],
  ['option', 3],
  ['shift', 4],
])

function normalizeBinding(binding: string): string {
  const parts = binding
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  const modifiers = parts
    .filter((part) => modifierOrder.has(part))
    .sort(
      (left, right) =>
        (modifierOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (modifierOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right),
    )
  const keys = parts.filter((part) => !modifierOrder.has(part))
  return [...modifiers, ...keys].join('+')
}

function compareCommands(left: AppCommand, right: AppCommand): number {
  return (
    left.category.localeCompare(right.category) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  )
}

function createBindingConflicts(commands: readonly AppCommand[]): readonly BindingConflictDiagnostic[] {
  const byBinding = new Map<string, Map<string, AppCommand>>()

  for (const command of commands) {
    for (const binding of command.defaultBindings) {
      const normalized = normalizeBinding(binding)

      if (normalized.length === 0) {
        continue
      }

      const registered = byBinding.get(normalized)
      if (registered) {
        registered.set(command.id, command)
      } else {
        byBinding.set(normalized, new Map([[command.id, command]]))
      }
    }
  }

  const conflicts: BindingConflictDiagnostic[] = []

  for (const [binding, commandsById] of byBinding) {
    const registered = [...commandsById.values()]
    const commandIds = [...commandsById.keys()].sort()
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

function workflowCommand(
  id: `workflow.${string}`,
  label: string,
  options: { binding?: string; mutating?: boolean } = {},
): AppCommand {
  return {
    id,
    label,
    category: 'Workflow',
    defaultBindings: options.binding ? [options.binding] : [],
    enabled: (context) => context.hasSelection && (!options.mutating || context.canMutate),
    run: () => requestWorkflowAction(id),
  }
}

const initialCommands: readonly AppCommand[] = [
  {
    id: 'problems.focus',
    label: 'Focus Selected Problem',
    category: 'Navigation',
    defaultBindings: [],
    enabled: (context) => context.hasSelection,
    run: requestProblemFocus,
  },
  {
    id: 'workspace.open-folder',
    label: 'Open Folder',
    category: 'File',
    defaultBindings: ['Mod+O'],
    enabled: () => true,
    run: openFolder,
  },
  {
    id: 'workspace.quick-open',
    label: 'Quick Open',
    category: 'File',
    defaultBindings: ['Mod+P'],
    enabled: () => true,
    run: openQuickOpen,
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
  workflowCommand('workflow.open', 'Open'),
  workflowCommand('workflow.duplicate', 'Duplicate Pair', { binding: 'Mod+D', mutating: true }),
  workflowCommand('workflow.rename', 'Rename Pair', { mutating: true }),
  workflowCommand('workflow.create-companion', 'Create Companion', { mutating: true }),
  workflowCommand('workflow.remove-companion', 'Remove Companion', { mutating: true }),
  workflowCommand('workflow.export', 'Export'),
  workflowCommand('workflow.trash', 'Move Pair to Trash', { mutating: true }),
]

const applicationCommands = createCommandRegistry()

for (const command of initialCommands) {
  applicationCommands.registerCommand(command)
}

export const registerCommand = applicationCommands.registerCommand
export const listCommands = applicationCommands.listCommands
export const listBindingConflicts = applicationCommands.listBindingConflicts
export const executeCommand = applicationCommands.executeCommand
