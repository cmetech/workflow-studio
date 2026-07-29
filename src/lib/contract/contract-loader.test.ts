import { describe, expect, it, vi } from 'vitest'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import archonFixtureText from '../../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
import legacyFixtureText from '../../../tests/fixtures/contracts/minimal-legacy-v1.json?raw'
import type { ContractSource } from './types'
import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
import { loadAuthoringContract } from './contract-loader'
import { isBundledContractResource, loadBundledAuthoringContracts } from './bundled-contracts'

const fixtures = {
  archon: new TextEncoder().encode(archonFixtureText),
  legacy: new TextEncoder().encode(legacyFixtureText),
}

const source: ContractSource = { kind: 'bundled', identifier: 'test-contract' }
const fixtureApplicability = {
  profiles: ['archon-2026-07'],
  documents: ['definition'],
}
const fixtureField = {
  id: 'fixture-field',
  label: 'Fixture field',
  description: 'Reader-only fixture field',
  field_path: 'nodes[].fixture',
  applicability: fixtureApplicability,
  widget: 'text',
  section: 'fixture',
  order: 1,
  status: 'supported',
  examples: [],
}
const fixtureNodeKind = {
  ...fixtureField,
  id: 'fixture-node',
  label: 'Fixture node',
  fields: [fixtureField],
}

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
  it('loads both production resources and excludes the manifest from the contract source set', async () => {
    expect(isBundledContractResource('/contracts/manifest.json')).toBe(false)
    expect(isBundledContractResource('/contracts/hermes-legacy-v1.json')).toBe(true)
    await expect(loadBundledAuthoringContracts()).resolves.toEqual([
      expect.objectContaining({ profile: 'archon-2026-07' }),
      expect.objectContaining({ profile: 'hermes-legacy' }),
    ])
  })

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

  it.each([
    ['null node-kind descriptor', { node_kinds: [null] }],
    ['incomplete semantic-rule descriptor', { semantic_rules: [{}] }],
    ['null compatibility descriptor', { compatibility_codes: { FIXTURE_INVALID: null } }],
    ['incomplete documentation', { documentation: {} }],
    [
      'malformed descriptor applicability',
      { node_kinds: [{ ...fixtureNodeKind, applicability: { profiles: [], documents: [null] } }] },
    ],
    ['malformed nested field descriptor', { node_kinds: [{ ...fixtureNodeKind, fields: [{}] }] }],
  ])('rejects a %s', async (_case, overrides) => {
    const result = await loadAuthoringContract(await signedBytes(overrides), source)

    expect(result).toMatchObject({ ok: false, code: 'contract_shape_invalid' })
  })

  it('returns a shape failure when canonicalization rejects numeric overflow', async () => {
    const overflowJson = archonFixtureText.replace('"test_fixture": true', '"test_fixture": 1e400')

    await expect(loadAuthoringContract(new TextEncoder().encode(overflowJson), source)).resolves.toMatchObject({
      ok: false,
      code: 'contract_shape_invalid',
    })
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
