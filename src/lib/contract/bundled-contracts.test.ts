import { describe, expect, it } from 'vitest'
import { loadBundledAuthoringContracts } from './bundled-contracts'
import { loadBundledConformanceCorpora } from './conformance'

describe('bundled Hermes authoring resources', () => {
  it('activates the exact v6/v2 contract and corpus pairs offline', async () => {
    const contracts = await loadBundledAuthoringContracts()
    const corpora = await loadBundledConformanceCorpora(contracts)

    expect(contracts.map((contract) => [contract.profile, contract.normalizer_version])).toEqual([
      ['archon-2026-07', 6],
      ['hermes-legacy', 2],
    ])
    expect(corpora.map((corpus) => [corpus.profile, corpus.normalizerVersion, corpus.cases.length])).toEqual([
      ['archon-2026-07', 6, 48],
      ['hermes-legacy', 2, 11],
    ])
  })
})
