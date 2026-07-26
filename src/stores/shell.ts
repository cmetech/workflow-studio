import { atom } from 'nanostores'
import type { ActivityId, EditorMode } from '$src/lib/commands/types'
import type { DocumentKind } from '$src/lib/documents/types'

export const $activeActivity = atom<ActivityId>('explorer')
export const activeActivity = $activeActivity

export const $activeEditorMode = atom<EditorMode>('visual')
export const activeEditorMode = $activeEditorMode

export const $activeYamlDocument = atom<DocumentKind>('definition')
export const activeYamlDocument = $activeYamlDocument

export type WorkspaceIntentKind = 'open-folder' | 'quick-open' | `workflow.${string}`
export interface WorkspaceIntent {
  readonly kind: WorkspaceIntentKind | null
  readonly revision: number
  readonly targetEntryId: string | null
}

export const $workspaceIntent = atom<WorkspaceIntent>({ kind: null, revision: 0, targetEntryId: null })
export const workspaceIntent = $workspaceIntent

export function showActivity(activity: ActivityId): void {
  $activeActivity.set(activity)
}

export function showEditorMode(mode: EditorMode): void {
  $activeEditorMode.set(mode)
}

export function showYamlDocument(document: DocumentKind): void {
  $activeYamlDocument.set(document)
}

export function openFolder(): void {
  requestWorkspaceIntent('open-folder', null)
}

export function openQuickOpen(): void {
  requestWorkspaceIntent('quick-open', null)
}

export function requestWorkflowAction(id: `workflow.${string}`, targetEntryId: string | null): void {
  requestWorkspaceIntent(id, targetEntryId)
}

function requestWorkspaceIntent(kind: WorkspaceIntentKind, targetEntryId: string | null): void {
  const current = $workspaceIntent.get()
  $workspaceIntent.set({ kind, revision: current.revision + 1, targetEntryId })
}

export function openCommandPalette(): void {
  // Command-palette presentation belongs to the command feature once it is introduced.
}
