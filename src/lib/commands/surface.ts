import { displayKeybindings } from './keybindings'
import type { CommandSurface } from './registry'
import type { CommandContext } from './types'

export interface ResolvedCommand {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly enabled: boolean
  readonly disabledReason?: string
  readonly title: string
}

export function resolveCommand(
  surface: CommandSurface,
  id: string,
  context: CommandContext,
): ResolvedCommand | undefined {
  const command = surface.listCommands().find((candidate) => candidate.id === id)
  if (!command) return undefined
  const enabled = command.enabled(context)
  const disabledReason = enabled ? undefined : (command.disabledReason?.(context) ?? `${command.label} is unavailable.`)
  const bindings = displayKeybindings(command.defaultBindings)
  return {
    id: command.id,
    label: command.label,
    category: command.category,
    enabled,
    ...(disabledReason ? { disabledReason } : {}),
    title: disabledReason ?? [command.label, bindings.join(' / ')].filter(Boolean).join(' — '),
  }
}
