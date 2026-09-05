import { describe, expect, it } from 'vitest'
import { loadBundledAuthoringContracts, loadBundledConformanceCorpora } from './bundled-contracts'

describe('bundled Hermes authoring resources', () => {
  it('activates the exact v6/v2 contract and corpus pairs offline', async () => {
    const contracts = await loadBundledAuthoringContracts()
    const corpora = await loadBundledConformanceCorpora(contracts)

    expect(contracts.map((contract) => [contract.profile, contract.normalizer_version])).toEqual([
      ['archon-2026-07', 6],
      ['hermes-legacy', 2],
    ])
    expect(corpora.map((corpus) => [corpus.profile, corpus.normalizerVersion, corpus.formatVersion])).toEqual([
      ['archon-2026-07', 6, 2],
      ['hermes-legacy', 2, 1],
    ])
    expect(corpora[0]?.scannerCases.some((fixture) => fixture.id === 'text.whole-output')).toBe(true)
    expect(corpora[0]?.cases.some((fixture) => fixture.id === 'loop-group-minimal-valid')).toBe(true)
  })
})
