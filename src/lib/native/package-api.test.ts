import { expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
import { createBrowserBridge } from './browser-bridge'
import { tauriBridge } from './tauri-bridge'

it('creates nested package files only when all expected revisions match', async () => {
  const bridge = createBrowserBridge({ initialFiles: { 'existing.md': 'old' } })
  const request = {
    workspaceId: 'browser-workspace',
    expectedEntries: [
      { relativePath: 'new/deep/one.md', expectedCurrentHash: null },
      { relativePath: 'existing.md', expectedCurrentHash: 'stale' },
    ],
    writes: [
      { relativePath: 'new/deep/one.md', text: 'one', expectedCurrentHash: null },
      { relativePath: 'existing.md', text: 'new', expectedCurrentHash: 'stale' },
    ],
    moves: [],
    trashes: [],
  }
  await expect(bridge.workspaceApplyTransaction(request)).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  await expect(bridge.workspaceReadTextArtifact('new/deep/one.md')).rejects.toMatchObject({ code: 'path_not_found' })
  expect((await bridge.workspaceReadTextArtifact('existing.md')).text).toBe('old')
  const plan = { ...request, expectedEntries: request.expectedEntries.slice(0, 1), writes: request.writes.slice(0, 1) }
  expect((await bridge.workspaceApplyTransaction(plan)).status).toBe('committed')
  expect((await bridge.workspaceReadTextArtifact('new/deep/one.md')).text).toBe('one')
})

it('hashes ignored files and nested digests but excludes only root digest', async () => {
  const bridge = createBrowserBridge({
    initialFiles: {
      'p/workflow-package.json': '{}',
      'p/node_modules/data': 'ignored',
      'p/nested/digests.json': 'nested',
      'p/digests.json': 'generated',
    },
  })
  const snapshot = await bridge.workspaceHashPackage('p')
  expect(snapshot.files.map((file) => file.relativePath)).toEqual([
    'nested/digests.json',
    'node_modules/data',
    'workflow-package.json',
  ])
  expect(snapshot.sourceSnapshotToken).toBeTruthy()
  await bridge.workspaceWriteTextArtifact({
    relativePath: 'p/new.txt',
    text: 'new membership',
    expectedCurrentHash: null,
  })
  await expect(
    bridge.workspaceReplaceGeneratedFiles({
      sourceSnapshotToken: snapshot.sourceSnapshotToken,
      writes: [
        {
          relativePath: 'p/digests.json',
          text: '{}',
          expectedCurrentHash: (await bridge.workspaceReadArtifact('p/digests.json')).sha256,
        },
        { relativePath: '.well-known/hermes-workflows/index.json', text: '{}', expectedCurrentHash: null },
      ],
    }),
  ).rejects.toMatchObject({ code: 'package_source_changed' })
})

it('writes generated outputs together and consumes the snapshot', async () => {
  const bridge = createBrowserBridge({ initialFiles: { 'p/workflow-package.json': '{}' } })
  const captured = await bridge.workspaceHashPackage('p')
  const request = {
    sourceSnapshotToken: captured.sourceSnapshotToken,
    writes: [
      { relativePath: 'p/digests.json', text: '{}', expectedCurrentHash: null },
      { relativePath: '.well-known/hermes-workflows/index.json', text: '{}', expectedCurrentHash: null },
    ],
  }
  expect((await bridge.workspaceReplaceGeneratedFiles(request)).status).toBe('committed')
  await expect(bridge.workspaceReplaceGeneratedFiles(request)).rejects.toMatchObject({
    code: 'package_snapshot_invalid',
  })
})

it('uses exact command payloads', async () => {
  invoke.mockResolvedValue(undefined)
  const plan = { workspaceId: 'w', expectedEntries: [], writes: [], moves: [], trashes: [] }
  await tauriBridge.workspaceApplyTransaction(plan)
  expect(invoke).toHaveBeenLastCalledWith('workspace_apply_transaction', { plan })
  await tauriBridge.workspaceHashPackage('p')
  expect(invoke).toHaveBeenLastCalledWith('workspace_hash_package', { packageRoot: 'p' })
  const request = { sourceSnapshotToken: 'token', writes: [] }
  await tauriBridge.workspaceReplaceGeneratedFiles(request)
  expect(invoke).toHaveBeenLastCalledWith('workspace_replace_generated_files', { request })
})

it('binds snapshots to workspace reselection and leaves index/digest untouched on conflict', async () => {
  const bridge = createBrowserBridge({
    initialFiles: { 'p/source': 'source', '.well-known/hermes-workflows/index.json': 'old' },
  })
  const captured = await bridge.workspaceHashPackage('p')
  await bridge.workspaceSetRoot('/different')
  const request = {
    sourceSnapshotToken: captured.sourceSnapshotToken,
    writes: [
      { relativePath: 'p/digests.json', text: 'digest', expectedCurrentHash: null },
      { relativePath: '.well-known/hermes-workflows/index.json', text: 'index', expectedCurrentHash: 'stale' },
    ],
  }
  await expect(bridge.workspaceReplaceGeneratedFiles(request)).rejects.toMatchObject({
    code: 'package_snapshot_invalid',
  })
  const fresh = await bridge.workspaceHashPackage('p')
  await expect(
    bridge.workspaceReplaceGeneratedFiles({ ...request, sourceSnapshotToken: fresh.sourceSnapshotToken }),
  ).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  await expect(bridge.workspaceReadTextArtifact('p/digests.json')).rejects.toMatchObject({ code: 'path_not_found' })
  expect((await bridge.workspaceReadTextArtifact('.well-known/hermes-workflows/index.json')).text).toBe('old')
})

it('moves binary artifacts and requires explicit expectations for every operation', async () => {
  const bridge = createBrowserBridge({ initialArtifacts: { 'source.bin': new Uint8Array([0, 255, 1]) } })
  const original = await bridge.workspaceReadArtifact('source.bin')
  const plan = {
    workspaceId: 'browser-workspace',
    expectedEntries: [
      { relativePath: 'source.bin', expectedCurrentHash: original.sha256 },
      { relativePath: 'nested/destination.bin', expectedCurrentHash: null },
    ],
    writes: [],
    moves: [{ sourcePath: 'source.bin', destinationPath: 'nested/destination.bin' }],
    trashes: [],
  }
  await expect(bridge.workspaceApplyTransaction({ ...plan, expectedEntries: [] })).rejects.toMatchObject({
    code: 'workspace_transaction_invalid',
  })
  await bridge.workspaceApplyTransaction(plan)
  expect((await bridge.workspaceReadArtifact('nested/destination.bin')).sha256).toBe(original.sha256)
  await expect(bridge.workspaceReadArtifact('source.bin')).rejects.toMatchObject({ code: 'path_not_found' })
})

it('binds new package directory absence before creating any files', async () => {
  const plan = {
    workspaceId: 'browser-workspace',
    expectedEntries: [
      { relativePath: 'new', expectedCurrentHash: null },
      { relativePath: 'new/manifest.json', expectedCurrentHash: null },
    ],
    writes: [{ relativePath: 'new/manifest.json', text: '{}', expectedCurrentHash: null }],
    moves: [],
    trashes: [],
  }
  const existing = createBrowserBridge({ initialFiles: { 'new/unrelated.txt': 'keep' } })
  await expect(existing.workspaceApplyTransaction(plan)).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  const fresh = createBrowserBridge({ initialFiles: {} })
  expect((await fresh.workspaceApplyTransaction(plan)).status).toBe('committed')
})

it('excludes generated root digest from payload count and total byte limits', async () => {
  const countFiles = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`p/file${i}`, '']))
  const count = createBrowserBridge({ initialFiles: { ...countFiles, 'p/digests.json': 'generated' } })
  expect((await count.workspaceHashPackage('p')).files).toHaveLength(512)
  const byteFiles = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p/file${i}`, 'a'.repeat(1024 * 1024)]))
  const bytes = createBrowserBridge({ initialFiles: { ...byteFiles, 'p/digests.json': 'generated' } })
  expect((await bytes.workspaceHashPackage('p')).files).toHaveLength(8)
})
it('rejects nested package manifests with casefold parity', async () => {
  const bridge = createBrowserBridge({ initialFiles: { 'p/nested/WORKFLOW-PACKAGE.JSON': '{}' } })
  await expect(bridge.workspaceHashPackage('p')).rejects.toMatchObject({ code: 'package_root_nested' })
})

it('bounds projected traversal including newly generated root digests', async () => {
  const initialFiles = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`p/branch${i}/a/b/c/d/e/f/file`, '']))
  const bridge = createBrowserBridge({ initialFiles })
  const snapshot = await bridge.workspaceHashPackage('p')
  expect(snapshot.entries).toHaveLength(4096)
  await expect(
    bridge.workspaceReplaceGeneratedFiles({
      sourceSnapshotToken: snapshot.sourceSnapshotToken,
      writes: [
        { relativePath: 'p/digests.json', text: '{}', expectedCurrentHash: null },
        { relativePath: '.well-known/hermes-workflows/index.json', text: '{}', expectedCurrentHash: null },
      ],
    }),
  ).rejects.toMatchObject({ code: 'package_traversal_limit' })
  await expect(bridge.workspaceReadArtifact('p/digests.json')).rejects.toMatchObject({ code: 'path_not_found' })
})

it('captures workspace-root packages with relative entries while refusing root preparation', async () => {
  const bridge = createBrowserBridge({
    initialFiles: { 'workflow-package.json': '{}', 'nested/a.md': 'a', 'digests.json': 'generated' },
  })
  const snapshot = await bridge.workspaceHashPackage('')
  expect(snapshot.packageRoot).toBe('')
  expect(snapshot.files.map((file) => file.relativePath)).toEqual(['nested/a.md', 'workflow-package.json'])
  expect(snapshot.entries.map((entry) => entry.relativePath)).toEqual([
    'workflow-package.json',
    'nested',
    'nested/a.md',
    'digests.json',
  ])
  expect(snapshot.generatedDigestHash).toBe((await bridge.workspaceReadArtifact('digests.json')).sha256)
  await expect(
    bridge.workspaceReplaceGeneratedFiles({ sourceSnapshotToken: snapshot.sourceSnapshotToken, writes: [] }),
  ).rejects.toMatchObject({ code: 'package_root_required' })
  await bridge.workspaceWriteTextArtifact({
    relativePath: 'nested/a.md',
    text: 'changed',
    expectedCurrentHash: (await bridge.workspaceReadArtifact('nested/a.md')).sha256,
  })
  expect(
    (await bridge.workspaceHashPackage('')).files.find((file) => file.relativePath === 'nested/a.md')?.sha256,
  ).not.toBe(snapshot.files[0]?.sha256)
})
