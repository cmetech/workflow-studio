import type { WorkspaceFileEntry } from '../workspace/types'

export interface HostInfo {
  appVersion: string
  os: 'macos' | 'windows' | 'linux' | 'browser'
  arch: string
}

export class NativeError extends Error {
  readonly code: string
  readonly pathResults: readonly PathOperationResult[]

  constructor(code: string, message: string, pathResults: readonly PathOperationResult[] = []) {
    super(message)
    this.name = 'NativeError'
    this.code = code
    this.pathResults = pathResults
  }
}

export interface WorkspaceRootInfo {
  readonly workspaceId: string
  readonly rootPath: string
}

export interface WorkspaceReadResult {
  readonly relativePath: string
  readonly text: string
  readonly sha256: string
  readonly size: number
  readonly modifiedAt: string
  readonly readOnly: boolean
}

export interface WorkspaceWriteRequest {
  readonly relativePath: string
  readonly text: string
  readonly expectedCurrentHash: string | null
}

export interface WorkspaceWriteResult {
  readonly relativePath: string
  readonly sha256: string
  readonly size: number
  readonly modifiedAt: string
}

export interface WorkspaceRenameRequest {
  readonly sourceDefinition: string
  readonly destinationDefinition: string
}

export interface WorkspaceRenameResult {
  readonly paths: readonly string[]
  readonly results: readonly PathOperationResult[]
}

export interface WorkspaceTrashResult {
  readonly results: readonly PathOperationResult[]
}

export interface PathOperationResult {
  readonly relativePath: string
  readonly destinationPath?: string
  readonly status: 'moved' | 'rolledBack' | 'trashed' | 'failed' | 'partial'
  readonly errorCode?: string
  readonly message?: string
}

export interface WorkspaceChangedEvent {
  readonly paths: readonly string[]
  readonly kind: 'create' | 'modify' | 'remove' | 'rename'
}

export type WorkspaceChangedHandler = (event: WorkspaceChangedEvent) => void | Promise<void>

export type UnlistenWorkspace = () => void

export interface NativeBridge {
  hostHealth(): Promise<HostInfo>
}

export interface WorkspaceNativeBridge extends NativeBridge {
  workspaceSetRoot(rootPath: string): Promise<WorkspaceRootInfo>
  workspaceScan(): Promise<readonly WorkspaceFileEntry[]>
  workspaceRead(relativePath: string): Promise<WorkspaceReadResult>
  workspaceWrite(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>
  workspaceRenamePair(request: WorkspaceRenameRequest): Promise<WorkspaceRenameResult>
  workspaceTrashPaths(relativePaths: readonly string[]): Promise<WorkspaceTrashResult>
  onWorkspaceChanged(handler: WorkspaceChangedHandler): Promise<UnlistenWorkspace>
}
