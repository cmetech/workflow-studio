import { atom } from 'nanostores'
import type { ActivityId, EditorMode } from '$src/lib/commands/types'

export const $activeActivity = atom<ActivityId>('explorer')
export const activeActivity = $activeActivity

export const $activeEditorMode = atom<EditorMode>('visual')
export const activeEditorMode = $activeEditorMode

export type WorkspaceIntentKind = 'open-folder' | 'quick-open' | `workflow.${string}`
export interface WorkspaceIntent {
  readonly kind: WorkspaceIntentKind | null
  readonly revision: number
}

export const $workspaceIntent = atom<WorkspaceIntent>({ kind: null, revision: 0 })
export const workspaceIntent = $workspaceIntent

export function showActivity(activity: ActivityId): void {
  $activeActivity.set(activity)
}

export function showEditorMode(mode: EditorMode): void {
  $activeEditorMode.set(mode)
}

export function openFolder(): void {
  requestWorkspaceIntent('open-folder')
}

export function openQuickOpen(): void {
  requestWorkspaceIntent('quick-open')
}

export function requestWorkflowAction(id: `workflow.${string}`): void {
  requestWorkspaceIntent(id)
}

function requestWorkspaceIntent(kind: WorkspaceIntentKind): void {
  const current = $workspaceIntent.get()
  $workspaceIntent.set({ kind, revision: current.revision + 1 })
}

export function openCommandPalette(): void {
  // Command-palette presentation belongs to the command feature once it is introduced.
}
