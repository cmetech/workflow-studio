import { expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { NativeError } from '$src/lib/native/types'
import type { GitPackageContext } from '$src/lib/git/types'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '$src/lib/package-contract/bundled-package-contract'
import manifestText from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json?raw'
import { createPackageGitSummaries } from './package-git-summary'
import { capturePackageAnalysis } from './package-analysis'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'

async function fixture() {
  const native = createBrowserBridge({
    initialFiles: {
      'a/workflow-package.json': manifestText,
      'a/notes.txt': 'before',
      'b/workflow-package.json': manifestText,
      'b/notes.txt': 'before',
    },
  })
  const contexts = new Map<string, GitPackageContext>()
  for (const root of ['a', 'b']) {
    const snapshot = await native.workspaceHashPackage(root)
    contexts.set(root, {
      workspaceId: snapshot.workspaceId,
      packageRoot: root,
      repository: { root: '/repo', branch: 'main', detachedHead: null },
      base: { kind: 'head', oid: 'initial', reference: 'refs/heads/main' },
      contextToken: root,
      committedManifestText: manifestText,
      baselineManifestText: manifestText,
      committedFiles: snapshot.files.map((file) => ({ ...file, gitMode: '100644' })),
      committedIndexText: null,
      workingIndexText: null,
      workingIndexHash: null,
    })
  }
  native.gitReadPackageContext = vi.fn(async (root) => contexts.get(root)!)
  const contract = await loadBundledWorkflowPackageContract()
  const resource = await loadBundledResourceResolution()
  const controller = createPackageGitSummaries(native)
  const refresh = (roots = ['a', 'b']) => controller.refresh('browser-workspace', roots, contract, resource.contract)
  return { native, contexts, controller, refresh, contract, resources: resource.contract }
}

it('compares saved bytes per package and refreshes after a local baseline changes', async () => {
  const f = await fixture()
  await f.refresh()
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    phase: 'ready',
    changes: [],
    proposedVersion: null,
  })
  const before = await f.native.workspaceReadTextArtifact('a/notes.txt')
  await f.native.workspaceWriteTextArtifact({
    relativePath: before.relativePath,
    text: 'after',
    expectedCurrentHash: before.sha256,
  })
  await f.refresh()
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    phase: 'ready',
    changes: [{ kind: 'modified', path: 'notes.txt' }],
    proposedVersion: null,
  })
  expect(f.controller.state.get().summaries.get('b')).toMatchObject({ phase: 'ready', changes: [] })
  const snapshot = await f.native.workspaceHashPackage('a')
  f.contexts.set('a', {
    ...f.contexts.get('a')!,
    committedFiles: snapshot.files.map((file) => ({ ...file, gitMode: '100644' })),
  })
  await f.refresh()
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({ changes: [], proposedVersion: null })
})

it('reports added and removed exact paths and the first local version honestly', async () => {
  const f = await fixture()
  f.contexts.set('a', {
    ...f.contexts.get('a')!,
    committedFiles: [{ relativePath: 'deleted.txt', size: 1, sha256: 'old', gitMode: '100644' }],
  })
  f.contexts.set('b', {
    ...f.contexts.get('b')!,
    base: { kind: 'unborn', reference: 'refs/heads/main' },
    committedFiles: [],
    committedManifestText: null,
    baselineManifestText: null,
  })
  await f.refresh()
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    changes: [
      { kind: 'removed', path: 'deleted.txt' },
      { kind: 'added', path: 'notes.txt' },
      { kind: 'added', path: 'workflow-package.json' },
    ],
  })
  expect(f.controller.state.get().summaries.get('b')).toMatchObject({
    phase: 'ready',
    baselineVersion: null,
    proposedVersion: null,
  })
})

it('keeps missing Git and failed snapshots unavailable rather than clean', async () => {
  const f = await fixture()
  vi.mocked(f.native.gitReadPackageContext).mockRejectedValue(
    new NativeError('git_not_repository', 'No local repository'),
  )
  await f.refresh()
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    phase: 'unavailable',
    message: expect.stringContaining('No local Git repository'),
  })
})

