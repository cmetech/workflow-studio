import { describe, expect, it } from 'vitest'
import { commandRegistry } from './registry'
import { createShortcutHelp, searchShortcutHelp } from './help'

describe('shortcut help', () => {
  it('derives command bindings, canvas panning, and node chords from their implementation owners', () => {
    const rows = createShortcutHelp(commandRegistry, 'mac')

    expect(rows.find(({ id }) => id === 'document.save')).toMatchObject({
      kind: 'command',
      label: 'Save Workflow Pair',
      category: 'File',
      bindings: ['⌘S'],
      contexts: ['Global', 'Canvas', 'YAML editor', 'Form'],
    })
    expect(rows.find(({ id }) => id === 'canvas.pan')).toMatchObject({
      kind: 'gesture',
      bindings: ['Space + drag'],
      contexts: ['Canvas'],
    })
    expect(rows.filter(({ kind }) => kind === 'chord').map(({ bindings }) => bindings)).toEqual([
      ['N C'],
      ['N P'],
      ['N B'],
      ['N S'],
      ['N L'],
      ['N A'],
      ['N X'],
    ])
  })

  it('finds the canvas pan gesture by its canvas context and displayed keys', () => {
    const rows = createShortcutHelp(commandRegistry, 'mac')

    expect(searchShortcutHelp(rows, 'canvas space')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'canvas.pan' })]),
    )
  })
})
