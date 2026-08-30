import { describe, expect, it } from 'vitest'
import {
  MIN_LEFT_PANEL_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  clampProblemsHeight,
  clampDockedPanels,
  resolveOverlayPanelWidths,
  resolveWorkbenchPresentation,
} from './workbench-layout'

describe('workbench layout', () => {
  it('switches panel and Split presentation at the exact available-width boundaries', () => {
    expect(resolveWorkbenchPresentation(1279, 900)).toEqual({ panels: 'drawers', split: 'side-by-side' })
    expect(resolveWorkbenchPresentation(1280, 719)).toEqual({ panels: 'docked', split: 'tabs' })
    expect(resolveWorkbenchPresentation(1440, 720).split).toBe('tabs')
    expect(resolveWorkbenchPresentation(1440, 721).split).toBe('side-by-side')
    expect(resolveWorkbenchPresentation(1440, 840)).toEqual({ panels: 'docked', split: 'side-by-side' })
  })

  it('clamps the stored Problems preference to a useful bounded share of the workbench', () => {
    expect(clampProblemsHeight(5000, 700)).toBeLessThanOrEqual(280)
    expect(clampProblemsHeight(10, 700)).toBeGreaterThanOrEqual(96)
    expect(clampProblemsHeight(Number.NaN, 1000)).toBe(180)
    expect(clampProblemsHeight(5000, 2000)).toBe(360)
  })

  it('clamps stale dock preferences without mutating them or starving the editor', () => {
    const stored = { left: 5000, right: 5000, problems: 180 }

    const panels = clampDockedPanels(stored, 1280)

    expect(panels).not.toBe(stored)
    expect(stored).toEqual({ left: 5000, right: 5000, problems: 180 })
    expect(panels.left).toBeGreaterThanOrEqual(MIN_LEFT_PANEL_WIDTH)
    expect(panels.right).toBeGreaterThanOrEqual(MIN_RIGHT_PANEL_WIDTH)
    expect(48 + panels.left + panels.right + 720).toBeLessThanOrEqual(1280)
    expect(panels.problems).toBe(180)
  })

  it('raises undersized dock preferences to their individual minima', () => {
    expect(clampDockedPanels({ left: 1, right: 2, problems: 144 }, 1440)).toMatchObject({
      left: MIN_LEFT_PANEL_WIDTH,
      right: MIN_RIGHT_PANEL_WIDTH,
      problems: 144,
    })
  })

  it('resolves overlay widths independently while reserving only the activity rail', () => {
    expect(resolveOverlayPanelWidths({ left: 192, right: 240 }, 1024)).toEqual({ left: 320, right: 320 })
    expect(resolveOverlayPanelWidths({ left: 500, right: 500 }, 300)).toEqual({ left: 252, right: 252 })
    expect(resolveOverlayPanelWidths({ left: Number.NaN, right: Number.NaN }, 1280)).toEqual({
      left: 320,
      right: 320,
    })
  })
})
