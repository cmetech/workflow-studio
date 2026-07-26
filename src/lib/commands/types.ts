export type ActivityId = 'explorer' | 'nodes' | 'examples' | 'git' | 'settings'

export type EditorMode = 'visual' | 'split' | 'yaml'

export interface CommandContext {
  surface: 'global' | 'canvas' | 'yaml' | 'form'
  canMutate: boolean
  hasSelection: boolean
}

export interface AppCommand {
  id: string
  label: string
  category: string
  defaultBindings: readonly string[]
  enabled(context: CommandContext): boolean
  run(context: CommandContext): void | Promise<void>
}
