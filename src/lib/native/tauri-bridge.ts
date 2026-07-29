import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { WorkspaceFileEntry } from '../workspace/types'
import type { RecoveryBlob } from '../recovery/types'
import type { ContractCacheLoadResult } from '../contract/contract-cache'
import type { GitDiff, GitHistoryResult, GitPairSnapshot, GitRepository, GitStatus } from '../git/types'
import {
  NativeError,
  type PathOperationResult,
  type HostInfo,
  type WorkspaceNativeBridge,
  type WorkspaceChangedEvent,
  type WorkspaceReadResult,
  type WorkspaceRenameResult,
  type WorkspaceRootInfo,
  type WorkspaceTrashResult,
  type WorkspaceWriteResult,
} from './types'

async function invokeTyped<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload)
  } catch (error: unknown) {
    throw mapNativeError(error)
  }
}

function mapNativeError(error: unknown): NativeError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return new NativeError(error.code, error.message, readPathResults(error))
  }
  return new NativeError('native_command_failed', 'The native workspace command failed.')
}

function readPathResults(error: object): readonly PathOperationResult[] {
  if (!('pathResults' in error) || !Array.isArray(error.pathResults)) return []
  return error.pathResults.filter((value): value is PathOperationResult => {
    return (
      typeof value === 'object' &&
      value !== null &&
      'relativePath' in value &&
      typeof value.relativePath === 'string' &&
      'status' in value &&
      isPathOperationStatus(value.status)
    )
  })
}

function isPathOperationStatus(value: unknown): value is PathOperationResult['status'] {
  return (
    value === 'moved' ||
    value === 'rolledBack' ||
    value === 'trashed' ||
    value === 'written' ||
    value === 'failed' ||
    value === 'partial'
  )
}

export const tauriBridge: WorkspaceNativeBridge = {
  hostHealth: () => invokeTyped<HostInfo>('host_health'),
  chooseContractFile: () => invokeTyped<string | null>('contract_choose_file'),
  chooseHermesExecutable: () => invokeTyped<string | null>('contract_choose_hermes_executable'),
  contractReadFile: async (path) => new Uint8Array(await invokeTyped<number[]>('contract_read_file', { path })),
  contractRunHermesCli: async ({ executablePath, profile }) =>
    new Uint8Array(
      await invokeTyped<number[]>('contract_run_hermes_cli', {
        executablePath,
        profile,
      }),
    ),
  contractCacheLoad: () => invokeTyped<ContractCacheLoadResult>('contract_cache_load'),
  contractCacheWrite: (entries) =>
    invokeTyped<void>('contract_cache_write', { entries: entries.map((entry) => ({ ...entry })) }),
  chooseWorkspaceFolder: () => invokeTyped<string | null>('dialog_choose_workspace'),
  chooseImportDefinition: () => invokeTyped<string | null>('dialog_choose_import_definition'),
  chooseExportDirectory: () => invokeTyped<string | null>('dialog_choose_export_directory'),
  workspaceSetRoot: (rootPath) => invokeTyped<WorkspaceRootInfo>('workspace_set_root', { rootPath }),
  workspaceScan: () => invokeTyped<readonly WorkspaceFileEntry[]>('workspace_scan'),
  workspaceRead: (relativePath) => invokeTyped<WorkspaceReadResult>('workspace_read', { relativePath }),
  workspaceWrite: (request) => invokeTyped<WorkspaceWriteResult>('workspace_write', { ...request }),
  workspaceRenamePair: (request) => invokeTyped<WorkspaceRenameResult>('workspace_rename_pair', { ...request }),
  workspaceTrashPaths: (requests) =>
    invokeTyped<WorkspaceTrashResult>('workspace_trash_paths', {
      requests: requests.map((request) => ({ ...request })),
    }),
  externalReadYaml: (path) => invokeTyped<{ path: string; text: string }>('external_read_yaml', { path }),
  externalExportYamlPair: ({ directoryPath, overwrite, files }) =>
    invokeTyped<{ paths: readonly string[]; results: readonly PathOperationResult[] }>('external_export_yaml_pair', {
      directoryPath,
      overwrite,
      files: files.map((file) => ({ ...file })),
    }),
  revokeExportGrant: (directoryPath) => invokeTyped<void>('external_revoke_export_grant', { directoryPath }),
  recentWorkspacesLoad: () => invokeTyped<string>('recent_workspaces_load'),
  recentWorkspacesSave: (content) => invokeTyped<void>('recent_workspaces_save', { content }),
  pathAvailable: (path) => invokeTyped<boolean>('recent_workspace_available', { path }),
  startupPaths: () =>
    invokeTyped<
      readonly {
        kind: 'directory' | 'yaml'
        path: string
        rootPath?: string
        relativePath?: string
      }[]
    >('startup_paths'),
  recoveryList: () => invokeTyped<readonly RecoveryBlob[]>('recovery_list'),
  recoveryWrite: (request) => invokeTyped<void>('recovery_write', { ...request }),
  recoveryDelete: (id) => invokeTyped<void>('recovery_delete', { id }),
  layoutLoad: () => invokeTyped<string | null>('layout_load'),
  layoutSave: (content) => invokeTyped<void>('layout_save', { content }),
  gitDetect: () => invokeTyped<GitRepository | null>('git_detect'),
  gitBeginHistorySession: () => invokeTyped<number>('git_begin_history_session'),
  gitStatus: (root) => invokeTyped<GitStatus>('git_status', { root }),
  gitDiffPair: (root, definitionPath, companionPath) =>
    invokeTyped<GitDiff>('git_diff_pair', { root, definitionPath, companionPath }),
  gitHistoryPair: (root, definitionPath, companionPath, controllerEpoch, requestGeneration) =>
    invokeTyped<GitHistoryResult>('git_history_pair', {
      root,
      definitionPath,
      companionPath,
      controllerEpoch,
      requestGeneration,
    }),
  gitRetainHistoryAuthorization: (authorizationToken, controllerEpoch, requestGeneration) =>
    invokeTyped<void>('git_retain_history_authorization', {
      authorizationToken,
      controllerEpoch,
      requestGeneration,
    }),
  gitRevokeHistoryAuthorization: (authorizationToken) =>
    invokeTyped<void>('git_revoke_history_authorization', { authorizationToken }),
  gitDisposeHistorySession: (controllerEpoch) => invokeTyped<void>('git_dispose_history_session', { controllerEpoch }),
  gitShowPair: (root, oid, authorizationToken, definitionPath, companionPath) =>
    invokeTyped<GitPairSnapshot>('git_show_pair', {
      root,
      oid,
      authorizationToken,
      definitionPath,
      companionPath,
    }),
  onWorkspaceChanged: async (handler) => {
    try {
      return await listen<WorkspaceChangedEvent>('workspace://changed', ({ payload }) => {
        void handler(payload)
      })
    } catch (error: unknown) {
      throw mapNativeError(error)
    }
  },
  onGitChanged: async (handler) => {
    try {
      return await listen<WorkspaceChangedEvent>('git://changed', ({ payload }) => {
        void handler(payload)
      })
    } catch (error: unknown) {
      throw mapNativeError(error)
    }
  },
}