it('discards responses after workspace changes and rejects mismatched snapshot identities', async () => {
  const f = await fixture()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(f.native.gitReadPackageContext).mockImplementation(async (root) => {
    await blocked
    return f.contexts.get(root)!
  })
  const pending = f.refresh()
  f.controller.reset()
  release()
  await pending
  expect(f.controller.state.get()).toMatchObject({ workspaceId: null })
  f.contexts.set('a', { ...f.contexts.get('a')!, workspaceId: 'other' })
  await f.refresh(['a'])
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({ phase: 'unavailable' })
})

it('does not use manifest bytes that changed after the authenticated snapshot', async () => {
  const f = await fixture()
  const read = f.native.workspaceReadTextArtifact.bind(f.native)
  f.native.workspaceReadTextArtifact = vi.fn(async (path) => ({
    ...(await read(path)),
    text: manifestText.replace('1.2.3', '9.0.0'),
  }))
  await f.refresh(['a'])
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    phase: 'unavailable',
    message: expect.stringContaining('manifest changed'),
  })
})

it('counts generated digest changes without including the shared repository index', async () => {
  const f = await fixture()
  await f.native.workspaceWriteTextArtifact({ relativePath: 'a/digests.json', text: '{}', expectedCurrentHash: null })
  await f.refresh(['a'])
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    changes: [{ kind: 'added', path: 'digests.json' }],
  })
})

it('queues an authenticated proposal during comparison and rejects it after saved files change', async () => {
  const f = await fixture()
  const manifest = await f.native.workspaceReadTextArtifact('a/workflow-package.json')
  await f.native.workspaceWriteTextArtifact({
    relativePath: manifest.relativePath,
    expectedCurrentHash: manifest.sha256,
    text: JSON.stringify({
      ...JSON.parse(manifest.text),
      workflows: [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }],
    }),
  })
  await f.native.workspaceWriteTextArtifact({
    relativePath: 'a/main.yaml',
    expectedCurrentHash: null,
    text: 'name: Example\ndescription: Example\nnodes:\n  - id: first\n    prompt: hello\n',
  })
  await f.native.workspaceWriteTextArtifact({
    relativePath: 'a/main.hermes.yaml',
    expectedCurrentHash: null,
    text: 'language_compatibility: archon-2026-07\n',
  })
  const captured = await capturePackageAnalysis({
    native: f.native,
    packageRoot: 'a',
    contract: f.contract,
    resourceContract: f.resources,
    authoring: await loadBundledAuthoringContracts(),
    index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
  })
  expect(captured.analysis.ready).toBe(true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(f.native.gitReadPackageContext).mockImplementation(async (root) => {
    await gate
    return f.contexts.get(root)!
  })
  const pending = f.refresh(['a'])
  f.controller.applyAnalysis('a', captured)
  release()
  await pending
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({ proposedVersion: '1.3.0' })
  const previousState = f.controller.state.get()
  f.controller.applyAnalysis('a', captured)
  expect(f.controller.state.get()).toBe(previousState)
  const note = await f.native.workspaceReadTextArtifact('a/notes.txt')
  await f.native.workspaceWriteTextArtifact({
    relativePath: note.relativePath,
    expectedCurrentHash: note.sha256,
    text: 'newer saved bytes',
  })
  await f.refresh(['a'])
  f.controller.applyAnalysis('a', captured)
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({ proposedVersion: null })
})

it('withholds the first-version proposal when declared workflows are missing', async () => {
  const f = await fixture()
  f.contexts.set('a', {
    ...f.contexts.get('a')!,
    base: { kind: 'unborn', reference: 'refs/heads/main' },
    committedFiles: [],
    committedManifestText: null,
    baselineManifestText: null,
  })
  await expect(
    capturePackageAnalysis({
      native: f.native,
      packageRoot: 'a',
      contract: f.contract,
      resourceContract: f.resources,
      authoring: await loadBundledAuthoringContracts(),
      index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
    }),
  ).rejects.toThrow('package_member_missing')
  await f.refresh(['a'])
  expect(f.controller.state.get().summaries.get('a')).toMatchObject({
    phase: 'ready',
    baselineVersion: null,
    proposedVersion: null,
  })
})
