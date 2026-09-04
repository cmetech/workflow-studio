import { describe, expect, it } from 'vitest'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import archonCorpusText from '../../../contracts/archon-2026-07-v6.corpus.json?raw'
import { loadAuthoringContract } from './contract-loader'
import { loadConformanceCorpus } from './conformance'

describe('Hermes conformance corpus reader', () => {
  it('accepts the paired Archon corpus and preserves its Hermes validity decisions', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)

    const corpus = loadConformanceCorpus(new TextEncoder().encode(archonCorpusText), loaded.contract)

    expect(corpus.profile).toBe('archon-2026-07')
    expect(corpus.normalizerVersion).toBe(6)
    expect(corpus.cases.find((fixture) => fixture.id === 'loop-group-minimal-valid')).toMatchObject({ valid: true })
    expect(corpus.cases.find((fixture) => fixture.id === 'loop-group-empty-body')).toMatchObject({ valid: false })
  })

  it('rejects a corpus whose profile or normalizer identity does not match its contract', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const payload = JSON.parse(archonCorpusText) as Record<string, unknown>
    payload.normalizer_version = 999

    expect(() => loadConformanceCorpus(new TextEncoder().encode(JSON.stringify(payload)), loaded.contract)).toThrow(
      /normalizer/i,
    )
  })

  it('rejects mismatched corpus generator identity and per-case contract identity', async () => {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loaded.ok) throw new Error(loaded.message)
    const generatorMismatch = JSON.parse(archonCorpusText) as Record<string, unknown>
    ;(generatorMismatch.contract as Record<string, unknown>).schema_version = 999
    expect(() =>
      loadConformanceCorpus(new TextEncoder().encode(JSON.stringify(generatorMismatch)), loaded.contract),
    ).toThrow(/identity/i)

    const caseMismatch = JSON.parse(archonCorpusText) as Record<string, unknown>
    ;(caseMismatch.cases as Record<string, unknown>[])[0]!.profile = 'hermes-legacy'
    expect(() =>
      loadConformanceCorpus(new TextEncoder().encode(JSON.stringify(caseMismatch)), loaded.contract),
    ).toThrow(/case identity/i)
  })
})
