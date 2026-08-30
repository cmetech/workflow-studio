import { atom } from 'nanostores'
import type { ActivityId, EditorMode } from '$src/lib/commands/types'
import type { DocumentKind } from '$src/lib/documents/types'

export type ContextualActivityId = Extract<ActivityId, 'explorer' | 'nodes'>
export type PageActivityId = Exclude<ActivityId, ContextualActivityId>
export type WorkbenchSurface = 'welcome' | 'authoring' | PageActivityId

export const CONTEXTUAL_ACTIVITIES: readonly ContextualActivityId[] = ['explorer', 'nodes']
export const PAGE_ACTIVITIES: readonly PageActivityId[] = ['examples', 'documentation', 'git', 'settings']

export function isPageActivity(activity: ActivityId): activity is PageActivityId {
  return PAGE_ACTIVITIES.includes(activity as PageActivityId)
}

export function resolveWorkbenchSurface(activity: ActivityId, hasWorkspace: boolean): WorkbenchSurface {
  if (isPageActivity(activity)) return activity
  return hasWorkspace ? 'authoring' : 'welcome'
}

export const $activeActivity = atom<ActivityId>('explorer')
export const activeActivity = $activeActivity

export const $workspacePanelOpen = atom(false)
export const workspacePanelOpen = $workspacePanelOpen
export const $inspectorPanelOpen = atom(false)
export const inspectorPanelOpen = $inspectorPanelOpen

export const $activeEditorMode = atom<EditorMode>('visual')
export const activeEditorMode = $activeEditorMode

export const $activeYamlDocument = atom<DocumentKind>('definition')
export const activeYamlDocument = $activeYamlDocument

export const $commandPaletteOpen = atom(false)
export const commandPaletteOpen = $commandPaletteOpen
export const $keyboardShortcutsOpen = atom(false)
export const keyboardShortcutsOpen = $keyboardShortcutsOpen

export type WorkspaceIntentKind = 'open-folder' | 'quick-open' | `workflow.${string}`
export interface WorkspaceIntent {
  readonly kind: WorkspaceIntentKind | null
  readonly revision: number
  readonly targetEntryId: string | null
}

export const $workspaceIntent = atom<WorkspaceIntent>({ kind: null, revision: 0, targetEntryId: null })
export const workspaceIntent = $workspaceIntent

interface AuthoringReturnTarget {
  readonly activity: ContextualActivityId
  readonly panelOpen: boolean
}

let authoringReturnTarget: AuthoringReturnTarget = { activity: 'explorer', panelOpen: false }

export function showActivity(activity: ActivityId): void {
  const current = $activeActivity.get()
  if (isPageActivity(activity)) {
    if (!isPageActivity(current)) {
      authoringReturnTarget = { activity: current, panelOpen: $workspacePanelOpen.get() }
    }
    $activeActivity.set(activity)
    closeTransientPanels()
    return
  }

  $activeActivity.set(activity)
  $workspacePanelOpen.set(true)
  authoringReturnTarget = { activity, panelOpen: true }
}

export function returnToWorkflow(): void {
  $activeActivity.set(authoringReturnTarget.activity)
  $workspacePanelOpen.set(authoringReturnTarget.panelOpen)
  $inspectorPanelOpen.set(false)
}

export function toggleActivityPanel(activity: ActivityId): void {
  if ($activeActivity.get() === activity && $workspacePanelOpen.get()) {
    $workspacePanelOpen.set(false)
    return
  }
  showActivity(activity)
}

export function openInspectorPanel(): void {
  $inspectorPanelOpen.set(true)
}

export function closeTransientPanels(): void {
  $workspacePanelOpen.set(false)
  $inspectorPanelOpen.set(false)
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
  $commandPaletteOpen.set(true)
}

export function closeCommandPalette(): void {
  $commandPaletteOpen.set(false)
}
export function openKeyboardShortcuts(): void {
  $keyboardShortcutsOpen.set(true)
}
export function closeKeyboardShortcuts(): void {
  $keyboardShortcutsOpen.set(false)
}
