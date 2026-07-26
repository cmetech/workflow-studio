import { atom } from 'nanostores'
import type { ActivityId, EditorMode } from '$src/lib/commands/types'

export const $activeActivity = atom<ActivityId>('explorer')
export const activeActivity = $activeActivity

export const $activeEditorMode = atom<EditorMode>('visual')
export const activeEditorMode = $activeEditorMode

export function showActivity(activity: ActivityId): void {
  $activeActivity.set(activity)
}

export function showEditorMode(mode: EditorMode): void {
  $activeEditorMode.set(mode)
}

export function openFolder(): void {
  // Workspace selection belongs to the workspace feature, which will own the native dialog capability.
}

export function openCommandPalette(): void {
  // Command-palette presentation belongs to the command feature once it is introduced.
}
