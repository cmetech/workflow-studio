import { describe, expect, it, vi } from 'vitest'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import archonFixtureText from '../../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
import legacyFixtureText from '../../../tests/fixtures/contracts/minimal-legacy-v1.json?raw'
import type { ContractSource } from './types'
import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
import { loadAuthoringContract } from './contract-loader'

const fixtures = {
  archon: new TextEncoder().encode(archonFixtureText),
  legacy: new TextEncoder().encode(legacyFixtureText),
}

const source: ContractSource = { kind: 'bundled', identifier: 'test-contract' }

async function encodeSigned(envelope: Record<string, unknown>): Promise<Uint8Array> {
  envelope.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(envelope))}`
  return new TextEncoder().encode(JSON.stringify(envelope))
}

async function signedBytes(overrides: Record<string, unknown> = {}): Promise<Uint8Array> {
  return encodeSigned({
    ...(JSON.parse(archonFixtureText) as Record<string, unknown>),
    ...overrides,
  })
}

describe('authoring contract loader', () => {
  it.each([
    ['archon-2026-07', fixtures.archon],
    ['hermes-legacy', fixtures.legacy],
  ])('loads the supported %s profile', async (profile, bytes) => {
    const result = await loadAuthoringContract(bytes, source)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contract.profile).toBe(profile)
      expect(result.contract.schema_version).toBe(1)
      expect(result.contract.contract_reader_version).toBe(1)
    }
  })

  it('returns stable digest and source provenance for byte-identical input', async () => {
    const first = await loadAuthoringContract(fixtures.archon, source)
    const second = await loadAuthoringContract(fixtures.archon, source)

    expect(first).toEqual(second)
    if (first.ok) {
      expect(first.source).toBe(source)
      expect(first.contract.contract_digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it('rejects a digest that does not match the canonical payload', async () => {
    const bytes = await signedBytes()
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    envelope.contract_digest = `sha256:${'0'.repeat(64)}`

    await expect(
      loadAuthoringContract(new TextEncoder().encode(JSON.stringify(envelope)), source),
    ).resolves.toMatchObject({
      ok: false,
      code: 'contract_digest_mismatch',
    })
  })

  it.each([
    ['schema_version', 2],
    ['contract_reader_version', 2],
  ])('rejects unsupported %s', async (field, value) => {
    const result = await loadAuthoringContract(await signedBytes({ [field]: value }), source)

    expect(result).toMatchObject({ ok: false, code: 'contract_reader_unsupported' })
  })

  it('rejects an unknown profile', async () => {
    const result = await loadAuthoringContract(await signedBytes({ profile: 'future-profile' }), source)

    expect(result).toMatchObject({ ok: false, code: 'contract_profile_unsupported' })
  })

  it.each(['definition_schema', 'sidecar_schema'])('rejects a missing %s', async (field) => {
    const envelope = JSON.parse(archonFixtureText) as Record<string, unknown>
    delete envelope[field]
    const result = await loadAuthoringContract(await encodeSigned(envelope), source)

    expect(result).toMatchObject({ ok: false, code: 'contract_shape_invalid' })
  })

  it('preserves unknown top-level keys only as reader extensions', async () => {
    const result = await loadAuthoringContract(fixtures.archon, source)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contract.extensions).toEqual({
        'x-workflow-studio-fixture': { test_fixture: true },
      })
      expect(result.contract).not.toHaveProperty('x-workflow-studio-fixture')
    }
  })

  it('normalizes uppercase digest hex after comparison', async () => {
    const envelope = JSON.parse(new TextDecoder().decode(await signedBytes())) as Record<string, unknown>
    envelope.contract_digest = String(envelope.contract_digest).toUpperCase().replace('SHA256:', 'sha256:')
    const result = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(envelope)), source)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contract.contract_digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it('does not call network or native capabilities while loading', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const hostHealth = vi.fn(() => Promise.reject(new Error('native access is forbidden')))
    setNativeBridgeForTest({ hostHealth })

    try {
      await loadAuthoringContract(fixtures.archon, source)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(hostHealth).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      setNativeBridgeForTest(undefined)
    }
  })
})

describe('canonical contract JSON', () => {
  it('omits the digest, recursively sorts object keys, and preserves array order', () => {
    expect(
      canonicalizeContractPayload({
        z: [{ b: 2, a: 1 }, 3],
        contract_digest: 'sha256:not-part-of-the-payload',
        a: { d: false, c: null },
      }),
    ).toBe('{"a":{"c":null,"d":false},"z":[{"a":1,"b":2},3]}')
  })
})
