import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAuthoringContract } from '../src/lib/contract/contract-loader'
import { canonicalizeContractPayload, sha256Hex } from '../src/lib/contract/canonical-json'
import { deterministicJson, parseSyncArguments, syncContracts } from './sync-contracts'
import { validateContractResources } from './validate-contracts'

async function envelope(profile: 'hermes-legacy' | 'archon-2026-07'): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    schema_version: 1,
    contract_reader_version: 1,
    profile,
    normalizer_version: 1,
    definition_schema: { type: 'object' },
    sidecar_schema: { type: 'object' },
    node_kinds: [],
    semantic_rules: [],
    compatibility_codes: {},
    documentation: { topics: [], examples: [] },
    limits: { max_document_bytes: 2 * 1024 * 1024 },
  }
  payload.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(payload))}`
  return payload
}

async function corpus(profile: 'hermes-legacy' | 'archon-2026-07'): Promise<Record<string, unknown>> {
  const contract = await envelope(profile)
  return {
    format_version: 1,
    profile,
    normalizer_version: 1,
    contract: {
      schema_version: 1,
      contract_reader_version: 1,
      normalizer: 'fixture',
      validator: 'fixture',
      contract_digest: contract.contract_digest,
    },
    cases: [
      {
        id: `${profile}-fixture`,
        profile,
        normalizer_version: 1,
        definition_yaml: 'name: fixture\ndescription: fixture\nnodes: []\n',
        companion_yaml: null,
        valid: false,
        codes: ['fixture-invalid'],
        diagnostics: [],
        features: ['fixture'],
      },
    ],
  }
}

describe('contract resource synchronization', () => {
  it('requires one explicit source mode and a reproducible generated timestamp', () => {
    expect(() => parseSyncArguments([])).toThrow(/generated-at/i)
    expect(() =>
      parseSyncArguments([
        '--generated-at',
        '2026-07-29T00:00:00.000Z',
        '--hermes-command',
        '/absolute/hermes',
        '--contract-file',
        'hermes-legacy=/absolute/legacy.json',
      ]),
    ).toThrow(/mutually exclusive/i)
    expect(() => parseSyncArguments(['--generated-at', 'not-a-date', '--hermes-command', '/absolute/hermes'])).toThrow(
      /ISO/i,
    )
  })

  it('requires an identity-matched corpus beside each generated contract', () => {
    expect(() =>
      parseSyncArguments([
        '--generated-at',
        '2026-09-04T00:00:00.000Z',
        '--contract-file',
        'hermes-legacy=/absolute/legacy.json',
        '--contract-file',
        'archon-2026-07=/absolute/archon.json',
        '--corpus-file',
        'hermes-legacy=/absolute/legacy.corpus.json',
        '--corpus-file',
        'archon-2026-07=/absolute/archon.corpus.json',
      ]),
    ).not.toThrow()
  })

  it('validates both envelopes before atomically replacing deterministic resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workflow-studio-contracts-'))
    const legacyPath = join(directory, 'legacy-input.json')
    const archonPath = join(directory, 'archon-input.json')
    const legacyCorpusPath = join(directory, 'legacy.corpus.json')
    const archonCorpusPath = join(directory, 'archon.corpus.json')
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, JSON.stringify(await envelope('archon-2026-07')))
    await writeFile(legacyCorpusPath, JSON.stringify(await corpus('hermes-legacy')))
    await writeFile(archonCorpusPath, JSON.stringify(await corpus('archon-2026-07')))

    await syncContracts({
      source: {
        kind: 'files',
        contracts: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath },
        corpora: { 'hermes-legacy': legacyCorpusPath, 'archon-2026-07': archonCorpusPath },
      },
      generatedAt: '2026-07-29T00:00:00.000Z',
      outputDirectory,
    })

    const legacyText = await readFile(join(outputDirectory, 'hermes-legacy-v1.json'), 'utf8')
    const manifestText = await readFile(join(outputDirectory, 'manifest.json'), 'utf8')
    expect(legacyText.endsWith('\n')).toBe(true)
    expect(JSON.parse(manifestText)).toEqual({
      generated_at: '2026-07-29T00:00:00.000Z',
      contracts: [
        expect.objectContaining({ profile: 'archon-2026-07', file: 'archon-2026-07-v1.json' }),
        expect.objectContaining({ profile: 'hermes-legacy', file: 'hermes-legacy-v1.json' }),
      ],
    })
    expect(await validateContractResources(outputDirectory)).toEqual([])
    expect(
      (
        await loadAuthoringContract(new TextEncoder().encode(legacyText), {
          kind: 'bundled',
          identifier: 'legacy',
        })
      ).ok,
    ).toBe(true)
  })

  it('does not replace either committed contract when one candidate is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workflow-studio-contracts-failure-'))
    const legacyPath = join(directory, 'legacy-input.json')
    const archonPath = join(directory, 'archon-input.json')
    const legacyCorpusPath = join(directory, 'legacy.corpus.json')
    const archonCorpusPath = join(directory, 'archon.corpus.json')
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, '{"profile":"archon-2026-07"}')
    await writeFile(legacyCorpusPath, JSON.stringify(await corpus('hermes-legacy')))
    await writeFile(archonCorpusPath, JSON.stringify(await corpus('archon-2026-07')))

    await expect(
      syncContracts({
        source: {
          kind: 'files',
          contracts: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath },
          corpora: { 'hermes-legacy': legacyCorpusPath, 'archon-2026-07': archonCorpusPath },
        },
        generatedAt: '2026-07-29T00:00:00.000Z',
        outputDirectory,
      }),
    ).rejects.toThrow(/archon-2026-07/i)
    await expect(readFile(join(outputDirectory, 'hermes-legacy-v1.json'))).rejects.toThrow()
  })

  it('rolls back the complete pre-existing bundle when the directory commit fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workflow-studio-contracts-rollback-'))
    const legacyPath = join(directory, 'legacy-input.json')
    const archonPath = join(directory, 'archon-input.json')
    const legacyCorpusPath = join(directory, 'legacy.corpus.json')
    const archonCorpusPath = join(directory, 'archon.corpus.json')
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, JSON.stringify(await envelope('archon-2026-07')))
    await writeFile(legacyCorpusPath, JSON.stringify(await corpus('hermes-legacy')))
    await writeFile(archonCorpusPath, JSON.stringify(await corpus('archon-2026-07')))
    await mkdir(outputDirectory)
    const oldResources = {
      'hermes-legacy-v1.json': 'old legacy\n',
      'archon-2026-07-v1.json': 'old archon\n',
      'manifest.json': 'old manifest\n',
    }
    await Promise.all(Object.entries(oldResources).map(([file, text]) => writeFile(join(outputDirectory, file), text)))

    let directoryRenames = 0
    await expect(
      syncContracts(
        {
          source: {
            kind: 'files',
            contracts: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath },
            corpora: { 'hermes-legacy': legacyCorpusPath, 'archon-2026-07': archonCorpusPath },
          },
          generatedAt: '2026-07-29T00:00:00.000Z',
          outputDirectory,
        },
        {
          rename: async (from, to) => {
            directoryRenames += 1
            if (directoryRenames === 2) throw new Error('injected directory commit failure')
            await rename(from, to)
          },
        },
      ),
    ).rejects.toThrow(/injected directory commit failure/i)

    await expect(
      Promise.all(Object.keys(oldResources).map((file) => readFile(join(outputDirectory, file), 'utf8'))),
    ).resolves.toEqual(Object.values(oldResources))
  })

  it('uses locale-independent code-point ordering for deterministic JSON', () => {
    expect(deterministicJson({ a: 1, Z: 2 })).toBe('{\n  "Z": 2,\n  "a": 1\n}\n')
  })

  it('rejects duplicate, extra, and mismatched manifest resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workflow-studio-contracts-manifest-'))
    const legacyPath = join(directory, 'legacy-input.json')
    const archonPath = join(directory, 'archon-input.json')
    const legacyCorpusPath = join(directory, 'legacy.corpus.json')
    const archonCorpusPath = join(directory, 'archon.corpus.json')
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, JSON.stringify(await envelope('archon-2026-07')))
    await writeFile(legacyCorpusPath, JSON.stringify(await corpus('hermes-legacy')))
    await writeFile(archonCorpusPath, JSON.stringify(await corpus('archon-2026-07')))
    await syncContracts({
      source: {
        kind: 'files',
        contracts: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath },
        corpora: { 'hermes-legacy': legacyCorpusPath, 'archon-2026-07': archonCorpusPath },
      },
      generatedAt: '2026-07-29T00:00:00.000Z',
      outputDirectory,
    })
    const manifestPath = join(outputDirectory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { contracts: Record<string, unknown>[] }
    manifest.contracts.push({ ...manifest.contracts[0], file: 'unexpected.json' })
    await writeFile(manifestPath, deterministicJson(manifest))

    await expect(validateContractResources(outputDirectory)).resolves.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/exactly one.*archon-2026-07/i),
        expect.stringMatching(/unexpected\.json/i),
      ]),
    )
  })
})
