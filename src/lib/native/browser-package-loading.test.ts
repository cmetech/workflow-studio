import { expect, it, vi } from 'vitest'
const { initialized } = vi.hoisted(() => ({ initialized: vi.fn() }))
vi.mock('./browser-artifacts', async (original) => {
  const actual = await original<typeof import('./browser-artifacts')>()
  return {
    ...actual,
    browserArtifacts: (...args: Parameters<typeof actual.browserArtifacts>) => {
      initialized()
      return actual.browserArtifacts(...args)
    },
  }
})
import { createBrowserBridge } from './browser-bridge'

it('keeps ordinary startup and scans independent of package facilities, then shares one lazy artifact store', async () => {
  initialized.mockClear()
  const bridge = createBrowserBridge({ initialFiles: {}, initialArtifacts: { 'p/a.bin': new Uint8Array([255]) } })
  await bridge.hostHealth()
  expect((await bridge.workspaceScan()).some((entry) => entry.relativePath === 'p/a.bin')).toBe(true)
  expect(initialized).not.toHaveBeenCalled()
  const [metadata, snapshot] = await Promise.all([
    bridge.workspaceReadArtifact('p/a.bin'),
    bridge.workspaceHashPackage('p'),
  ])
  expect(initialized).toHaveBeenCalledTimes(1)
  expect(snapshot.files[0]?.sha256).toBe(metadata.sha256)
  await bridge.workspaceWriteTextArtifact({
    relativePath: 'p/a.bin',
    text: 'now text',
    expectedCurrentHash: metadata.sha256,
  })
  expect((await bridge.workspaceReadTextArtifact('p/a.bin')).text).toBe('now text')
  expect((await bridge.workspaceScan()).find((entry) => entry.relativePath === 'p/a.bin')?.size).toBe(8)
})

it('rejects a package operation whose workspace changed while its facilities were loading', async () => {
  const bridge = createBrowserBridge({ initialFiles: { 'p/a.txt': 'old workspace' } })
  const pending = bridge.workspaceReadArtifact('p/a.txt')
  const rejection = expect(pending).rejects.toMatchObject({ code: 'workspace_root_changed' })
  await bridge.workspaceSetRoot('/another-workspace')
  await rejection
  expect((await bridge.workspaceReadTextArtifact('p/a.txt')).text).toBe('old workspace')
})
