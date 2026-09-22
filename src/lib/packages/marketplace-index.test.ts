import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadBundledWorkflowPackageContract,
  loadBundledWorkflowPackageVectors,
} from '../package-contract/bundled-package-contract'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { WorkflowPackageManifest } from './types'
import {
  generateMarketplaceIndex,
  parseMarketplaceIndex,
  marketplaceEntry,
  marketplaceIndexSizeError,
} from './marketplace-index'

let contract: WorkflowPackageContract
let manifest: WorkflowPackageManifest
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
  manifest = (await loadBundledWorkflowPackageVectors()).validationVectors.find((v) => v.name === 'manifest_valid')!
    .value as unknown as WorkflowPackageManifest
})
const digest = 'a'.repeat(64)
describe('repository marketplace index', () => {
  it('executes both index byte boundary recipes with exact SHA bytes', async () => {
    for (const vector of (await loadBundledWorkflowPackageVectors()).boundaryVectors.filter(
      (v) => v.limit === 'max_index_bytes',
    )) {
      const recipe = vector.recipe as { repeat: string; count: number }
      const bytes = new TextEncoder().encode(recipe.repeat.repeat(recipe.count))
      const expected = vector.expected as { sha256: string; diagnosticCode: string | null }
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
      expect(sha, vector.name).toBe(expected.sha256)
      expect(marketplaceIndexSizeError(bytes, contract), vector.name).toBe(expected.diagnosticCode)
    }
  })
  it('emits deterministic sorted metadata without a time or commit identity', () => {
    const entries = ['productivity', 'diagnostics'].map((id) =>
      marketplaceEntry({ ...manifest, id }, 'packages/' + id, digest),
    )
    const text = generateMarketplaceIndex(entries, contract)
    expect(JSON.parse(text).packages.map((p: { id: string }) => p.id)).toEqual(['diagnostics', 'productivity'])
    expect(text).toBe(generateMarketplaceIndex([...entries].reverse(), contract))
    expect(text).not.toMatch(/generatedAt|timestamp|commit/i)
    expect(JSON.parse(text).packages[0]).toEqual({
      ...marketplaceEntry({ ...manifest, id: 'diagnostics' }, 'packages/diagnostics', digest),
    })
  })
  it('replays the malformed index vector', async () => {
    const vector = (await loadBundledWorkflowPackageVectors()).validationVectors.find(
      (v) => v.name === 'index_entry_malformed',
    )!
    expect(parseMarketplaceIndex(JSON.stringify(vector.value), contract)).toMatchObject({
      ok: false,
      code: 'package_index_invalid',
    })
  })
  it('rejects duplicate ids, paths, unsorted entries, nesting and unknown fields', () => {
    const a = marketplaceEntry({ ...manifest, id: 'a' }, 'packages/a', digest)
    const b = marketplaceEntry({ ...manifest, id: 'b' }, 'packages/b', digest)
    for (const entries of [
      [a, a],
      [a, { ...b, packagePath: a.packagePath }],
      [b, a],
      [a, { ...b, packagePath: a.packagePath + '/b' }],
      [{ ...a, unexpected: true }],
      [{ ...a, tags: ['x', 'x'] }],
      [{ ...a, displayName: ' invalid ' }],
    ]) {
      expect(parseMarketplaceIndex(JSON.stringify({ schemaVersion: 1, packages: entries }), contract).ok).toBe(false)
    }
  })
  it('rejects duplicate JSON keys, unsupported versions and byte overflow', () => {
    expect(parseMarketplaceIndex('{"schemaVersion":1,"schemaVersion":1,"packages":[]}', contract).ok).toBe(false)
    expect(parseMarketplaceIndex('{"schemaVersion":2,"packages":[]}', contract)).toMatchObject({
      ok: false,
      code: 'package_contract_unsupported',
    })
    expect(parseMarketplaceIndex(' '.repeat(contract.resource_rules.max_index_bytes + 1), contract)).toMatchObject({
      ok: false,
      code: 'package_index_size_limit',
    })
  })
  it('replays both catalog count recipes before JSON schema checking', async () => {
    for (const vector of (await loadBundledWorkflowPackageVectors()).boundaryVectors.filter(
      (v) => v.limit === 'max_catalog_entries',
    )) {
      const recipe = vector.recipe as { count: number; schemaVersion: number; entryTemplate: Record<string, unknown> }
      const entries = Array.from({ length: recipe.count }, (_, i) =>
        JSON.parse(JSON.stringify(recipe.entryTemplate).replaceAll('{index:04d}', String(i).padStart(4, '0'))),
      )
      const result = parseMarketplaceIndex(
        JSON.stringify({ schemaVersion: recipe.schemaVersion, packages: entries }),
        contract,
      )
      const expected = vector.expected as { accepted: boolean; diagnosticCode: string | null }
      expect(result.ok, vector.name).toBe(expected.accepted)
      if (!result.ok) expect(result.code, vector.name).toBe(expected.diagnosticCode)
    }
  })
})
