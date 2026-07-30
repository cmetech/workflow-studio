export type ActivityId = 'explorer' | 'nodes' | 'examples' | 'git' | 'documentation' | 'settings'

export type EditorMode = 'visual' | 'split' | 'yaml'

export interface CommandContext {
  surface: 'global' | 'canvas' | 'yaml' | 'form'
  setupReady?: boolean
  canMutate: boolean
  canValidate?: boolean
  hasSelection: boolean
  selectionCount?: number
  targetEntryId?: string | null
  contractAvailable?: boolean
  workflowProfile?: 'hermes-legacy' | 'archon-2026-07' | null
  hasCompanion?: boolean
}

export interface CommandExecutionResult {
  readonly commandPalette: 'close' | 'keep-open'
}

export type CommandHandlerResult = void | CommandExecutionResult

export interface AppCommand {
  id: string
  label: string
  category: string
  defaultBindings: readonly string[]
  enabled(context: CommandContext): boolean
  disabledReason?(context: CommandContext): string | undefined
  run(context: CommandContext): CommandHandlerResult | Promise<CommandHandlerResult>
}
