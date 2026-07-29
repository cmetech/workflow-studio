import { afterEach, describe, expect, it } from 'vitest'
import {
  $canvasSelection,
  $canvasPositions,
  $canvasWorkflowIdentity,
  activateCanvasWorkflowIdentity,
  clearCanvasState,
  moveCanvasPositions,
  setCanvasSelection,
} from './canvas'

describe('canvas workflow identity', () => {
  afterEach(() => clearCanvasState())

  it('clears selection before publishing a different successful workflow identity', () => {
    activateCanvasWorkflowIdentity('workflow-a')
    setCanvasSelection(['shared-node'])
    activateCanvasWorkflowIdentity('workflow-a')
    expect($canvasSelection.get()).toEqual(['shared-node'])

    activateCanvasWorkflowIdentity('workflow-b')
    expect($canvasWorkflowIdentity.get()).toBe('workflow-b')
    expect($canvasSelection.get()).toEqual([])
  })

  it('keeps the active identity and selection when a requested transition never publishes', () => {
    activateCanvasWorkflowIdentity('workflow-a')
    setCanvasSelection(['collect'])

    // A failed activation never calls the publication boundary.
    expect($canvasWorkflowIdentity.get()).toBe('workflow-a')
    expect($canvasSelection.get()).toEqual(['collect'])
  })

  it('publishes a multi-node drag payload atomically and rejects invalid entries without losing valid peers', () => {
    const publications: Array<Readonly<Record<string, { x: number; y: number }>>> = []
    const unsubscribe = $canvasPositions.subscribe((positions) => publications.push(positions))
    publications.length = 0

    moveCanvasPositions([
      { id: 'collect', position: { x: 10, y: 20 } },
      { id: '', position: { x: 40, y: 50 } },
      { id: 'review', position: { x: 30, y: 40 } },
    ])

    expect(publications).toHaveLength(1)
    expect($canvasPositions.get()).toEqual({ collect: { x: 10, y: 20 }, review: { x: 30, y: 40 } })
    unsubscribe()
  })
})
