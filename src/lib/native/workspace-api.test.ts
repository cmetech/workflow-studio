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
import type { WorkspaceChangedEvent, WorkspaceNativeBridge } from './types'
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

    await bridge.workspaceRenamePair({
      sourceDefinition: 'examples/hello.yaml',
      destinationDefinition: 'examples/renamed.yaml',
    })
    expect((await bridge.workspaceScan()).map((entry) => entry.relativePath)).toContain('examples/renamed.hermes.yaml')

    await bridge.workspaceTrashPaths(['examples/renamed.hermes.yaml'])
    expect((await bridge.workspaceScan()).map((entry) => entry.relativePath)).not.toContain(
      'examples/renamed.hermes.yaml',
    )
  })
})

describe('Tauri workspace bridge', () => {
  it('uses typed command payloads and maps structured native failures', async () => {
    invoke.mockRejectedValueOnce({
      code: 'external_revision_conflict',
      message: 'The file changed on disk.',
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
    })
    expect(invoke).toHaveBeenCalledWith('workspace_write', {
      relativePath: 'flow.yaml',
      text: 'id: flow\n',
      expectedCurrentHash: 'old-hash',
    })
  })

  it('never infers behavior by parsing native error strings', async () => {
    invoke.mockRejectedValueOnce('external_revision_conflict: misleading text')

    await expect(tauriBridge.workspaceRead('flow.yaml')).rejects.toMatchObject({
      name: 'NativeError',
      code: 'native_command_failed',
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
      hostHealth: vi.fn(),
      workspaceSetRoot: vi.fn(),
      workspaceScan: vi.fn(),
      workspaceRead,
      workspaceWrite: vi.fn(),
      workspaceRenamePair: vi.fn(),
      workspaceTrashPaths: vi.fn(),
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
