import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import {
  loadBundledResourceResolution,
  loadBundledWorkflowPackageContract,
} from '$src/lib/package-contract/bundled-package-contract'
import type { WorkspacePackageSnapshot, WorkspaceReadResult } from '$src/lib/native/types'
import { capturePackageAnalysis } from './package-analysis'

async function fixture(packageRoot = 'packages/laptop') {
  const root = resolve('tests/fixtures/workflow-packages/laptop-diagnostic')
  const prefix = packageRoot ? packageRoot + '/' : ''
  const texts = new Map<string, WorkspaceReadResult>()
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const absolute = entry.parentPath + '/' + entry.name
    const path = relative(root, absolute).replaceAll('\\', '/')
    const text = await readFile(absolute, 'utf8'),
      bytes = new TextEncoder().encode(text)
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    texts.set(prefix + path, {
      relativePath: prefix + path,
      text,
      sha256,
      size: bytes.length,
      modifiedAt: 'now',
      readOnly: false,
    })
  }
  const entries = [...texts.values()].map(({ relativePath, size, modifiedAt, readOnly }) => ({
    relativePath,
    size,
    modifiedAt,
    readOnly,
    kind: 'file' as const,
    symlink: 'none' as const,
  }))
  const snapshot: WorkspacePackageSnapshot = {
    workspaceId: 'workspace',
    packageRoot,
    sourceSnapshotToken: 'snapshot',
    generatedDigestHash: null,
    entries,
    files: [...texts.values()].map((file) => ({
      relativePath: file.relativePath.slice(prefix.length),
      size: file.size,
      sha256: file.sha256,
      identity: { size: file.size, sha256: file.sha256, modifiedAt: file.modifiedAt },
    })),
  }
  const native = {
    workspaceHashPackage: vi.fn(async () => snapshot),
    workspaceReadTextArtifact: vi.fn(async (path: string) => {
      const value = texts.get(path)
      if (!value) throw new Error('Missing fixture')
      return value
    }),
  }
  return {
    packageRoot,
    texts,
    snapshot,
    native,
    contract: await loadBundledWorkflowPackageContract(),
    resourceContract: (await loadBundledResourceResolution()).contract,
    authoring: await loadBundledAuthoringContracts(),
  }
}
it('uses real workflow and artifact analyzers over a complete native snapshot', async () => {
  const source = await fixture()
  const result = await capturePackageAnalysis({
    ...source,
    index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
  })
  expect(result.analysis.blockers).toEqual([])
  expect(result.analysis.ready).toBe(true)
  expect(result.analysis.references.forNode('analyze-cpu')).toContainEqual(
    expect.objectContaining({ artifactPath: 'scripts/analyze-snapshot.py' }),
  )
  expect(result.analyzedHashes.size).toBe(source.snapshot.files.length)
  expect(result.analysis.advisories).toContainEqual(expect.objectContaining({ code: 'execution_unverified' }))
})
it('analyzes a workspace-root package for editing without inventing absolute paths', async () => {
  const source = await fixture('')
  const result = await capturePackageAnalysis(source)
  expect(result.package.root).toBe('')
  expect(result.analysis.references.forNode('analyze-cpu')).toContainEqual(
    expect.objectContaining({ artifactPath: 'scripts/analyze-snapshot.py' }),
  )
  expect(result.artifactTexts.get('workflow-package.json')).toBe(result.manifestText)
  expect(source.native.workspaceReadTextArtifact.mock.calls.every(([path]) => !path.startsWith('/'))).toBe(true)
})
it('keeps preparation blocked when repository index integrity is unavailable', async () => {
  const result = await capturePackageAnalysis(await fixture())
  expect(result.analysis.ready).toBe(false)
  expect(result.analysis.blockers).toContainEqual(expect.objectContaining({ code: 'package_index_unverified' }))
})
it('reports shared-index corruption as a preparation blocker', async () => {
  const source = await fixture()
  const text = '{}'
  const workingIndexHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  const result = await capturePackageAnalysis({
    ...source,
    index: { committedIndexText: null, workingIndexText: text, workingIndexHash },
  })
  expect(result.analysis.blockers).toContainEqual(expect.objectContaining({ code: 'package_index_invalid' }))
})
it('blocks malformed saved artifacts with their source locations', async () => {
  const source = await fixture()
  const path = source.packageRoot + '/scripts/analyze-snapshot.py'
  const text = 'def broken(:\n',
    bytes = new TextEncoder().encode(text)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  source.texts.set(path, { ...source.texts.get(path)!, text, sha256, size: bytes.length })
  const snapshot = {
    ...source.snapshot,
    files: source.snapshot.files.map((f) =>
      f.relativePath === 'scripts/analyze-snapshot.py'
        ? { ...f, sha256, size: bytes.length, identity: { ...f.identity, sha256, size: bytes.length } }
        : f,
    ),
  }
  source.native.workspaceHashPackage.mockResolvedValue(snapshot)
  const result = await capturePackageAnalysis(source)
  expect(result.analysis.ready).toBe(false)
  expect(result.analysis.blockers).toContainEqual(
    expect.objectContaining({ path: 'scripts/analyze-snapshot.py', line: 1 }),
  )
})
it('rejects source text changed after the native hash snapshot', async () => {
  const source = await fixture()
  const path = source.packageRoot + '/scripts/analyze-snapshot.py'
  source.texts.set(path, { ...source.texts.get(path)!, text: 'changed after capture' })
  await expect(capturePackageAnalysis(source)).rejects.toThrow('package_analysis_stale')
})

it('worker messages survive structured cloning with identical findings and reference data', async () => {
  const { processPackageAnalysisRequest } = await import('./package-analysis-worker')
  const source = await fixture()
  const captured = await capturePackageAnalysis({
    ...source,
    index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
  })
  const input = {
    snapshot: source.snapshot,
    texts: new Map([...source.texts].map(([path, file]) => [path.slice(source.packageRoot.length + 1), file.text])),
    contract: source.contract,
    resourceContract: source.resourceContract,
    authoring: source.authoring,
    index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
  }
  const response = structuredClone(
    await processPackageAnalysisRequest(
      structuredClone({ requestId: 'roundtrip', sourceSnapshotToken: 'snapshot', input }),
    ),
  )
  expect(response).not.toHaveProperty('error')
  if (!('result' in response)) throw new Error('Missing analysis')
  expect(response.result.package).toEqual(captured.package)
  expect(response.result.analysis.findings).toEqual(captured.analysis.findings)
  expect(response.result.analysis.references.references).toEqual(captured.analysis.references.references)
  expect(response.result.analysis.references).not.toHaveProperty('forNode')
  const invalid = await processPackageAnalysisRequest({ requestId: 'invalid', sourceSnapshotToken: 'stale', input })
  expect(invalid).toMatchObject({ error: 'package_analysis_worker_identity' })
})
