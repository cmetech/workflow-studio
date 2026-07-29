import type { CommandRegistry } from './registry'
import type { AppCommand, CommandContext } from './types'

export type KeybindingPlatform = 'mac' | 'windows' | 'linux'

export interface KeybindingDispatchOptions {
  readonly registry: CommandRegistry
  readonly context: CommandContext
  readonly platform?: KeybindingPlatform
  readonly target?: EventTarget | null
  readonly escape?: readonly { readonly priority: number; readonly cancel: () => void | Promise<void> }[]
}

export type KeybindingDispatchResult =
  | { readonly status: 'executed'; readonly commandId: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'disabled'; readonly commandId: string; readonly reason: string }
  | { readonly status: 'collision'; readonly commandIds: readonly string[] }
  | { readonly status: 'ignored-editable' | 'unhandled' }

const modifierKeys = new Set(['mod', 'ctrl', 'control', 'meta', 'cmd', 'command', 'alt', 'option', 'shift'])

export function currentKeybindingPlatform(): KeybindingPlatform {
  return /mac/i.test(navigator.platform) ? 'mac' : /win/i.test(navigator.platform) ? 'windows' : 'linux'
}

/** Returns a platform-specific, comparison-safe key sequence. */
export function normalizeKeybinding(
  binding: string,
  platform: KeybindingPlatform = currentKeybindingPlatform(),
): string {
  if (binding.trim() === '+') return '+'
  const parts = binding
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  const modifiers = new Set(parts.filter((part) => modifierKeys.has(part)))
  const key = parts.find((part) => !modifierKeys.has(part))
  const normalized = [
    modifiers.has('mod') ||
    (platform === 'mac'
      ? modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command')
      : modifiers.has('ctrl') || modifiers.has('control'))
      ? platform === 'mac'
        ? 'meta'
        : 'ctrl'
      : undefined,
    modifiers.has('ctrl') || modifiers.has('control') ? 'ctrl' : undefined,
    modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command') ? 'meta' : undefined,
    modifiers.has('alt') || modifiers.has('option') ? 'alt' : undefined,
    modifiers.has('shift') ? 'shift' : undefined,
    key,
  ].filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index)
  return normalized.join('+')
}

export function bindingForKeyboardEvent(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: KeybindingPlatform = currentKeybindingPlatform(),
): string {
  const key = event.key === '=' && event.shiftKey ? '+' : event.key.toLowerCase()
  const modifiers = [
    platform === 'mac' ? event.metaKey && 'meta' : event.ctrlKey && 'ctrl',
    event.ctrlKey && platform === 'mac' && 'ctrl',
    event.metaKey && platform !== 'mac' && 'meta',
    event.altKey && 'alt',
    event.shiftKey && key !== '+' && 'shift',
  ].filter(Boolean)
  return [...modifiers, key].join('+')
}

export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable], .cm-content, .cm-editor'))
}

function matchingCommands(
  registry: CommandRegistry,
  binding: string,
  context: CommandContext,
  platform: KeybindingPlatform,
): AppCommand[] {
  return registry
    .listCommands()
    .filter((command) =>
      command.defaultBindings.some(
        (candidate) =>
          !(platform === 'mac' && normalizeKeybinding(candidate, platform) === 'ctrl+y') &&
          normalizeKeybinding(candidate, platform) === binding,
      ),
    )
    .filter((command) => command.enabled(context))
}

export async function dispatchKeybinding(
  event: KeyboardEvent,
  options: KeybindingDispatchOptions,
): Promise<KeybindingDispatchResult> {
  if (event.defaultPrevented) return { status: 'unhandled' }
  const platform = options.platform ?? currentKeybindingPlatform()
  const editable = isEditableTarget(options.target ?? event.target)
  const binding = bindingForKeyboardEvent(event, platform)
  const nativeEditingBinding = new Set([
    'meta+z',
    'meta+shift+z',
    'ctrl+z',
    'ctrl+shift+z',
    'ctrl+y',
    'meta+f',
    'ctrl+f',
    'meta+c',
    'ctrl+c',
    'meta+v',
    'ctrl+v',
    'meta+a',
    'ctrl+a',
  ])
  if (editable && (nativeEditingBinding.has(binding) || (!event.metaKey && !event.ctrlKey && !event.altKey)))
    return { status: 'ignored-editable' }

  if (event.key === 'Escape') {
    const cancellation = [...(options.escape ?? [])].sort((left, right) => right.priority - left.priority)[0]
    if (cancellation) {
      event.preventDefault()
      await cancellation.cancel()
      return { status: 'cancelled' }
    }
  }

  const matching = matchingCommands(options.registry, binding, options.context, platform)
  if (matching.length > 1) return { status: 'collision', commandIds: matching.map(({ id }) => id).sort() }
  if (matching.length === 1) {
    event.preventDefault()
    await options.registry.executeCommand(matching[0]!.id, options.context)
    return { status: 'executed', commandId: matching[0]!.id }
  }

  const disabled = options.registry
    .listCommands()
    .filter((command) =>
      command.defaultBindings.some(
        (candidate) =>
          !(platform === 'mac' && normalizeKeybinding(candidate, platform) === 'ctrl+y') &&
          normalizeKeybinding(candidate, platform) === binding,
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0]
  if (disabled) return { status: 'disabled', commandId: disabled.id, reason: `${disabled.label} is unavailable.` }
  return { status: 'unhandled' }
}

export function displayKeybinding(binding: string, platform: KeybindingPlatform = currentKeybindingPlatform()): string {
  const normalized = normalizeKeybinding(binding, platform)
  if (platform !== 'mac')
    return normalized
      .replaceAll('meta', 'Ctrl')
      .replaceAll('ctrl', 'Ctrl')
      .replaceAll('shift', 'Shift')
      .replaceAll('alt', 'Alt')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  return normalized
    .replace('meta+', '⌘')
    .replace('ctrl+', '⌃')
    .replace('alt+', '⌥')
    .replace('shift+', '⇧')
    .toUpperCase()
}

export function displayKeybindings(
  bindings: readonly string[],
  platform: KeybindingPlatform = currentKeybindingPlatform(),
): readonly string[] {
  return bindings
    .filter((binding) => !(platform === 'mac' && normalizeKeybinding(binding, platform) === 'ctrl+y'))
    .map((binding) => displayKeybinding(binding, platform))
}
