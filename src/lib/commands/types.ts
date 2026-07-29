export type ActivityId = 'explorer' | 'nodes' | 'examples' | 'git' | 'documentation' | 'settings'

export type EditorMode = 'visual' | 'split' | 'yaml'

export interface CommandContext {
  surface: 'global' | 'canvas' | 'yaml' | 'form'
  canMutate: boolean
  canValidate?: boolean
  hasSelection: boolean
  targetEntryId?: string | null
  contractAvailable?: boolean
  workflowProfile?: 'hermes-legacy' | 'archon-2026-07' | null
  hasCompanion?: boolean
}

export interface AppCommand {
  id: string
  label: string
  category: string
  defaultBindings: readonly string[]
  enabled(context: CommandContext): boolean
  disabledReason?(context: CommandContext): string | undefined
  run(context: CommandContext): void | Promise<void>
}
