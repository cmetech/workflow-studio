import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../contract/canonical-json'
import { loadResourceResolutionContract, loadResourceResolutionVectors } from './resource-contract-loader'
import { loadBundledResourceResolution } from './bundled-package-contract'

const contractPath = 'contracts/workflow-package-resource-resolution-v1.json'
const vectorsPath = 'contracts/workflow-package-resource-resolution-v1-vectors.json'

async function candidate(change: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(await readFile(contractPath, 'utf8')) as Record<string, unknown>
  change(value)
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return { bytes, source: { sha256: await sha256Hex(bytes) } }
}

describe('resource resolution artifact boundary', () => {
  it('loads the pinned resources offline without importing the sibling repository', async () => {
    const result = await loadBundledResourceResolution()
    expect(result.contract.contract_id).toBe('workflow-package-resource-resolution')
    expect(result.vectors.contract_version).toBe(result.contract.contract_version)
  })
  it('retains compiler and runtime rules separately in an immutable projection', async () => {
    const bytes = await readFile(contractPath)
    const result = await loadResourceResolutionContract(bytes, { sha256: await sha256Hex(bytes) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.contract.candidate_rules['compiler-source'].command).not.toEqual(
      result.contract.candidate_rules.runtime.command,
    )
    expect(Object.isFrozen(result.contract.candidate_rules['compiler-source'].command)).toBe(true)
    expect(result.contract.coverage.full_portability).toBe(false)
  })

  it('rejects altered bytes and parses only the snapshot that was hashed', async () => {
    const bytes = new Uint8Array(await readFile(contractPath))
    const sha256 = await sha256Hex(bytes)
    const loading = loadResourceResolutionContract(bytes, { sha256 })
    bytes.fill(0)
    expect(await loading).toMatchObject({ ok: true })
    expect(await loadResourceResolutionContract(bytes, { sha256 })).toMatchObject({
      ok: false,
      code: 'digest_mismatch',
    })
  })

  it('fails closed on unsupported versions or operations even with matching fixture hashes', async () => {
    const version = await candidate((value) => {
      value.contract_version = 2
    })
    expect(await loadResourceResolutionContract(version.bytes, version.source)).toMatchObject({
      ok: false,
      code: 'unsupported_contract',
    })
    const operation = await candidate((value) => {
      const rules = value.candidate_rules as { 'compiler-source': { command: { operation: string }[] } }
      rules['compiler-source'].command[0]!.operation = 'execute'
    })
    expect(await loadResourceResolutionContract(operation.bytes, operation.source)).toMatchObject({
      ok: false,
      code: 'invalid_schema',
    })
  })

  it('retains successful compilation bindings and all upstream vector families', async () => {
    const bytes = await readFile(vectorsPath)
    const result = await loadResourceResolutionVectors(bytes, { sha256: await sha256Hex(bytes) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.vectors.compilation).toContainEqual(
      expect.objectContaining({
        id: 'included-origin',
        expected: expect.objectContaining({ resources: expect.any(Array) }),
      }),
    )
    expect(Object.isFrozen(result.vectors.lookup)).toBe(true)
    for (const family of [
      'lookup',
      'compilation',
      'discriminator',
      'mcp_candidates',
      'admission',
      'filesystem_recipes',
    ]) {
      expect(result.vectors[family]).toEqual(expect.any(Array))
    }
  })

  it.each(['admission', 'filesystem_recipes'])('rejects a missing %s vector family', async (family) => {
    const value = JSON.parse(await readFile(vectorsPath, 'utf8')) as Record<string, unknown>
    delete value[family]
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    expect(await loadResourceResolutionVectors(bytes, { sha256: await sha256Hex(bytes) })).toMatchObject({
      ok: false,
      code: 'invalid_schema',
    })
  })
})
