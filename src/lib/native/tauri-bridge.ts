import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { WorkspaceFileEntry } from '../workspace/types'
import type { RecoveryBlob } from '../recovery/types'
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
  onWorkspaceChanged: async (handler) => {
    try {
      return await listen<WorkspaceChangedEvent>('workspace://changed', ({ payload }) => {
        void handler(payload)
      })
    } catch (error: unknown) {
      throw mapNativeError(error)
    }
  },
}
