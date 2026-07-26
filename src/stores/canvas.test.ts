import { afterEach, describe, expect, it } from 'vitest'
import {
  $canvasSelection,
  $canvasWorkflowIdentity,
  activateCanvasWorkflowIdentity,
  clearCanvasState,
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
})
