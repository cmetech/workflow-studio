import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))

import { createBrowserBridge } from './browser-bridge'
import { setNativeBridgeForTest } from './bridge'
import { tauriBridge } from './tauri-bridge'
import type { PathOperationResult, WorkspaceChangedEvent, WorkspaceNativeBridge } from './types'
import { watchWorkspaceChanges } from './workspace-api'

beforeEach(() => {
  invoke.mockReset()
  listen.mockReset()
  setNativeBridgeForTest(undefined)
})

describe('browser workspace bridge', () => {
  it('provides a deterministic normalized in-memory workspace fixture', async () => {
    const bridge = createBrowserBridge()
    const selected = await bridge.workspaceSetRoot('/browser/workspace')
    const entries = await bridge.workspaceScan()

    expect(selected).toEqual({
      workspaceId: 'browser-workspace',
      rootPath: '/browser/workspace',
    })
    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'examples',
      'examples/hello.hermes.yaml',
      'examples/hello.yaml',
    ])

    const read = await bridge.workspaceRead('examples/hello.yaml')
    expect(read.text).toContain('id: hello')
    expect(read.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('enforces disk hashes and supports exact rename and trash operations', async () => {
    const bridge = createBrowserBridge()
    await bridge.workspaceSetRoot('/browser/workspace')
    const before = await bridge.workspaceRead('examples/hello.yaml')

    await expect(
      bridge.workspaceWrite({
        relativePath: 'examples/hello.yaml',
        text: 'id: stale\n',
        expectedCurrentHash: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'external_revision_conflict' })
    expect((await bridge.workspaceRead('examples/hello.yaml')).text).toBe(before.text)

    const written = await bridge.workspaceWrite({
      relativePath: 'examples/hello.yaml',
      text: 'id: edited\n',
      expectedCurrentHash: before.sha256,
    })
    expect(written.sha256).not.toBe(before.sha256)

    const renamed = await bridge.workspaceRenamePair({
      sourceDefinition: 'examples/hello.yaml',
      destinationDefinition: 'examples/renamed.yaml',
    })
    expect(renamed.results).toEqual([
      expect.objectContaining({
        relativePath: 'examples/hello.yaml',
        destinationPath: 'examples/renamed.yaml',
        status: 'moved',
      }),
      expect.objectContaining({
        relativePath: 'examples/hello.hermes.yaml',
        destinationPath: 'examples/renamed.hermes.yaml',
        status: 'moved',
      }),
    ])
    expect((await bridge.workspaceScan()).map((entry) => entry.relativePath)).toContain('examples/renamed.hermes.yaml')

    const companionBeforeTrash = await bridge.workspaceRead('examples/renamed.hermes.yaml')
    const conflictedTrash = await bridge.workspaceTrashPaths([
      { relativePath: 'examples/renamed.hermes.yaml', expectedCurrentHash: 'stale-hash' },
    ])
    expect(conflictedTrash.results).toEqual([
      expect.objectContaining({
        relativePath: 'examples/renamed.hermes.yaml',
        status: 'failed',
        errorCode: 'external_revision_conflict',
      }),
    ])
    expect(await bridge.workspaceRead('examples/renamed.hermes.yaml')).toEqual(companionBeforeTrash)

    const trashed = await bridge.workspaceTrashPaths([
      {
        relativePath: 'examples/renamed.hermes.yaml',
        expectedCurrentHash: companionBeforeTrash.sha256,
      },
    ])
    expect(trashed.results).toEqual([
      {
        relativePath: 'examples/renamed.hermes.yaml',
        status: 'trashed',
      },
    ])
    expect((await bridge.workspaceScan()).map((entry) => entry.relativePath)).not.toContain(
      'examples/renamed.hermes.yaml',
    )
  })
})

describe('Tauri workspace bridge', () => {
  it('represents a native partial filesystem outcome without collapsing it to failure', () => {
    const result: PathOperationResult = {
      relativePath: 'flow.yaml',
      destinationPath: 'renamed.yaml',
      status: 'partial',
      errorCode: 'workspace_rename_partial',
    }

    expect(result.status).toBe('partial')
  })

  it('uses typed command payloads and maps structured native failures', async () => {
    invoke.mockRejectedValueOnce({
      code: 'external_revision_conflict',
      message: 'The file changed on disk.',
      pathResults: [
        {
          relativePath: 'flow.yaml',
          status: 'failed',
          errorCode: 'external_revision_conflict',
        },
      ],
    })

    await expect(
      tauriBridge.workspaceWrite({
        relativePath: 'flow.yaml',
        text: 'id: flow\n',
        expectedCurrentHash: 'old-hash',
      }),
    ).rejects.toMatchObject({
      name: 'NativeError',
      code: 'external_revision_conflict',
      message: 'The file changed on disk.',
      pathResults: [expect.objectContaining({ relativePath: 'flow.yaml', status: 'failed' })],
    })
    expect(invoke).toHaveBeenCalledWith('workspace_write', {
      relativePath: 'flow.yaml',
      text: 'id: flow\n',
      expectedCurrentHash: 'old-hash',
    })
  })

  it('passes exact expected-hash Trash requests without string encoding', async () => {
    invoke.mockResolvedValueOnce({
      results: [{ relativePath: 'flow.yaml', status: 'trashed' }],
    })

    await tauriBridge.workspaceTrashPaths([{ relativePath: 'flow.yaml', expectedCurrentHash: 'a'.repeat(64) }])

    expect(invoke).toHaveBeenCalledWith('workspace_trash_paths', {
      requests: [{ relativePath: 'flow.yaml', expectedCurrentHash: 'a'.repeat(64) }],
    })
  })

  it('uses opaque typed app-data layout commands without renderer path arguments', async () => {
    invoke.mockResolvedValueOnce('[{"schemaVersion":2}]').mockResolvedValueOnce(undefined)

    await expect(tauriBridge.layoutLoad()).resolves.toBe('[{"schemaVersion":2}]')
    await tauriBridge.layoutSave('[{"schemaVersion":2}]')

    expect(invoke).toHaveBeenNthCalledWith(1, 'layout_load', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'layout_save', { content: '[{"schemaVersion":2}]' })
  })

  it('uses narrow dialog, one-time external YAML, startup, and app-data recent commands', async () => {
    invoke
      .mockResolvedValueOnce('/chosen')
      .mockResolvedValueOnce({ path: '/outside/flow.yaml', text: 'name: flow\n' })
      .mockResolvedValueOnce({ paths: ['/export/flow.yaml'] })
      .mockResolvedValueOnce([
        { kind: 'yaml', path: '/outside/flow.yaml', rootPath: '/outside', relativePath: 'flow.yaml' },
      ])
      .mockResolvedValueOnce('[]')
      .mockResolvedValueOnce(undefined)

    await expect(tauriBridge.chooseWorkspaceFolder()).resolves.toBe('/chosen')
    await tauriBridge.externalReadYaml('/outside/flow.yaml')
    await tauriBridge.externalExportYamlPair({
      directoryPath: '/export',
      overwrite: false,
      files: [{ fileName: 'flow.yaml', text: 'name: flow\n' }],
    })
    await tauriBridge.startupPaths()
    await tauriBridge.recentWorkspacesLoad()
    await tauriBridge.recentWorkspacesSave('[]')

    expect(invoke).toHaveBeenNthCalledWith(1, 'dialog_choose_workspace', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'external_read_yaml', { path: '/outside/flow.yaml' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'external_export_yaml_pair', {
      directoryPath: '/export',
      overwrite: false,
      files: [{ fileName: 'flow.yaml', text: 'name: flow\n' }],
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'startup_paths', undefined)
    expect(invoke).toHaveBeenNthCalledWith(5, 'recent_workspaces_load', undefined)
    expect(invoke).toHaveBeenNthCalledWith(6, 'recent_workspaces_save', { content: '[]' })
  })

  it('never infers behavior by parsing native error strings', async () => {
    invoke.mockRejectedValueOnce('external_revision_conflict: misleading text')

    await expect(tauriBridge.workspaceRead('flow.yaml')).rejects.toMatchObject({
      name: 'NativeError',
      code: 'native_command_failed',
    })
  })

  it('drops native path results with an unknown status', async () => {
    invoke.mockRejectedValueOnce({
      code: 'workspace_rename_partial',
      message: 'A malformed native path result was returned.',
      pathResults: [{ relativePath: 'flow.yaml', status: 'invented' }],
    })

    await expect(tauriBridge.workspaceRead('flow.yaml')).rejects.toMatchObject({
      code: 'workspace_rename_partial',
      pathResults: [],
    })
  })
})

describe('workspace change API', () => {
  it('re-reads changed YAML paths before delivering a watcher notification', async () => {
    let notify: ((event: WorkspaceChangedEvent) => void | Promise<void>) | undefined
    const workspaceRead = vi.fn().mockResolvedValue({
      relativePath: 'flow.yaml',
      text: 'id: disk\n',
      sha256: 'a'.repeat(64),
      size: 9,
      modifiedAt: '0',
      readOnly: false,
    })
    const fake = {
      ...createBrowserBridge(),
      hostHealth: vi.fn(),
      workspaceSetRoot: vi.fn(),
      workspaceScan: vi.fn(),
      workspaceRead,
      workspaceWrite: vi.fn(),
      workspaceRenamePair: vi.fn(),
      workspaceTrashPaths: vi.fn(),
      recoveryList: vi.fn(),
      recoveryWrite: vi.fn(),
      recoveryDelete: vi.fn(),
      layoutLoad: vi.fn(),
      layoutSave: vi.fn(),
      onWorkspaceChanged: vi.fn(async (handler) => {
        notify = handler
        return () => undefined
      }),
    } satisfies WorkspaceNativeBridge
    setNativeBridgeForTest(fake)
    const handler = vi.fn()
    await watchWorkspaceChanges(handler)

    await notify?.({ paths: ['flow.yaml', 'notes.txt'], kind: 'modify' })

    expect(workspaceRead).toHaveBeenCalledTimes(1)
    expect(workspaceRead).toHaveBeenCalledWith('flow.yaml')
    expect(handler).toHaveBeenCalledWith({
      event: { paths: ['flow.yaml', 'notes.txt'], kind: 'modify' },
      files: [expect.objectContaining({ relativePath: 'flow.yaml', text: 'id: disk\n' })],
    })
  })
})
