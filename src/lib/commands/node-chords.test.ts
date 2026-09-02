import { describe, expect, it, vi } from 'vitest'
import { NODE_CHORD_CHOICES, NodeChordController, nodeChordForKind } from './node-chords'

describe('NodeChordController', () => {
  it('uses one ordered choice authority for dispatch and palette chord hints', () => {
    expect(NODE_CHORD_CHOICES).toEqual([
      { key: 'C', nodeKind: 'command', label: 'Command node' },
      { key: 'P', nodeKind: 'prompt', label: 'Prompt node' },
      { key: 'B', nodeKind: 'bash', label: 'Bash node' },
      { key: 'S', nodeKind: 'script', label: 'Script node' },
      { key: 'L', nodeKind: 'loop', label: 'Loop node' },
      { key: 'A', nodeKind: 'approval', label: 'Approval node' },
      { key: 'X', nodeKind: 'cancel', label: 'Cancel node' },
    ])
    expect(nodeChordForKind('approval')).toBe('N A')
  })

  it('exposes choices after N and invokes the selected node kind', () => {
    const choose = vi.fn()
    const chords = new NodeChordController({ onChoose: choose })
    expect(chords.handleKey({ key: 'n' })).toMatchObject({
      status: 'pending',
      choices: expect.arrayContaining(['C', 'P', 'B', 'S', 'L', 'A', 'X']),
    })
    expect(chords.handleKey({ key: 'c' })).toMatchObject({ status: 'chosen', nodeKind: 'command' })
    expect(choose).toHaveBeenCalledWith('command', false)
  })

  it('cancels an active chord on unknown input, Escape, blur, or timeout', () => {
    vi.useFakeTimers()
    const chords = new NodeChordController({ timeoutMs: 1500 })
    expect(chords.handleKey({ key: 'N' })).toMatchObject({ status: 'pending', afterSelection: false })
    expect(chords.handleKey({ key: '?' })).toMatchObject({ status: 'cancelled', reason: 'unknown-key' })
    chords.handleKey({ key: 'n' })
    expect(chords.handleKey({ key: 'Escape' })).toMatchObject({ status: 'cancelled', reason: 'escape' })
    chords.handleKey({ key: 'n' })
    expect(chords.cancel('focus-loss')).toMatchObject({ status: 'cancelled', reason: 'focus-loss' })
    chords.handleKey({ key: 'n' })
    vi.advanceTimersByTime(1500)
    expect(chords.state).toMatchObject({ pending: false, lastCancellation: 'timeout' })
    vi.useRealTimers()
  })
})
