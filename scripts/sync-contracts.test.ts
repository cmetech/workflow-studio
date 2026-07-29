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

  it('validates both envelopes before atomically replacing deterministic resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workflow-studio-contracts-'))
    const legacyPath = join(directory, 'legacy-input.json')
    const archonPath = join(directory, 'archon-input.json')
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, JSON.stringify(await envelope('archon-2026-07')))

    await syncContracts({
      source: { kind: 'files', files: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath } },
      generatedAt: '2026-07-29T00:00:00.000Z',
      outputDirectory,
    })

    const legacyText = await readFile(join(outputDirectory, 'hermes-legacy-v1.json'), 'utf8')
    const manifestText = await readFile(join(outputDirectory, 'manifest.json'), 'utf8')
    expect(legacyText.endsWith('\n')).toBe(true)
    expect(legacyText.indexOf('"contract_digest"')).toBeLessThan(legacyText.indexOf('"profile"'))
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
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, '{"profile":"archon-2026-07"}')

    await expect(
      syncContracts({
        source: { kind: 'files', files: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath } },
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
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, JSON.stringify(await envelope('archon-2026-07')))
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
          source: { kind: 'files', files: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath } },
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
    const outputDirectory = join(directory, 'output')
    await writeFile(legacyPath, JSON.stringify(await envelope('hermes-legacy')))
    await writeFile(archonPath, JSON.stringify(await envelope('archon-2026-07')))
    await syncContracts({
      source: { kind: 'files', files: { 'hermes-legacy': legacyPath, 'archon-2026-07': archonPath } },
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
