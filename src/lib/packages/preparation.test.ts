import { beforeAll, expect, it } from 'vitest'
import {
  loadBundledWorkflowPackageContract,
  loadBundledWorkflowPackageVectors,
} from '../package-contract/bundled-package-contract'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { WorkspacePackageSnapshot } from '../native/types'
import type { WorkflowPackageManifest } from './types'
import type { PackageAnalysis } from './readiness'
import { generateMarketplaceIndex, marketplaceEntry, MARKETPLACE_INDEX_PATH } from './marketplace-index'
import { prepareGeneratedPackageFiles, type PackagePreparationInput } from './preparation'

let contract: WorkflowPackageContract, manifest: WorkflowPackageManifest
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
  manifest = (await loadBundledWorkflowPackageVectors()).validationVectors.find((v) => v.name === 'manifest_valid')!
    .value as unknown as WorkflowPackageManifest
})
async function sha(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
async function input(): Promise<PackagePreparationInput> {
  const manifestText = JSON.stringify(manifest)
  const hash = await sha(manifestText),
    size = new TextEncoder().encode(manifestText).length
  const snapshot: WorkspacePackageSnapshot = {
    workspaceId: 'workspace',
    packageRoot: 'packages/selected',
    sourceSnapshotToken: 'opaque-snapshot',
    generatedDigestHash: null,
    files: [
      {
        relativePath: 'workflow-package.json',
        size,
        sha256: hash,
        identity: { sha256: hash, size, modifiedAt: 'now' },
      },
    ],
    entries: [
      {
        relativePath: 'packages/selected/workflow-package.json',
        kind: 'file',
        size,
        modifiedAt: 'now',
        symlink: 'none',
        readOnly: false,
      },
    ],
  }
  const analysis = { ready: true, blockers: [], findings: [], advisories: [] } as unknown as PackageAnalysis
  return {
    contract,
    manifestText,
    snapshot,
    analysis,
    analyzedHashes: new Map([['workflow-package.json', hash]]),
    committedIndexText: null,
    workingIndexText: null,
    workingIndexHash: null,
  }
}
it('prepares both generated files in memory bound to native snapshot and expected revisions', async () => {
  const source = await input()
  const result = await prepareGeneratedPackageFiles(source)
  expect(result.request.sourceSnapshotToken).toBe(source.snapshot.sourceSnapshotToken)
  expect(result.request.writes.map((w) => w.relativePath)).toEqual([
    'packages/selected/digests.json',
    MARKETPLACE_INDEX_PATH,
  ])
  expect(result.request.writes.every((w) => w.expectedCurrentHash === null)).toBe(true)
  expect(JSON.parse(result.indexText).packages[0].packageDigest).toBe(JSON.parse(result.digestsText).packageDigest)
})
it('preserves committed unselected package metadata and rejects a dirty unrelated index entry', async () => {
  const source = await input()
  const other = marketplaceEntry({ ...manifest, id: 'other' }, 'packages/other', 'a'.repeat(64))
  const committed = generateMarketplaceIndex([other], contract)
  const request = {
    ...source,
    committedIndexText: committed,
    workingIndexText: committed,
    workingIndexHash: await sha(committed),
  }
  const result = await prepareGeneratedPackageFiles(request)
  expect(JSON.parse(result.indexText).packages.find((p: { id: string }) => p.id === 'other')).toEqual(other)
  const dirty = generateMarketplaceIndex([{ ...other, version: '9.0.0' }], contract)
  await expect(
    prepareGeneratedPackageFiles({ ...request, workingIndexText: dirty, workingIndexHash: await sha(dirty) }),
  ).rejects.toThrow('package_index_conflict')
})
it('rejects stale analysis, stale manifest text, unready packages and mismatched index hashes', async () => {
  const source = await input()
  for (const changed of [
    { ...source, analyzedHashes: new Map() },
    { ...source, manifestText: source.manifestText + ' ' },
    { ...source, analysis: { ...source.analysis, ready: false } },
    { ...source, workingIndexHash: 'a'.repeat(64) },
  ])
    await expect(prepareGeneratedPackageFiles(changed)).rejects.toThrow()
})
it('allows regeneration of only the selected entry after an interrupted local preparation', async () => {
  const source = await input()
  const old = generateMarketplaceIndex(
    [marketplaceEntry(manifest, source.snapshot.packageRoot, 'a'.repeat(64))],
    contract,
  )
  const result = await prepareGeneratedPackageFiles({
    ...source,
    workingIndexText: old,
    workingIndexHash: await sha(old),
  })
  expect(JSON.parse(result.indexText).packages).toHaveLength(1)
  expect(result.request.writes[1]!.expectedCurrentHash).toBe(await sha(old))
})
it('rejects an id already committed under a different package root', async () => {
  const source = await input()
  const old = generateMarketplaceIndex([marketplaceEntry(manifest, 'packages/other', 'a'.repeat(64))], contract)
  await expect(
    prepareGeneratedPackageFiles({
      ...source,
      committedIndexText: old,
      workingIndexText: old,
      workingIndexHash: await sha(old),
    }),
  ).rejects.toThrow()
})
it('counts a newly generated root digest toward the final traversal limit', async () => {
  const source = await input()
  const entries = [
    ...source.snapshot.entries,
    ...Array.from({ length: contract.resource_rules.max_traversal_entries - 1 }, (_, i) => ({
      relativePath: source.snapshot.packageRoot + '/empty-' + i,
      kind: 'directory' as const,
      size: 0,
      modifiedAt: 'now',
      symlink: 'none' as const,
      readOnly: false,
    })),
  ]
  await expect(prepareGeneratedPackageFiles({ ...source, snapshot: { ...source.snapshot, entries } })).rejects.toThrow(
    'package_traversal_limit',
  )
  const existingDigest = { ...entries[0]!, relativePath: source.snapshot.packageRoot + '/digests.json' }
  await expect(
    prepareGeneratedPackageFiles({
      ...source,
      snapshot: {
        ...source.snapshot,
        entries: [...entries.slice(0, -1), existingDigest],
        generatedDigestHash: 'a'.repeat(64),
      },
    }),
  ).resolves.toBeDefined()
})
