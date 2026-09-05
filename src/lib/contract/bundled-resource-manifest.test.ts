import { describe, expect, it, vi } from 'vitest'
import manifestText from '../../../contracts/manifest.json?raw'
import archonContract from '../../../contracts/archon-2026-07-v6.json?raw'
import archonCorpus from '../../../contracts/archon-2026-07-v6.corpus.json?raw'
import legacyContract from '../../../contracts/hermes-legacy-v2.json?raw'
import legacyCorpus from '../../../contracts/hermes-legacy-v2.corpus.json?raw'
import { loadBundledResourceSet } from './bundled-resource-manifest'

const sources = new Map([
  ['archon-2026-07-v6.json', archonContract],
  ['archon-2026-07-v6.corpus.json', archonCorpus],
  ['hermes-legacy-v2.json', legacyContract],
  ['hermes-legacy-v2.corpus.json', legacyCorpus],
])

function manifest(): Record<string, unknown> {
  return JSON.parse(manifestText) as Record<string, unknown>
}

describe('bundled contract resource manifest', () => {
  it('selects renamed contract and corpus files entirely from validated manifest entries', async () => {
    const renamed = manifest()
    const entries = renamed.contracts as Array<Record<string, unknown>>
    entries[0]!.file = 'renamed-contract.json'
    entries[0]!.corpus_file = 'renamed.corpus.json'
    const renamedSources = new Map(sources)
    renamedSources.set('renamed-contract.json', archonContract)
    renamedSources.set('renamed.corpus.json', archonCorpus)
    renamedSources.delete('archon-2026-07-v6.json')
    renamedSources.delete('archon-2026-07-v6.corpus.json')
    const readResource = vi.fn(async (file: string) => {
      const text = renamedSources.get(file)
      if (text === undefined) throw new Error(`missing ${file}`)
      return text
    })

    const loaded = await loadBundledResourceSet(JSON.stringify(renamed), readResource)

    expect(loaded.contracts.map(({ profile, normalizer_version }) => [profile, normalizer_version])).toEqual([
      ['archon-2026-07', 6],
      ['hermes-legacy', 2],
    ])
    expect(loaded.corpusResources.map(({ profile, normalizerVersion }) => [profile, normalizerVersion])).toEqual([
      ['archon-2026-07', 6],
      ['hermes-legacy', 2],
    ])
    expect(readResource.mock.calls.map(([file]) => file).sort()).toEqual([
      'hermes-legacy-v2.corpus.json',
      'hermes-legacy-v2.json',
      'renamed-contract.json',
      'renamed.corpus.json',
    ])
  })

  it.each([
    [
      'an unsafe basename',
      (value: Record<string, unknown>) =>
        ((value.contracts as Array<Record<string, unknown>>)[0]!.file = '../contract.json'),
      /safe JSON basename/i,
    ],
    [
      'a duplicate profile',
      (value: Record<string, unknown>) =>
        ((value.contracts as Array<Record<string, unknown>>)[1]!.profile = 'archon-2026-07'),
      /profiles must be unique/i,
    ],
    [
      'a reused file',
      (value: Record<string, unknown>) =>
        ((value.contracts as Array<Record<string, unknown>>)[1]!.corpus_file = 'archon-2026-07-v6.corpus.json'),
      /files must be unique/i,
    ],
    [
      'a mismatched normalizer',
      (value: Record<string, unknown>) =>
        ((value.contracts as Array<Record<string, unknown>>)[0]!.normalizer_version = 7),
      /normalizer/i,
    ],
    [
      'a mismatched corpus digest',
      (value: Record<string, unknown>) =>
        ((value.contracts as Array<Record<string, unknown>>)[0]!.corpus_digest = `sha256:${'0'.repeat(64)}`),
      /corpus digest/i,
    ],
  ])('rejects %s before activation', async (_label, mutate, expected) => {
    const invalid = manifest()
    mutate(invalid)
    await expect(
      loadBundledResourceSet(JSON.stringify(invalid), async (file) => sources.get(file) ?? ''),
    ).rejects.toThrow(expected)
  })

  it('rejects missing resources and a contract/corpus identity mismatch', async () => {
    await expect(
      loadBundledResourceSet(manifestText, async () => {
        throw new Error('absent')
      }),
    ).rejects.toThrow(/absent/)

    const mismatched = manifest()
    const entries = mismatched.contracts as Array<Record<string, unknown>>
    entries[0]!.corpus_file = 'hermes-legacy-v2.corpus.json'
    entries[1]!.corpus_file = 'archon-2026-07-v6.corpus.json'
    await expect(
      loadBundledResourceSet(JSON.stringify(mismatched), async (file) => sources.get(file) ?? ''),
    ).rejects.toThrow(/corpus|profile|normalizer/i)
  })
})
