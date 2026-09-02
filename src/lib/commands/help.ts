import { displayKeybindings, type KeybindingPlatform } from './keybindings'
import { CANVAS_PAN_INTERACTION } from './canvas-interactions'
import { NODE_CHORD_CHOICES } from './node-chords'
import type { CommandSurface } from './registry'
import type { CommandContext } from './types'

export type ShortcutHelpContext = 'Global' | 'Canvas' | 'YAML editor' | 'Form'

export interface ShortcutHelpRow {
  readonly id: string
  readonly kind: 'command' | 'gesture' | 'chord'
  readonly label: string
  readonly description: string
  readonly category: string
  readonly bindings: readonly string[]
  readonly contexts: readonly ShortcutHelpContext[]
}

const HELP_CONTEXTS: readonly { readonly label: ShortcutHelpContext; readonly surface: CommandContext['surface'] }[] = [
  { label: 'Global', surface: 'global' },
  { label: 'Canvas', surface: 'canvas' },
  { label: 'YAML editor', surface: 'yaml' },
  { label: 'Form', surface: 'form' },
]

const selectionStates: readonly Pick<CommandContext, 'hasSelection' | 'selectionCount'>[] = [
  { hasSelection: false, selectionCount: 0 },
  { hasSelection: true, selectionCount: 1 },
  { hasSelection: true, selectionCount: 2 },
]

const workflowProfiles: readonly Exclude<CommandContext['workflowProfile'], undefined>[] = [
  'hermes-legacy',
  'archon-2026-07',
  null,
]

function contextsFor(enabled: (context: CommandContext) => boolean): readonly ShortcutHelpContext[] {
  return HELP_CONTEXTS.filter(({ surface }) =>
    [false, true].some((canMutate) =>
      selectionStates.some((selection) =>
        [null, 'workspace:workflow.yaml'].some((targetEntryId) =>
          [false, true].some((hasCompanion) =>
            [false, true].some((contractAvailable) =>
              [false, true].some((canValidate) =>
                [false, true].some((setupReady) =>
                  workflowProfiles.some((workflowProfile) =>
                    enabled({
                      surface,
                      canMutate,
                      ...selection,
                      targetEntryId,
                      hasCompanion,
                      contractAvailable,
                      canValidate,
                      setupReady,
                      workflowProfile,
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ).map(({ label }) => label)
}

export const INTERACTION_HELP: readonly ShortcutHelpRow[] = [CANVAS_PAN_INTERACTION]

function nodeChordRows(): readonly ShortcutHelpRow[] {
  return NODE_CHORD_CHOICES.map(({ key, nodeKind, label }) => ({
    id: `node-chord.${nodeKind}`,
    kind: 'chord',
    label: `Add ${label}`,
    description: `Choose a ${label} after pressing N.`,
    category: 'Canvas',
    bindings: [`N ${key}`],
    contexts: ['Canvas'],
  }))
}

export function createShortcutHelp(
  surface: CommandSurface,
  platform: KeybindingPlatform,
): readonly ShortcutHelpRow[] {
  const commandRows = surface
    .listCommands()
    .filter((command) => command.defaultBindings.length > 0)
    .map((command) => ({
      id: command.id,
      kind: 'command' as const,
      label: command.label,
      description: `Run ${command.label}.`,
      category: command.category,
      bindings: displayKeybindings(command.defaultBindings, platform),
      contexts: contextsFor(command.enabled),
    }))

  return [...commandRows, ...INTERACTION_HELP, ...nodeChordRows()]
}

export function searchShortcutHelp(rows: readonly ShortcutHelpRow[], query: string): readonly ShortcutHelpRow[] {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return rows

  return rows.filter((row) => {
    const searchable = [row.label, row.description, row.category, ...row.contexts, ...row.bindings]
      .join(' ')
      .toLocaleLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}
