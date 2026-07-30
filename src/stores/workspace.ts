import { atom } from 'nanostores'
import { buildWorkspaceTree } from '$src/lib/workspace/build-tree'
import { pairWorkflowFiles } from '$src/lib/workspace/pair-workflows'
import type { WorkspaceEntry, WorkspaceFileEntry, WorkspaceTreeEntry } from '$src/lib/workspace/types'

export interface WorkspaceState {
  readonly id: string | null
  readonly rootPath: string | null
  readonly displayName: string | null
  readonly files: readonly WorkspaceFileEntry[]
  readonly entries: readonly WorkspaceEntry[]
  readonly tree: readonly WorkspaceTreeEntry[]
  readonly activeEntryId: string | null
}

const emptyWorkspace: WorkspaceState = Object.freeze({
  id: null,
  rootPath: null,
  displayName: null,
  files: Object.freeze([]),
  entries: Object.freeze([]),
  tree: Object.freeze([]),
  activeEntryId: null,
})

export const $workspace = atom<WorkspaceState>(emptyWorkspace)
export const workspace = $workspace

export function loadWorkspaceEntries(
  id: string,
  displayName: string,
  files: readonly WorkspaceFileEntry[],
  rootPath: string | null = null,
): void {
  const copiedFiles = Object.freeze(files.map((entry) => Object.freeze({ ...entry })))
  const entries = pairWorkflowFiles(id, copiedFiles)
  $workspace.set(
    Object.freeze({
      id,
      rootPath,
      displayName,
      files: copiedFiles,
      entries,
      tree: buildWorkspaceTree(entries),
      activeEntryId: null,
    }),
  )
}

export function selectWorkspaceEntry(entryId: string): void {
  const current = $workspace.get()
  if (!current.entries.some((entry) => entry.id === entryId)) return
  $workspace.set(Object.freeze({ ...current, activeEntryId: entryId }))
}

export function clearWorkspace(): void {
  $workspace.set(emptyWorkspace)
}
