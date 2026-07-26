export type WorkspaceFileKind = 'file' | 'directory'
export type WorkspaceSymlinkState = 'none' | 'safe' | 'unsafe'

/** Path-only metadata returned by the scoped native workspace scan. */
export interface WorkspaceFileEntry {
  readonly relativePath: string
  readonly kind: WorkspaceFileKind
  readonly size: number
  readonly modifiedAt: string
  readonly symlink: WorkspaceSymlinkState
  readonly readOnly: boolean
}

export interface WorkflowPairEntry {
  readonly kind: 'workflow'
  readonly id: string
  readonly name: string
  readonly relativePath: string
  readonly definitionPath: string
  readonly companionPath: string | null
  readonly state: 'paired' | 'legacy'
  readonly readOnly: boolean
}

export interface OrphanCompanionEntry {
  readonly kind: 'orphan-companion'
  readonly id: string
  readonly name: string
  readonly relativePath: string
  readonly companionPath: string
  readonly state: 'orphan'
  readonly readOnly: boolean
}

export type WorkspaceEntry = WorkflowPairEntry | OrphanCompanionEntry

export interface WorkspaceFolderEntry {
  readonly kind: 'folder'
  readonly id: string
  readonly name: string
  readonly relativePath: string
  readonly children: readonly WorkspaceTreeEntry[]
}

export type WorkspaceTreeEntry = WorkspaceFolderEntry | WorkspaceEntry

export function isWorkspaceFolder(entry: WorkspaceTreeEntry): entry is WorkspaceFolderEntry {
  return entry.kind === 'folder'
}
