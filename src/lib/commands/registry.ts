import {
  openCommandPalette,
  openKeyboardShortcuts,
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
let documentSaveHandler: (() => void | Promise<void>) | null = null
let documentUndoHandler: (() => void | Promise<void>) | null = null
let documentRedoHandler: (() => void | Promise<void>) | null = null
let documentFindHandler: (() => void | Promise<void>) | null = null
let workflowValidateHandler: (() => void | Promise<void>) | null = null

export interface CanvasCommandHandlers {
  readonly addNode: () => void | Promise<void>
  readonly addAfterSelection: () => void | Promise<void>
  readonly selectAll: () => void | Promise<void>
  readonly copySelection: () => void | Promise<void>
  readonly deleteSelection: () => void | Promise<void>
  readonly duplicateSelection: () => void | Promise<void>
  readonly pasteSelection: () => void | Promise<void>
  readonly arrange: () => void | Promise<void>
  readonly zoomIn: () => void | Promise<void>
  readonly zoomOut: () => void | Promise<void>
  readonly actualSize: () => void | Promise<void>
  readonly fitGraph: () => void | Promise<void>
  readonly fitSelection: () => void | Promise<void>
  readonly nudge: (larger: boolean, direction: 'up' | 'down' | 'left' | 'right') => void | Promise<void>
  readonly openInspector: () => void | Promise<void>
  readonly cancel: () => void | Promise<void>
  readonly createEdge: () => void | Promise<void>
}

let canvasCommandHandlers: CanvasCommandHandlers | null = null

export function setDocumentSaveHandler(handler: () => void | Promise<void>): () => void {
  documentSaveHandler = handler
  return () => {
    if (documentSaveHandler === handler) documentSaveHandler = null
  }
}

export function setDocumentHistoryHandlers(handlers: {
  readonly undo: () => void | Promise<void>
  readonly redo: () => void | Promise<void>
}): () => void {
  documentUndoHandler = handlers.undo
  documentRedoHandler = handlers.redo
  return () => {
    if (documentUndoHandler === handlers.undo) documentUndoHandler = null
    if (documentRedoHandler === handlers.redo) documentRedoHandler = null
  }
}

export function setDocumentCommandHandlers(handlers: {
  readonly find: () => void | Promise<void>
  readonly validate: () => void | Promise<void>
}): () => void {
  documentFindHandler = handlers.find
  workflowValidateHandler = handlers.validate
  return () => {
    if (documentFindHandler === handlers.find) documentFindHandler = null
    if (workflowValidateHandler === handlers.validate) workflowValidateHandler = null
  }
}

export function setCanvasCommandHandlers(handlers: CanvasCommandHandlers): () => void {
  canvasCommandHandlers = handlers
  return () => {
    if (canvasCommandHandlers === handlers) canvasCommandHandlers = null
  }
}

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
    enabled: (context) =>
      context.surface === 'global' &&
      context.targetEntryId !== null &&
      context.targetEntryId !== undefined &&
      context.hasSelection &&
      (!options.mutating || context.canMutate) &&
      (id !== 'workflow.create-companion' || (context.contractAvailable !== false && context.hasCompanion !== true)) &&
      (id !== 'workflow.remove-companion' || context.hasCompanion !== false),
    run: (context) => requestWorkflowAction(id, context.targetEntryId ?? null),
  }
}

