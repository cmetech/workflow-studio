import type { LayoutRecordV1 } from './types'

export const DOCKED_WORKBENCH_MIN_WIDTH = 1280
export const SIDE_BY_SIDE_MIN_EDITOR_WIDTH = 721
export const MIN_EDITOR_WIDTH = 720
export const MIN_LEFT_PANEL_WIDTH = 192
export const MIN_RIGHT_PANEL_WIDTH = 240

const ACTIVITY_RAIL_WIDTH = 48
const MAX_LEFT_PANEL_WIDTH = 480
const MAX_RIGHT_PANEL_WIDTH = 560

export interface WorkbenchPresentation {
  readonly panels: 'docked' | 'drawers'
  readonly split: 'side-by-side' | 'tabs'
}

type PanelPreferences = LayoutRecordV1['panels']

export interface OverlayPanelPreferences {
  readonly left: number
  readonly right: number
}

export function resolveWorkbenchPresentation(workbenchWidth: number, editorWidth: number): WorkbenchPresentation {
  return {
    panels: workbenchWidth >= DOCKED_WORKBENCH_MIN_WIDTH ? 'docked' : 'drawers',
    split: editorWidth >= SIDE_BY_SIDE_MIN_EDITOR_WIDTH ? 'side-by-side' : 'tabs',
  }
}

export function clampDockedPanels(panels: PanelPreferences, workbenchWidth: number): PanelPreferences {
  const left = clampPanelWidth(panels.left, MIN_LEFT_PANEL_WIDTH, MAX_LEFT_PANEL_WIDTH)
  const right = clampPanelWidth(panels.right, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH)
  const available = Math.max(
    MIN_LEFT_PANEL_WIDTH + MIN_RIGHT_PANEL_WIDTH,
    workbenchWidth - ACTIVITY_RAIL_WIDTH - MIN_EDITOR_WIDTH,
  )
  const excess = left + right - available

  if (excess <= 0) return { left, right, problems: panels.problems }

  const leftRange = left - MIN_LEFT_PANEL_WIDTH
  const rightRange = right - MIN_RIGHT_PANEL_WIDTH
  const reducible = leftRange + rightRange
  if (reducible <= 0) return { left, right, problems: panels.problems }

  const reductionRatio = Math.min(1, excess / reducible)
  return {
    left: MIN_LEFT_PANEL_WIDTH + leftRange * (1 - reductionRatio),
    right: MIN_RIGHT_PANEL_WIDTH + rightRange * (1 - reductionRatio),
    problems: panels.problems,
  }
}

export function resolveOverlayPanelWidths(
  stored: OverlayPanelPreferences,
  workbenchWidth: number,
): OverlayPanelPreferences {
  const available = Math.max(0, workbenchWidth - 48)
  const left = Number.isFinite(stored.left) ? Math.max(320, stored.left) : 320
  const right = Number.isFinite(stored.right) ? Math.max(320, stored.right) : 320
  return { left: Math.min(left, available), right: Math.min(right, available) }
}

export function clampProblemsHeight(preferred: number, workbenchHeight: number): number {
  const maximum = Math.max(96, Math.min(360, workbenchHeight * 0.4))
  const requested = Number.isFinite(preferred) ? preferred : 180
  return Math.min(maximum, Math.max(96, requested))
}

function clampPanelWidth(width: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(width)) return minimum
  return Math.min(maximum, Math.max(minimum, width))
}
