import type { WorkspaceFileEntry } from '../workspace/types'
import type { ContractCacheStoredEntry } from '../contract/contract-cache'
import {
  NativeError,
  type WorkspaceNativeBridge,
  type WorkspaceChangedEvent,
  type WorkspaceChangedHandler,
  type WorkspaceReadResult,
} from './types'

const FIXED_MODIFIED_AT = '2026-07-25T12:00:00.000Z'
const MAX_YAML_BYTES = 2 * 1024 * 1024
const DEFAULT_FILES = {
  'examples/hello.yaml': 'id: hello\ntasks: {}\n',
  'examples/hello.hermes.yaml': 'profile: default\n',
} as const

interface BrowserFile {
  text: string
  modifiedAt: string
}

export function createBrowserBridge(): WorkspaceNativeBridge {
  const files = new Map<string, BrowserFile>(
    Object.entries(DEFAULT_FILES).map(([path, text]) => [path, { text, modifiedAt: FIXED_MODIFIED_AT }]),
  )
  const handlers = new Set<WorkspaceChangedHandler>()
  const gitHandlers = new Set<WorkspaceChangedHandler>()
  const recovery = new Map<string, { key: string; content: string }>()
  let recoverySequence = 0
  let layoutContent: string | null = null
  let selectedRoot = '/browser/workspace'
  let recentWorkspaces = ''
  let cachedContracts: readonly ContractCacheStoredEntry[] = []
  let gitHistoryEpoch = 0

  async function emit(event: WorkspaceChangedEvent): Promise<void> {
    await Promise.all([...handlers].map((handler) => handler(event)))
  }

  return {
    hostHealth: async () => ({
      appVersion: 'browser',
      os: 'browser',
      arch: 'browser',
    }),
    chooseContractFile: async () => null,
    chooseHermesExecutable: async () => null,
    contractReadFile: async (path) => {
      throw new NativeError('dialog_permission_required', `No one-time browser permission exists for ${path}.`)
    },
    contractRunHermesCli: async () => {
      throw new NativeError(
        'native_command_unavailable',
        'Hermes CLI refresh is available only in the native desktop app.',
      )
    },
    contractCacheLoad: async () => ({
      entries: cachedContracts.map((entry) => ({ ...entry, source: structuredClone(entry.source) })),
      advisories: [],
    }),
    contractCacheWrite: async (entries) => {
      cachedContracts = entries.map((entry) => ({ ...entry, source: structuredClone(entry.source) }))
    },
    chooseWorkspaceFolder: async () => selectedRoot,
    chooseImportDefinition: async () => null,
    chooseExportDirectory: async () => null,
    workspaceSetRoot: async (rootPath) => {
      selectedRoot = rootPath
      return { workspaceId: 'browser-workspace', rootPath: selectedRoot }
    },
    workspaceScan: async () => scanFixture(files),
    workspaceRead: async (relativePath) => readFixture(files, relativePath),
    workspaceWrite: async ({ relativePath, text, expectedCurrentHash }) => {
      validateRelativeYaml(relativePath)
      if (byteLength(text) > MAX_YAML_BYTES) {
        throw new NativeError('file_too_large', 'The YAML file exceeds the supported size limit.')
      }
      const existing = files.get(relativePath)
      const currentHash = existing ? await sha256(existing.text) : null
      if (currentHash !== expectedCurrentHash) {
        throw new NativeError('external_revision_conflict', 'The file changed on disk before it could be saved.')
      }
      files.set(relativePath, { text, modifiedAt: FIXED_MODIFIED_AT })
      await emit({ paths: [relativePath], kind: existing ? 'modify' : 'create' })
      return {
        relativePath,
        sha256: await sha256(text),
        size: byteLength(text),
        modifiedAt: FIXED_MODIFIED_AT,
      }
    },
    workspaceRenamePair: async ({ sourceDefinition, destinationDefinition }) => {
      validateDefinition(sourceDefinition)
      validateDefinition(destinationDefinition)
      const source = files.get(sourceDefinition)
      if (!source) throw new NativeError('path_not_found', 'The workflow definition does not exist.')
      if (files.has(destinationDefinition)) {
        throw new NativeError('destination_exists', 'The rename destination already exists.')
      }
      const sourceCompanion = companionFor(sourceDefinition)
      const destinationCompanion = companionFor(destinationDefinition)
      if (files.has(sourceCompanion) && files.has(destinationCompanion)) {
        throw new NativeError('destination_exists', 'The companion rename destination already exists.')
      }
      files.delete(sourceDefinition)
      files.set(destinationDefinition, source)
      const paths = [destinationDefinition]
      const results = [
        {
          relativePath: sourceDefinition,
          destinationPath: destinationDefinition,
          status: 'moved' as const,
        },
      ]
      const companion = files.get(sourceCompanion)
      if (companion) {
        files.delete(sourceCompanion)
        files.set(destinationCompanion, companion)
        paths.push(destinationCompanion)
        results.push({
          relativePath: sourceCompanion,
          destinationPath: destinationCompanion,
          status: 'moved',
        })
      }
      await emit({
        paths: [sourceDefinition, destinationDefinition, sourceCompanion, destinationCompanion],
        kind: 'rename',
      })
      return { paths, results }
    },
    workspaceRenamePath: async () => {
      throw new NativeError('native_unavailable', 'Exact filesystem rename requires the desktop application.')
    },
    workspaceTrashPaths: async (requests) => {
      if (requests.length < 1 || requests.length > 2) {
        throw new NativeError('invalid_trash_request', 'Move to Trash accepts one or two exact workspace file paths.')
      }
      if (new Set(requests.map(({ relativePath }) => relativePath)).size !== requests.length) {
        throw new NativeError('invalid_trash_request', 'Move to Trash paths must be unique.')
      }
      const results = []
      const trashedPaths: string[] = []
      for (const { relativePath, expectedCurrentHash } of requests) {
        validateRelativeYaml(relativePath)
        const existing = files.get(relativePath)
        if (!existing) {
          results.push({
            relativePath,
            status: 'failed' as const,
            errorCode: 'path_not_found',
            message: 'The workspace file does not exist.',
          })
          continue
        }
        if ((await sha256(existing.text)) !== expectedCurrentHash) {
          results.push({
            relativePath,
            status: 'failed' as const,
            errorCode: 'external_revision_conflict',
            message: 'The file changed on disk before it could be moved to Trash.',
          })
          continue
        }
        files.delete(relativePath)
        trashedPaths.push(relativePath)
        results.push({ relativePath, status: 'trashed' as const })
      }
      if (trashedPaths.length > 0) await emit({ paths: trashedPaths, kind: 'remove' })
      return { results }
    },
    externalReadYaml: async (path) => {
      throw new NativeError('dialog_permission_required', `No one-time browser permission exists for ${path}.`)
    },
    externalExportYamlPair: async () => {
      throw new NativeError('dialog_permission_required', 'Select an export folder in the native desktop app.')
    },
    revokeExportGrant: async () => undefined,
    recentWorkspacesLoad: async () => recentWorkspaces,
    recentWorkspacesSave: async (content) => {
      recentWorkspaces = content
    },
    pathAvailable: async (path) => path === selectedRoot,
    startupPaths: async () => [],
    recoveryList: async () =>
      [...recovery].map(([id, record]) => ({
        id,
        key: record.key,
        content: record.content,
        size: 8 + byteLength(record.key) + byteLength(record.content),
      })),
    recoveryWrite: async ({ key, content }) => {
      recoverySequence += 1
      recovery.set(`browser-${recoverySequence.toString(16)}.wsr`, { key, content })
    },
    recoveryDelete: async (id) => {
      recovery.delete(id)
    },
    layoutLoad: async () => layoutContent,
    layoutSave: async (content) => {
      layoutContent = content
    },
    gitDetect: async () => null,
    gitBeginHistorySession: async () => {
      gitHistoryEpoch += 1
      return gitHistoryEpoch
    },
    gitStatus: async () => {
      throw new NativeError('git_not_repository', 'This browser workspace is not a local Git repository.')
    },
    gitDiffPair: async () => {
      throw new NativeError('git_not_repository', 'This browser workspace is not a local Git repository.')
    },
    gitHistoryPair: async () => {
      throw new NativeError('git_not_repository', 'This browser workspace is not a local Git repository.')
    },
    gitRetainHistoryAuthorization: async () => {
      throw new NativeError('git_not_repository', 'This browser workspace is not a local Git repository.')
    },
    gitRevokeHistoryAuthorization: async () => undefined,
    gitDisposeHistorySession: async () => undefined,
    gitShowPair: async () => {
      throw new NativeError('git_not_repository', 'This browser workspace is not a local Git repository.')
    },
    gitInit: async () => {
      throw new NativeError('git_unavailable', 'Repository initialization requires the desktop application.')
    },
    gitSetLocalIdentity: async () => {
      throw new NativeError('git_unavailable', 'Repository identity requires the desktop application.')
    },
    gitCreatePairVersion: async () => {
      throw new NativeError('git_unavailable', 'Creating a Git version requires the desktop application.')
    },
    gitIsTracked: async () => false,
    gitMovePath: async () => {
      throw new NativeError('git_unavailable', 'Moving a tracked Git path requires the desktop application.')
    },
    onWorkspaceChanged: async (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    onGitChanged: async (handler) => {
      gitHandlers.add(handler)
      return () => gitHandlers.delete(handler)
    },
  }
}

function scanFixture(files: ReadonlyMap<string, BrowserFile>): readonly WorkspaceFileEntry[] {
  const directories = new Set<string>()
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }
  const entries: WorkspaceFileEntry[] = [...directories].map((relativePath) => ({
    relativePath,
    kind: 'directory',
    size: 0,
    modifiedAt: FIXED_MODIFIED_AT,
    symlink: 'none',
    readOnly: false,
  }))
  for (const [relativePath, file] of files) {
    entries.push({
      relativePath,
      kind: 'file',
      size: byteLength(file.text),
      modifiedAt: file.modifiedAt,
      symlink: 'none',
      readOnly: false,
    })
  }
  return entries.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  )
}

