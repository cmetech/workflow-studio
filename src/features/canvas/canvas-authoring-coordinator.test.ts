import { describe, expect, it, vi } from 'vitest'
import type { NodeKindDescriptor } from '$src/lib/contract/types'
import type { CanvasActionContext } from './canvas-actions'
import { createCanvasAuthoringCoordinator } from './canvas-authoring-coordinator'

describe('canvas authoring coordinator', () => {
  it('returns a typed unavailable result without invoking an action when authoring is blocked', async () => {
    const coordinator = createCanvasAuthoringCoordinator({ getContext: () => ({ unavailable: 'Analysis is stale.' }) })

    await expect(coordinator.connect('a', 'b')).resolves.toEqual({
      status: 'rejected',
      code: 'canvas_action_unavailable',
      message: 'Analysis is stale.',
    })
  })

  it('owns the clipboard and routes one accepted context through copy and paste', async () => {
    const context = {
      projection: { nodes: [] },
      contract: { semantic_rules: [] },
      positions: {},
      announce: vi.fn(),
    } as unknown as CanvasActionContext
    const coordinator = createCanvasAuthoringCoordinator({ getContext: () => context })

    expect(coordinator.copy(['missing'])).toMatchObject({ status: 'rejected', code: 'selection_empty' })
    await expect(coordinator.paste()).resolves.toMatchObject({ status: 'rejected', code: 'selection_empty' })
  })

  it('rejects add before action dispatch when the chosen descriptor is no longer available', async () => {
    const coordinator = createCanvasAuthoringCoordinator({
      getContext: () => ({ unavailable: 'Contract unavailable.' }),
    })

    await expect(
      coordinator.add({ id: 'command' } as NodeKindDescriptor, { viewportCenter: { x: 0, y: 0 } }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  })
})
