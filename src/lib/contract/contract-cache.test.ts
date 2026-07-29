import { describe, expect, it, vi } from 'vitest'
import archonFixtureText from '../../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
import legacyFixtureText from '../../../tests/fixtures/contracts/minimal-legacy-v1.json?raw'
import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
import { createContractCache } from './contract-cache'
import { loadAuthoringContract } from './contract-loader'
import type { AuthoringContract } from './types'
import type { ContractCacheStoredEntry } from './contract-cache'

async function signedFixture(overrides: Record<string, unknown> = {}): Promise<Uint8Array> {
  const envelope = { ...(JSON.parse(archonFixtureText) as Record<string, unknown>), ...overrides }
  envelope.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(envelope))}`
  return new TextEncoder().encode(JSON.stringify(envelope))
}

async function bundled(): Promise<readonly AuthoringContract[]> {
  const contracts = await Promise.all(
    [archonFixtureText, legacyFixtureText].map(async (text, index) => {
      const result = await loadAuthoringContract(new TextEncoder().encode(text), {
        kind: 'bundled',
        identifier: `bundled-${index}`,
      })
      if (!result.ok) throw new Error(result.message)
      return result.contract
    }),
  )
  return contracts
}

async function storedFixture(
  overrides: Record<string, unknown> = {},
  active = false,
): Promise<ContractCacheStoredEntry> {
  const content = new TextDecoder().decode(await signedFixture(overrides))
  const payload = JSON.parse(content) as {
    contract_digest: `sha256:${string}`
    profile: 'archon-2026-07'
    schema_version: number
    normalizer_version: number
    contract_reader_version: number
  }
  return {
    digest: payload.contract_digest,
    profile: payload.profile,
    schemaVersion: payload.schema_version,
    normalizerVersion: payload.normalizer_version,
    readerVersion: payload.contract_reader_version,
    source: { kind: 'user', identifier: '/cached/contract.json' },
    content,
    active,
  }
}

describe('contract cache activation', () => {
  it('fails open to bundled contracts and a bounded advisory when the native cache index cannot load', async () => {
    const cache = createContractCache({
      bundled: await bundled(),
      native: {
        contractCacheLoad: async () => Promise.reject(new Error('malformed index included secret cache content')),
        contractCacheWrite: async () => undefined,
      },
      activate: async () => true,
    })

    await expect(cache.hydrate()).resolves.toBeUndefined()

    expect(cache.activeContract('hermes-legacy')).toBeDefined()
    expect(cache.activeContract('archon-2026-07')).toBeDefined()
    expect(cache.listAdvisories()).toEqual([expect.objectContaining({ code: 'contract_cache_load_failed' })])
    expect(cache.listAdvisories()[0]?.message).not.toContain('secret')
  })

  it('skips corrupt cached envelopes individually, retains a good active entry, and rewrites only validated data', async () => {
    const good = await storedFixture({ normalizer_version: 2 }, true)
    const digestMismatch = { ...(await storedFixture({ normalizer_version: 3 })), content: good.content }
    const invalidContract = { ...(await storedFixture({ normalizer_version: 4 })), content: '{"profile":' }
    const writes: ContractCacheStoredEntry[][] = []
    const activate = vi.fn(async () => true)
    const cache = createContractCache({
      bundled: await bundled(),
      native: {
        contractCacheLoad: async () => ({
          entries: [digestMismatch, good, invalidContract],
          advisories: [{ code: 'contract_cache_blob_missing' }],
        }),
        contractCacheWrite: async (entries) => {
          writes.push([...entries])
        },
      },
      activate,
    })

    await expect(cache.hydrate()).resolves.toBeUndefined()

    expect(cache.activeContract('archon-2026-07')?.contract_digest).toBe(good.digest)
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ contract_digest: good.digest }))
    expect(cache.listAuthoringContracts()).toContainEqual(expect.objectContaining({ contract_digest: good.digest }))
    expect(cache.listAuthoringContracts()).not.toContainEqual(
      expect.objectContaining({ contract_digest: digestMismatch.digest }),
    )
    expect(writes.at(-1)).toEqual([expect.objectContaining({ digest: good.digest, active: true })])
    expect(cache.listAdvisories().map(({ code }) => code)).toEqual(
      expect.arrayContaining(['contract_cache_blob_missing', 'contract_cache_entry_invalid']),
    )
  })

  it('keeps every bundled profile available while imported contracts are cached by profile, schema, and digest', async () => {
    const writes: { digest: string; content: string }[][] = []
    const cache = createContractCache({
      bundled: await bundled(),
      native: {
        contractCacheLoad: async () => [],
        contractCacheWrite: async (entries) => {
          writes.push([...entries])
        },
      },
      activate: async () => true,
    })

    const imported = await cache.importBytes(await signedFixture({ normalizer_version: 2 }), {
      kind: 'user',
      identifier: '/chosen/archon.json',
    })

    expect(imported).toMatchObject({
      status: 'cached',
      profile: 'archon-2026-07',
      schemaVersion: 1,
      normalizerVersion: 2,
    })
    expect(cache.listCachedContracts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'bundled', profile: 'archon-2026-07', active: true }),
        expect.objectContaining({ status: 'bundled', profile: 'hermes-legacy' }),
        expect.objectContaining({ status: 'cached', digest: imported.digest, schemaVersion: 1 }),
      ]),
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]?.digest).toBe(imported.digest)
  })

  it('does not duplicate an immutable cache entry when the same digest is imported twice', async () => {
    const cache = createContractCache({
      bundled: await bundled(),
      native: { contractCacheLoad: async () => [], contractCacheWrite: async () => undefined },
      activate: async () => true,
    })
    const bytes = await signedFixture({ normalizer_version: 2 })

    const first = await cache.importBytes(bytes, { kind: 'user', identifier: '/one.json' })
    const second = await cache.importBytes(bytes, { kind: 'cli', identifier: '/bin/hermes' })

    expect(second.digest).toBe(first.digest)
    expect(cache.listCachedContracts().filter((entry) => entry.digest === first.digest)).toHaveLength(1)
  })

  it('does not add a cached copy when an imported digest already belongs to a bundled contract', async () => {
    const writes: unknown[] = []
    const cache = createContractCache({
      bundled: await bundled(),
      native: {
        contractCacheLoad: async () => [],
        contractCacheWrite: async (entries) => {
          writes.push(entries)
        },
      },
      activate: async () => true,
    })

    const imported = await cache.importBytes(new TextEncoder().encode(archonFixtureText), {
      kind: 'user',
      identifier: '/bundled-copy.json',
    })

    expect(imported).toMatchObject({ status: 'bundled' })
    expect(writes).toEqual([])
  })

  it('lists unsupported reader contracts for inspection without allowing activation', async () => {
    const cache = createContractCache({
      bundled: await bundled(),
      native: { contractCacheLoad: async () => [], contractCacheWrite: async () => undefined },
      activate: async () => true,
    })
    const bytes = await signedFixture({ contract_reader_version: 2 })

    const imported = await cache.importBytes(
      bytes,
      { kind: 'user', identifier: '/future.json' },
      { cacheUnsupported: true },
    )

    expect(imported).toMatchObject({ status: 'cached', canActivate: false, readerVersion: 2 })
    await expect(cache.activateContract(imported.digest, 'archon-2026-07')).resolves.toMatchObject({
      ok: false,
      code: 'contract_reader_unsupported',
    })
  })

  it('never writes an imported payload whose declared digest does not match its content', async () => {
    const writes: unknown[] = []
    const cache = createContractCache({
      bundled: await bundled(),
      native: {
        contractCacheLoad: async () => [],
        contractCacheWrite: async (entries) => {
          writes.push(entries)
        },
      },
      activate: async () => true,
    })
    const tampered = JSON.parse(archonFixtureText) as Record<string, unknown>
    tampered.contract_digest = `sha256:${'0'.repeat(64)}`

    await expect(
      cache.importBytes(new TextEncoder().encode(JSON.stringify(tampered)), {
        kind: 'user',
        identifier: '/tampered.json',
      }),
    ).rejects.toMatchObject({ code: 'contract_digest_mismatch' })
    expect(writes).toEqual([])
  })

  it('activates a newer normalizer only for the contract profile it declares', async () => {
    const cache = createContractCache({
      bundled: await bundled(),
      native: { contractCacheLoad: async () => [], contractCacheWrite: async () => undefined },
      activate: async () => true,
    })
    const imported = await cache.importBytes(await signedFixture({ normalizer_version: 3 }), {
      kind: 'user',
      identifier: '/archon-v3.json',
    })

    await expect(cache.activateContract(imported.digest, 'hermes-legacy')).resolves.toMatchObject({
      ok: false,
      code: 'contract_profile_mismatch',
    })
    await expect(cache.activateContract(imported.digest, 'archon-2026-07')).resolves.toMatchObject({ ok: true })
  })

  it('reverts an active cached contract to its bundled profile before removing it', async () => {
    const cache = createContractCache({
      bundled: await bundled(),
      native: { contractCacheLoad: async () => [], contractCacheWrite: async () => undefined },
      activate: async () => true,
    })
    const imported = await cache.importBytes(await signedFixture({ normalizer_version: 2 }), {
      kind: 'user',
      identifier: '/archon-v2.json',
    })
    await cache.activateContract(imported.digest, 'archon-2026-07')

    await cache.removeContract(imported.digest)

    expect(
      cache.listCachedContracts().find((entry) => entry.profile === 'archon-2026-07' && entry.active),
    ).toMatchObject({
      status: 'bundled',
    })
    expect(cache.listCachedContracts()).not.toContainEqual(
      expect.objectContaining({ digest: imported.digest, status: 'cached' }),
    )
  })

  it('retains the previous active contract when the acknowledged editor activation returns false', async () => {
    const cache = createContractCache({
      bundled: await bundled(),
      native: { contractCacheLoad: async () => [], contractCacheWrite: async () => undefined },
      activate: async () => false,
    })
    const imported = await cache.importBytes(await signedFixture({ normalizer_version: 2 }), {
      kind: 'cli',
      identifier: '/Applications/Hermes',
    })

    await expect(cache.activateContract(imported.digest, 'archon-2026-07')).resolves.toMatchObject({
      ok: false,
      code: 'contract_activation_failed',
    })
    expect(
      cache.listCachedContracts().find((entry) => entry.profile === 'archon-2026-07' && entry.active),
    ).toMatchObject({
      status: 'bundled',
    })
    expect(cache.listCachedContracts().find((entry) => entry.digest === imported.digest)).toMatchObject({
      provenance: { kind: 'cli', identifier: '/Applications/Hermes' },
    })
  })

  it('hydrates a cached contract into the durable registry and restores its active profile selection', async () => {
    const importedBytes = await signedFixture({ normalizer_version: 2 })
    let persisted: readonly import('./contract-cache').ContractCacheStoredEntry[] = []
    const writer = createContractCache({
      bundled: await bundled(),
      native: {
        contractCacheLoad: async () => [],
        contractCacheWrite: async (entries) => {
          persisted = entries
        },
      },
      activate: async () => true,
    })
    const imported = await writer.importBytes(importedBytes, { kind: 'cli', identifier: '/Applications/Hermes' })
    await writer.activateContract(imported.digest, 'archon-2026-07')
    const restarted = createContractCache({
      bundled: await bundled(),
      native: { contractCacheLoad: async () => persisted, contractCacheWrite: async () => undefined },
      activate: async () => true,
    })

    await restarted.hydrate()

    expect(restarted.listAuthoringContracts()).toContainEqual(
      expect.objectContaining({ contract_digest: imported.digest }),
    )
    expect(restarted.activeContract('archon-2026-07')).toMatchObject({ contract_digest: imported.digest })
  })
})
