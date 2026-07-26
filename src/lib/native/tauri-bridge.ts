import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { WorkspaceFileEntry } from '../workspace/types'
import {
  NativeError,
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
    return new NativeError(error.code, error.message)
  }
  return new NativeError('native_command_failed', 'The native workspace command failed.')
}

export const tauriBridge: WorkspaceNativeBridge = {
  hostHealth: () => invokeTyped<HostInfo>('host_health'),
  workspaceSetRoot: (rootPath) => invokeTyped<WorkspaceRootInfo>('workspace_set_root', { rootPath }),
  workspaceScan: () => invokeTyped<readonly WorkspaceFileEntry[]>('workspace_scan'),
  workspaceRead: (relativePath) => invokeTyped<WorkspaceReadResult>('workspace_read', { relativePath }),
  workspaceWrite: (request) => invokeTyped<WorkspaceWriteResult>('workspace_write', { ...request }),
  workspaceRenamePair: (request) => invokeTyped<WorkspaceRenameResult>('workspace_rename_pair', { ...request }),
  workspaceTrashPaths: (relativePaths) =>
    invokeTyped<WorkspaceTrashResult>('workspace_trash_paths', {
      relativePaths: [...relativePaths],
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
}
