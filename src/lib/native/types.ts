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
import type { BrandManifest } from '../branding/types'
import type { ProgressEventHandler, ProgressSnapshot, UnlistenProgress } from '../progress/types'
import type { UpdateEventHandler, UpdateSnapshot, UpdateStatusResponse } from '../updates/types'

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

export interface SetupStatusResponse {
  readonly ready: boolean
  readonly snapshot: ProgressSnapshot | null
}

export interface SetupNativeBridge extends NativeBridge {
  setupStatus(): Promise<SetupStatusResponse>
  setupStart(): Promise<ProgressSnapshot>
  setupCancel(runId: string): Promise<boolean>
  setupOpenLog(runId: string): Promise<void>
  onSetupEvent(handler: ProgressEventHandler): Promise<UnlistenProgress>
}

export interface UpdateNativeBridge {
  updateStatus(): Promise<UpdateStatusResponse>
  updateCheck(startup: boolean): Promise<UpdateSnapshot>
  updateDownloadInstall(runId: string): Promise<UpdateSnapshot>
  updateCancel(runId: string): Promise<boolean>
  updateDefer(runId: string): Promise<UpdateSnapshot>
  updateOpenLog(runId: string): Promise<void>
  updateSetStartupCheck(enabled: boolean): Promise<boolean>
  updateRelaunch(): Promise<void>
  onUpdateEvent(handler: UpdateEventHandler): Promise<UnlistenProgress>
}

export interface BrandSourceSelection {
  readonly grantToken: string
  readonly manifestText: string
  readonly manifestSha256: string
}

export interface BrandSourceAsset {
  readonly path: string
  readonly bytes: readonly number[]
  readonly sha256: string
}

export interface StoredBrandPack {
  readonly manifest: BrandManifest
  readonly assets: readonly { readonly path: string; readonly bytes: readonly number[] }[]
  readonly revision: string
}

export interface BrandPackListResult {
  readonly packs: readonly StoredBrandPack[]
  readonly warnings: readonly string[]
}

export interface BrandActiveLoadResult {
  readonly id: string
  readonly pack: StoredBrandPack | null
  readonly recovered: boolean
  readonly warning: string | null
}

export interface BrandActivationResult {
  readonly id: string
  readonly pack: StoredBrandPack | null
}

export interface BrandRemovalResult {
  readonly activeId: string
  readonly removed: boolean
  readonly warning: string | null
}

export interface BrandImportRequest {
  readonly grantToken: string
  readonly manifest: BrandManifest
  readonly manifestSourceSha256: string
  readonly assets: readonly {
    readonly path: string
    readonly sourceSha256: string
    readonly mediaType: 'image/svg+xml' | 'image/png'
    readonly sanitizedBytes: readonly number[]
  }[]
}

export interface BrandNativeBridge extends NativeBridge {
  brandChooseSource(): Promise<BrandSourceSelection | null>
  brandReadSourceAssets(grantToken: string, paths: readonly string[]): Promise<readonly BrandSourceAsset[]>
  brandRevokeSourceGrant(grantToken: string): Promise<void>
  brandImport(request: BrandImportRequest): Promise<{ readonly id: string; readonly displayName: string }>
  brandActivate(id: string): Promise<BrandActivationResult>
  brandRemove(id: string, revertActive: boolean): Promise<BrandRemovalResult>
  brandLoadActive(): Promise<BrandActiveLoadResult>
  brandListPacks(): Promise<BrandPackListResult>
  brandLoadPack(id: string): Promise<StoredBrandPack>
  setWindowIcon(id: string, expectedRevision: string | null): Promise<{ readonly status: 'applied' | 'unsupported' }>
}

export interface LayoutNativeBridge extends NativeBridge {
  layoutLoad(): Promise<string | null>
  layoutSave(content: string): Promise<void>
}

export interface GitNativeBridge extends NativeBridge {
  gitBeginHistorySession(): Promise<number>
  gitDetect(): Promise<GitRepository | null>
  gitStatus(root: string): Promise<GitStatus>
  gitDiffPair(
    root: string,
    definitionPath: string,
    companionPath: string | null,
    controllerEpoch: number,
    requestGeneration: number,
  ): Promise<GitDiff>
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
  gitRetainVersionAuthorization(
    authorizationToken: string,
    controllerEpoch: number,
    requestGeneration: number,
  ): Promise<void>
  gitRevokeVersionAuthorization(authorizationToken: string): Promise<void>
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
    authorizationToken: string,
  ): Promise<GitVersionResult>
  gitIsTracked(root: string, path: string): Promise<boolean>
  gitMovePath(root: string, source: string, destination: string): Promise<void>
  gitMovePaths(root: string, moves: readonly { readonly source: string; readonly destination: string }[]): Promise<void>
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
  extends
    LayoutNativeBridge,
    ContractNativeBridge,
    GitNativeBridge,
    GitMutationNativeBridge,
    BrandNativeBridge,
    SetupNativeBridge,
    UpdateNativeBridge {
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