function canvasCommand(
  action: keyof CanvasCommandHandlers,
  label: string,
  options: { readonly selection?: boolean; readonly mutating?: boolean; readonly binding?: string } = {},
): AppCommand {
  return {
    id: `canvas.${action.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    label,
    category: 'Canvas',
    defaultBindings: options.binding ? [options.binding] : [],
    enabled: (context) =>
      context.surface === 'canvas' &&
      (!options.selection || context.hasSelection) &&
      (!options.mutating || context.canMutate),
    run: () => (canvasCommandHandlers?.[action] as (() => void | Promise<void>) | undefined)?.(),
  }
}

const initialCommands: readonly AppCommand[] = [
  canvasCommand('addNode', 'Add Node', { mutating: true, binding: 'N' }),
  canvasCommand('addAfterSelection', 'Add Node After Selection', {
    selection: true,
    mutating: true,
    binding: 'Shift+N',
  }),
  canvasCommand('selectAll', 'Select Canvas Nodes', { binding: 'Mod+A' }),
  canvasCommand('copySelection', 'Copy Selection', { selection: true, binding: 'Mod+C' }),
  {
    ...canvasCommand('deleteSelection', 'Delete Selection', { selection: true, mutating: true, binding: 'Delete' }),
    defaultBindings: ['Delete', 'Backspace'],
  },
  canvasCommand('duplicateSelection', 'Duplicate Selection', { selection: true, mutating: true, binding: 'Mod+D' }),
  canvasCommand('pasteSelection', 'Paste Selection', { mutating: true, binding: 'Mod+V' }),
  canvasCommand('arrange', 'Arrange Graph', { mutating: true }),
  canvasCommand('zoomIn', 'Zoom In', { binding: '+' }),
  canvasCommand('zoomOut', 'Zoom Out', { binding: '-' }),
  canvasCommand('actualSize', 'Actual Size', { binding: '0' }),
  canvasCommand('fitGraph', 'Fit Graph', { binding: 'F' }),
  canvasCommand('fitSelection', 'Fit Selection', { selection: true, binding: 'Shift+F' }),
  canvasCommand('openInspector', 'Open Inspector', { selection: true, binding: 'Enter' }),
  canvasCommand('cancel', 'Cancel or Clear Selection', { binding: 'Escape' }),
  canvasCommand('createEdge', 'Create Edge', { selection: true, mutating: true, binding: 'E' }),
  {
    id: 'canvas.nudge-up',
    label: 'Nudge Up',
    category: 'Canvas',
    defaultBindings: ['ArrowUp'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(false, 'up'),
  },
  {
    id: 'canvas.nudge-down',
    label: 'Nudge Down',
    category: 'Canvas',
    defaultBindings: ['ArrowDown'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(false, 'down'),
  },
  {
    id: 'canvas.nudge-left',
    label: 'Nudge Left',
    category: 'Canvas',
    defaultBindings: ['ArrowLeft'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(false, 'left'),
  },
  {
    id: 'canvas.nudge-right',
    label: 'Nudge Right',
    category: 'Canvas',
    defaultBindings: ['ArrowRight'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(false, 'right'),
  },
  {
    id: 'canvas.nudge-up-large',
    label: 'Nudge Up (Large)',
    category: 'Canvas',
    defaultBindings: ['Shift+ArrowUp'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(true, 'up'),
  },
  {
    id: 'canvas.nudge-down-large',
    label: 'Nudge Down (Large)',
    category: 'Canvas',
    defaultBindings: ['Shift+ArrowDown'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(true, 'down'),
  },
  {
    id: 'canvas.nudge-left-large',
    label: 'Nudge Left (Large)',
    category: 'Canvas',
    defaultBindings: ['Shift+ArrowLeft'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(true, 'left'),
  },
  {
    id: 'canvas.nudge-right-large',
    label: 'Nudge Right (Large)',
    category: 'Canvas',
    defaultBindings: ['Shift+ArrowRight'],
    enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
    run: () => canvasCommandHandlers?.nudge(true, 'right'),
  },
  {
    id: 'document.save',
    label: 'Save Workflow Pair',
    category: 'File',
    defaultBindings: ['Mod+S'],
    enabled: (context) => context.canMutate,
    run: () => documentSaveHandler?.(),
  },
  {
    id: 'document.undo',
    label: 'Undo',
    category: 'Edit',
    defaultBindings: ['Mod+Z'],
    enabled: (context) => context.canMutate,
    run: () => documentUndoHandler?.(),
  },
  {
    id: 'document.redo',
    label: 'Redo',
    category: 'Edit',
    defaultBindings: ['Mod+Shift+Z', 'Ctrl+Y'],
    enabled: (context) => context.canMutate,
    run: () => documentRedoHandler?.(),
  },
  {
    id: 'document.find',
    label: 'Find',
    category: 'Edit',
    defaultBindings: ['Mod+F'],
    enabled: () => true,
    run: () => documentFindHandler?.(),
  },
  {
    id: 'workflow.validate',
    label: 'Validate Workflow',
    category: 'Workflow',
    defaultBindings: [],
    enabled: (context) => context.canMutate,
    run: () => workflowValidateHandler?.(),
  },
  {
    id: 'workbench.keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    category: 'Help',
    defaultBindings: [],
    enabled: () => true,
    run: openKeyboardShortcuts,
  },
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
  activityCommand('documentation', 'Documentation'),
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
export const commandRegistry = applicationCommands
