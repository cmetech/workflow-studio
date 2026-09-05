import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadAuthoringContract } from './contract-loader'
import { loadConformanceCorpus } from './conformance'
import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
const root = 'contracts/'
const source = { kind: 'bundled', identifier: 'reader-3-fixture' } as const
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const contract = JSON.parse(readFileSync(`${root}archon-2026-07-v6.json`, 'utf8'))
const corpus = JSON.parse(readFileSync(`${root}archon-2026-07-v6.corpus.json`, 'utf8'))
describe('reader 3 scanner publication', () => {
  it('loads the exact generated reader-3 and corpus-2 pair', async () => {
    const loaded = await loadAuthoringContract(bytes(contract), source)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const paired = loadConformanceCorpus(bytes(corpus), loaded.contract)
    expect(paired.formatVersion).toBe(2)
    expect(paired.scannerCases.some((item) => item.id === 'text.whole-output')).toBe(true)
  })
  for (const subtree of Object.keys(contract.reference_scanner_v1)) {
    it(`fails closed on changed nested scanner metadata: ${subtree}`, async () => {
      const changed = structuredClone(contract)
      const value = changed.reference_scanner_v1[subtree]
      if (value && typeof value === 'object') value.unsupported_behavior = true
      else changed.reference_scanner_v1[subtree] = 999
      changed.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(changed))}`
      const loaded = await loadAuthoringContract(bytes(changed), source)
      expect(loaded.ok).toBe(false)
    })
  }
  it('rejects corrupted corpus contents even with a matching contract identity', async () => {
    const loaded = await loadAuthoringContract(bytes(contract), source)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const changed = structuredClone(corpus)
    changed.scanner_cases[0].expected.tokens[0].end++
    expect(() => loadConformanceCorpus(bytes(changed), loaded.contract)).toThrow(/digest/)
  })
})

it('requires scanner capability even if a reader-3 descriptor removes the loop-group activation trigger', async () => {
  const loaded = await loadAuthoringContract(bytes(contract), source)
  if (!loaded.ok) throw new Error(loaded.message)
  const changed = {
    ...loaded.contract,
    node_kinds: loaded.contract.node_kinds.filter((node) => node.id !== 'loop_group'),
  }
  const { createContractCache } = await import('./contract-cache')
  const cache = createContractCache({
    bundled: [changed],
    native: { contractCacheLoad: async () => [], contractCacheWrite: async () => {} },
    activate: async () => true,
    widgetCoverage: () => [],
  })
  expect(cache.activeContract('archon-2026-07')).toBeUndefined()
})
it('keeps the previous active contract after nested signed metadata changes', async () => {
  const loaded = await loadAuthoringContract(bytes(contract), source)
  if (!loaded.ok) throw new Error(loaded.message)
  const { createContractCache } = await import('./contract-cache')
  const cache = createContractCache({
    bundled: [loaded.contract],
    native: { contractCacheLoad: async () => [], contractCacheWrite: async () => {} },
    activate: async () => true,
    widgetCoverage: () => [],
  })
  const changed = structuredClone(contract)
  changed.reference_scanner_v1.modes.bash.heredocs.missing_terminator = 'ignore'
  changed.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(changed))}`
  const entry = await cache.importBytes(bytes(changed), source, { cacheUnsupported: true })
  expect(entry.canActivate).toBe(false)
  expect((await cache.activateContract(entry.digest, 'archon-2026-07')).ok).toBe(false)
  expect(cache.activeContract('archon-2026-07')?.contract_digest).toBe(contract.contract_digest)
})
for (const rule of contract.semantic_rules) {
  it(`rejects signed semantic rule mutation independent of bundled data: ${rule.id}`, async () => {
    const changed = structuredClone(contract)
    changed.semantic_rules.find((value: Record<string, unknown>) => value.id === rule.id).unsupported_behavior = true
    changed.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(changed))}`
    expect((await loadAuthoringContract(bytes(changed), source)).ok).toBe(false)
  })
}
it('rejects a scanner publication disguised as an older reader', async () => {
  const changed = structuredClone(contract)
  changed.contract_reader_version = 2
  changed.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(changed))}`
  expect((await loadAuthoringContract(bytes(changed), source)).ok).toBe(false)
})