async function readFixture(
  files: ReadonlyMap<string, BrowserFile>,
  relativePath: string,
): Promise<WorkspaceReadResult> {
  validateRelativeYaml(relativePath)
  const file = files.get(relativePath)
  if (!file) throw new NativeError('path_not_found', 'The workspace file does not exist.')
  return {
    relativePath,
    text: file.text,
    sha256: await sha256(file.text),
    size: byteLength(file.text),
    modifiedAt: file.modifiedAt,
    readOnly: false,
  }
}

function validateDefinition(relativePath: string): void {
  validateRelativeYaml(relativePath)
  if (relativePath.endsWith('.hermes.yaml')) {
    throw new NativeError('invalid_definition_path', 'Pair rename requires a definition path.')
  }
}

function validateRelativeYaml(relativePath: string): void {
  const invalid =
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  if (invalid) {
    throw new NativeError('invalid_relative_path', 'A normalized relative path is required.')
  }
  if (!(relativePath.endsWith('.yaml') || relativePath.endsWith('.yml'))) {
    throw new NativeError('unsupported_file_type', 'Only YAML workflow files are supported.')
  }
}

function companionFor(definition: string): string {
  return definition.replace(/\.(?:yaml|yml)$/, '.hermes.yaml')
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

export const browserBridge: WorkspaceNativeBridge = createBrowserBridge()
