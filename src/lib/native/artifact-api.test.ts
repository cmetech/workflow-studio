import { describe, expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
import { createBrowserBridge } from './browser-bridge'
import { tauriBridge } from './tauri-bridge'
import contract from '../../../contracts/workflow-package-v1.json'
import { normalizeNfc } from '../packages/unicode/workflow-marketplace-casefold'
import { encode } from 'fast-png'

describe('scoped artifacts', () => {
  it('preserves UTF-8 BOM bytes across artifact import and text reads', async () => {
    const text = '\ufeff# draft\n'
    const bridge = createBrowserBridge({ chooseArtifactSource: async () => new TextEncoder().encode(text) })
    const grant = (await bridge.chooseImportArtifact())!
    const imported = await bridge.workspaceImportArtifact({
      relativePath: 'draft.md',
      sourceGrantToken: grant.sourceGrantToken,
    })
    expect(imported.size).toBe(new TextEncoder().encode(text).length)
    expect((await bridge.workspaceReadTextArtifact('draft.md')).text).toBe(text)
  })
  it('preserves contract-valid POSIX artifact filenames without Windows normalization', async () => {
    const bridge = createBrowserBridge({ initialFiles: { 'data:report.': 'draft' } })
    expect((await bridge.workspaceReadTextArtifact('data:report.')).text).toBe('draft')
  })
  it('opens a verified PNG but refuses a truncated PNG signature', async () => {
    const onOpenArtifact = vi.fn()
    const bridge = createBrowserBridge({
      initialArtifacts: {
        'real.png': encode({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]), channels: 4 }),
        'truncated.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      },
      onOpenArtifact,
    })
    await bridge.workspaceOpenArtifact('real.png')
    expect(onOpenArtifact).toHaveBeenCalledWith('real.png')
    await expect(bridge.workspaceOpenArtifact('truncated.png')).rejects.toMatchObject({
      code: 'artifact_open_unsupported',
    })
    expect(onOpenArtifact).toHaveBeenCalledTimes(1)
  })
  it('uses pinned Unicode normalization for canonical artifact paths', async () => {
    const decomposed = 'scripts/cafe\u0301.py'
    const canonical = normalizeNfc(decomposed)
    const bridge = createBrowserBridge({ initialFiles: { [canonical]: 'print(1)' } })
    await expect(bridge.workspaceReadArtifact(decomposed)).rejects.toMatchObject({ code: 'workspace_path_invalid' })
    expect((await bridge.workspaceReadTextArtifact(canonical)).text).toBe('print(1)')
  })
  it('saves malformed UTF-8 script drafts with revision checks without widening YAML APIs', async () => {
    const bridge = createBrowserBridge({ initialFiles: { 'scripts/test.py': 'print(1)' } })
    const before = await bridge.workspaceReadTextArtifact('scripts/test.py')
    await expect(bridge.workspaceRead('scripts/test.py')).rejects.toMatchObject({ code: 'unsupported_file_type' })
    await bridge.workspaceWriteTextArtifact({
      relativePath: before.relativePath,
      text: 'def broken(:',
      expectedCurrentHash: before.sha256,
    })
    expect((await bridge.workspaceReadTextArtifact(before.relativePath)).text).toBe('def broken(:')
    await expect(
      bridge.workspaceWriteTextArtifact({
        relativePath: before.relativePath,
        text: 'old',
        expectedCurrentHash: before.sha256,
      }),
    ).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  })

  it('rejects unsafe paths and binary text decoding', async () => {
    const bridge = createBrowserBridge({ initialArtifacts: { 'data.bin': new Uint8Array([255]) } })
    for (const path of ['../secret', '.git/config', 'a/.GIT/config', 'a//b', 'C:/secret', 'a/./b']) {
      await expect(bridge.workspaceReadArtifact(path)).rejects.toMatchObject({ code: 'workspace_path_invalid' })
    }
    await expect(bridge.workspaceReadTextArtifact('data.bin')).rejects.toMatchObject({ code: 'invalid_utf8' })
  })

  it('records reveal but refuses externally opening scripts or disguised scripts', async () => {
    const onRevealArtifact = vi.fn()
    const onOpenArtifact = vi.fn()
    const bridge = createBrowserBridge({
      initialFiles: { 'script.py': 'print(1)', 'fake.png': 'print(1)' },
      onRevealArtifact,
      onOpenArtifact,
    })
    await bridge.workspaceRevealArtifact('script.py')
    expect(onRevealArtifact).toHaveBeenCalledWith('script.py')
    for (const path of ['script.py', 'fake.png'])
      await expect(bridge.workspaceOpenArtifact(path)).rejects.toMatchObject({ code: 'artifact_open_unsupported' })
    expect(onOpenArtifact).not.toHaveBeenCalled()
  })

  it('uses single-use chooser grants and rejects grants after workspace reselection', async () => {
    const bridge = createBrowserBridge({ chooseArtifactSource: async () => new Uint8Array([1, 2, 3]) })
    const selected = (await bridge.chooseImportArtifact())!
    const request = { relativePath: 'resource.bin', sourceGrantToken: selected.sourceGrantToken }
    const result = await bridge.workspaceImportArtifact(request)
    expect(result.size).toBe(3)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(bridge.workspaceImportArtifact(request)).rejects.toMatchObject({
      code: 'artifact_source_grant_invalid',
    })
    const stale = (await bridge.chooseImportArtifact())!
    await bridge.workspaceSetRoot('/another')
    await expect(
      bridge.workspaceReplaceArtifact({
        ...request,
        sourceGrantToken: stale.sourceGrantToken,
        expectedCurrentHash: result.sha256,
      }),
    ).rejects.toMatchObject({ code: 'artifact_source_grant_invalid' })
  })

  it('passes exact typed payloads to native commands', async () => {
    invoke.mockResolvedValue(undefined)
    const write = { relativePath: 'script.py', text: 'broken(', expectedCurrentHash: 'abc' }
    await tauriBridge.workspaceWriteTextArtifact(write)
    expect(invoke).toHaveBeenLastCalledWith('workspace_write_text_artifact', write)
    const replace = { relativePath: 'logo.png', sourceGrantToken: 'opaque', expectedCurrentHash: 'abc' }
    await tauriBridge.workspaceReplaceArtifact(replace)
    expect(invoke).toHaveBeenLastCalledWith('workspace_replace_artifact', replace)
    await tauriBridge.workspaceReadArtifact('logo.png')
    expect(invoke).toHaveBeenLastCalledWith('workspace_read_artifact', { relativePath: 'logo.png' })
    await tauriBridge.chooseImportArtifact()
    expect(invoke).toHaveBeenLastCalledWith('dialog_choose_import_artifact', undefined)
    await tauriBridge.workspaceImportArtifact({ relativePath: 'logo.png', sourceGrantToken: 'opaque' })
    expect(invoke).toHaveBeenLastCalledWith('workspace_import_artifact', {
      relativePath: 'logo.png',
      sourceGrantToken: 'opaque',
    })
    await tauriBridge.workspaceReadTextArtifact('script.py')
    expect(invoke).toHaveBeenLastCalledWith('workspace_read_text_artifact', { relativePath: 'script.py' })
    await tauriBridge.workspaceRevealArtifact('script.py')
    expect(invoke).toHaveBeenLastCalledWith('workspace_reveal_artifact', { relativePath: 'script.py' })
    await tauriBridge.workspaceOpenArtifact('logo.png')
    expect(invoke).toHaveBeenLastCalledWith('workspace_open_artifact', { relativePath: 'logo.png' })
  })

  it('enforces the pinned per-file limit and retains the original on rejection', async () => {
    const bridge = createBrowserBridge({ initialFiles: { 'script.py': 'original' } })
    const before = await bridge.workspaceReadTextArtifact('script.py')
    await expect(
      bridge.workspaceWriteTextArtifact({
        relativePath: 'script.py',
        text: 'x'.repeat(contract.resource_rules.max_file_bytes + 1),
        expectedCurrentHash: before.sha256,
      }),
    ).rejects.toMatchObject({ code: 'file_too_large' })
    expect((await bridge.workspaceReadTextArtifact('script.py')).text).toBe('original')
  })

  it('permits only one of two concurrent writes from the same revision', async () => {
    const bridge = createBrowserBridge({ initialFiles: { 'script.py': 'original' } })
    const before = await bridge.workspaceReadTextArtifact('script.py')
    const results = await Promise.allSettled(
      ['first', 'second'].map((text) =>
        bridge.workspaceWriteTextArtifact({ relativePath: 'script.py', text, expectedCurrentHash: before.sha256 }),
      ),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })
})

it('passes optional package snapshot authority verbatim for binary import and replacement', async () => {
  invoke.mockResolvedValue({})
  const request = { relativePath: 'p/nested/data.bin', sourceGrantToken: 'source', packageSnapshotToken: 'capture' }
  await tauriBridge.workspaceImportArtifact(request)
  expect(invoke).toHaveBeenLastCalledWith('workspace_import_artifact', request)
  const replacement = { ...request, expectedCurrentHash: 'existing' }
  await tauriBridge.workspaceReplaceArtifact(replacement)
  expect(invoke).toHaveBeenLastCalledWith('workspace_replace_artifact', replacement)
})

it.each(['workspaceImportArtifact', 'workspaceReplaceArtifact'] as const)(
  'preserves successful native recovery metadata without decoding away optional fields: %s',
  async (method) => {
    const metadata = {
      relativePath: 'pkg/image.png',
      mediaType: 'image/png',
      size: 12,
      sha256: 'hash',
      modifiedAt: 'now',
      readOnly: false,
      recoveryResults: [
        {
          relativePath: 'pkg/image.png',
          destinationPath: 'C:/Users/me/AppData/Studio/recovery/source-123',
          status: 'recoveryRetained',
          message: 'Verified bytes retained.',
        },
      ],
    }
    invoke.mockResolvedValueOnce(metadata)
    await expect(
      tauriBridge[method]({ relativePath: 'pkg/image.png', sourceGrantToken: 'grant', expectedCurrentHash: 'old' }),
    ).resolves.toBe(metadata)
  },
)
