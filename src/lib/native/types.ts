import type { WorkspaceFileEntry } from '../workspace/types'
import type { RecoveryBlob, RecoveryWriteRequest } from '../recovery/types'
import type { ContractCacheLoadResult, ContractCacheStoredEntry } from '../contract/contract-cache'
import type { WorkflowProfile } from '../contract/types'
import type {
  GitDiff,
  GitHistoryResult,
  GitPairSnapshot,
  GitRepository,
  GitStatus,
  GitVersionResult,
} from '../git/types'

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

export interface WorkspaceTrashRequest {
  readonly relativePath: string
  readonly expectedCurrentHash: string
}

export interface PathOperationResult {
  readonly relativePath: string
  readonly destinationPath?: string
  readonly status: 'moved' | 'rolledBack' | 'trashed' | 'written' | 'failed' | 'partial'
  readonly errorCode?: string
  readonly message?: string
}

export interface WorkspaceChangedEvent {
  readonly paths: readonly string[]
  readonly kind: 'create' | 'modify' | 'remove' | 'rename'
}

export type WorkspaceChangedHandler = (event: WorkspaceChangedEvent) => void | Promise<void>

export type GitChangedHandler = (event: WorkspaceChangedEvent) => void | Promise<void>

export type UnlistenWorkspace = () => void

export interface NativeBridge {
  hostHealth(): Promise<HostInfo>
}

export interface LayoutNativeBridge extends NativeBridge {
  layoutLoad(): Promise<string | null>
  layoutSave(content: string): Promise<void>
}

export interface GitNativeBridge extends NativeBridge {
  gitBeginHistorySession(): Promise<number>
  gitDetect(): Promise<GitRepository | null>
  gitStatus(root: string): Promise<GitStatus>
  gitDiffPair(root: string, definitionPath: string, companionPath: string | null): Promise<GitDiff>
  gitHistoryPair(
    root: string,
    definitionPath: string,
    companionPath: string | null,
    controllerEpoch: number,
    requestGeneration: number,
  ): Promise<GitHistoryResult>
  gitRetainHistoryAuthorization(
    authorizationToken: string,
    controllerEpoch: number,
    requestGeneration: number,
  ): Promise<void>
  gitRevokeHistoryAuthorization(authorizationToken: string): Promise<void>
  gitDisposeHistorySession(controllerEpoch: number): Promise<void>
  gitShowPair(
    root: string,
    oid: string,
    authorizationToken: string,
    definitionPath: string,
    companionPath: string | null,
  ): Promise<GitPairSnapshot>
}

export interface GitMutationNativeBridge extends NativeBridge {
  gitInit(root: string): Promise<GitRepository>
  gitSetLocalIdentity(root: string, userName: string, userEmail: string): Promise<void>
  gitCreatePairVersion(
    root: string,
    definitionPath: string,
    companionPath: string | null,
    message: string,
  ): Promise<GitVersionResult>
  gitIsTracked(root: string, path: string): Promise<boolean>
  gitMovePath(root: string, source: string, destination: string): Promise<void>
}

export interface ContractNativeBridge extends NativeBridge {
  chooseContractFile(): Promise<string | null>
  chooseHermesExecutable(): Promise<string | null>
  contractReadFile(path: string): Promise<Uint8Array>
  contractRunHermesCli(request: {
    readonly executablePath: string
    readonly profile: WorkflowProfile
  }): Promise<Uint8Array>
  contractCacheLoad(): Promise<ContractCacheLoadResult | readonly ContractCacheStoredEntry[]>
  contractCacheWrite(entries: readonly ContractCacheStoredEntry[]): Promise<void>
}

export interface WorkspaceNativeBridge
  extends LayoutNativeBridge, ContractNativeBridge, GitNativeBridge, GitMutationNativeBridge {
  chooseWorkspaceFolder(): Promise<string | null>
  chooseImportDefinition(): Promise<string | null>
  chooseExportDirectory(): Promise<string | null>
  workspaceSetRoot(rootPath: string): Promise<WorkspaceRootInfo>
  workspaceScan(): Promise<readonly WorkspaceFileEntry[]>
  workspaceRead(relativePath: string): Promise<WorkspaceReadResult>
  workspaceWrite(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>
  workspaceRenamePair(request: WorkspaceRenameRequest): Promise<WorkspaceRenameResult>
  workspaceRenamePath(source: string, destination: string): Promise<WorkspaceRenameResult>
  workspaceTrashPaths(requests: readonly WorkspaceTrashRequest[]): Promise<WorkspaceTrashResult>
  externalReadYaml(path: string): Promise<{ readonly path: string; readonly text: string }>
  externalExportYamlPair(request: {
    readonly directoryPath: string
    readonly overwrite: boolean
    readonly files: readonly { readonly fileName: string; readonly text: string }[]
  }): Promise<{ readonly paths: readonly string[]; readonly results: readonly PathOperationResult[] }>
  revokeExportGrant(directoryPath: string): Promise<void>
  recentWorkspacesLoad(): Promise<string>
  recentWorkspacesSave(content: string): Promise<void>
  pathAvailable(path: string): Promise<boolean>
  startupPaths(): Promise<
    readonly {
      readonly kind: 'directory' | 'yaml'
      readonly path: string
      readonly rootPath?: string
      readonly relativePath?: string
    }[]
  >
  recoveryList(): Promise<readonly RecoveryBlob[]>
  recoveryWrite(request: RecoveryWriteRequest): Promise<void>
  recoveryDelete(id: string): Promise<void>
  onWorkspaceChanged(handler: WorkspaceChangedHandler): Promise<UnlistenWorkspace>
  onGitChanged(handler: GitChangedHandler): Promise<UnlistenWorkspace>
}
