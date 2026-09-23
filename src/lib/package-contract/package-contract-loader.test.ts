import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../contract/canonical-json'
import { loadWorkflowPackageContract, loadWorkflowPackageVectors } from './package-contract-loader'
import { loadBundledWorkflowPackageContract } from './bundled-package-contract'

const contractPath = 'contracts/workflow-package-v1.json'
const vectorsPath = 'contracts/workflow-package-v1-vectors.json'
const contractHash = 'e728d99608e9186a08fc2b866cdaa9f116d8f51c5cde68930a82ef79d398e30d'
const vectorsHash = '644055e4234837f3e42ccaa952ed1622cf67edc96db69e983556580fb6ce82ed'

async function candidate(change: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(await readFile(contractPath, 'utf8')) as Record<string, unknown>
  change(value)
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return { bytes, source: { sha256: await sha256Hex(bytes) } }
}

describe('portable package contract boundary', () => {
  it('parses the same byte snapshot it hashes even if the caller mutates its buffer', async () => {
    const bytes = new Uint8Array(await readFile(contractPath))
    const loading = loadWorkflowPackageContract(bytes, { sha256: contractHash })
    bytes.fill(0)
    expect(await loading).toMatchObject({ ok: true, contract: { contract_version: 1 } })
  })

  it('loads the exact bundled contract offline and freezes nested rules', async () => {
    const contract = await loadBundledWorkflowPackageContract()
    expect(contract.contract_version).toBe(1)
    expect(contract.resource_rules.max_files).toBe(512)
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(contract.digest_rules.excluded_paths)).toBe(true)
    expect(() => Reflect.set(contract.resource_rules, 'max_files', 1000)).not.toThrow()
    expect(contract.resource_rules.max_files).toBe(512)
  })

  it('rejects byte changes even when parsed JSON is unchanged', async () => {
    const original = await readFile(contractPath)
    expect(await loadWorkflowPackageContract(original, { sha256: contractHash })).toMatchObject({ ok: true })
    expect(
      await loadWorkflowPackageContract(Buffer.concat([original, Buffer.from(' ')]), { sha256: contractHash }),
    ).toMatchObject({ ok: false, code: 'digest_mismatch' })
  })

  it('rejects a newer version independently of provenance checking', async () => {
    const { bytes, source } = await candidate((value) => {
      value.contract_version = 2
    })
    expect(await loadWorkflowPackageContract(bytes, source)).toMatchObject({ ok: false, code: 'unsupported_contract' })
  })

  it.each([
    [
      'missing schema',
      (value: Record<string, unknown>) => {
        delete value.digests_schema
      },
    ],
    [
      'invalid schema',
      (value: Record<string, unknown>) => {
        value.package_manifest_schema = { type: 'nonsense' }
      },
    ],
    [
      'invented resolver list',
      (value: Record<string, unknown>) => {
        value.resource_rules = []
      },
    ],
    [
      'unknown field',
      (value: Record<string, unknown>) => {
        value.contract_digest = 'invented'
      },
    ],
    [
      'unsupported digest ordering',
      (value: Record<string, unknown>) => {
        ;(value.digest_rules as Record<string, unknown>).ordering = 'locale'
      },
    ],
  ])('rejects %s with matching fixture provenance', async (_, change) => {
    const { bytes, source } = await candidate(change)
    expect(await loadWorkflowPackageContract(bytes, source)).toMatchObject({ ok: false, code: 'invalid_schema' })
  })

  it('rejects malformed JSON and invalid UTF-8 without throwing', async () => {
    for (const bytes of [new TextEncoder().encode('{'), new Uint8Array([0xff])]) {
      expect(await loadWorkflowPackageContract(bytes, { sha256: await sha256Hex(bytes) })).toMatchObject({
        ok: false,
        code: 'invalid_schema',
      })
    }
  })

  it('loads all vector families without flattening boundary recipes', async () => {
    const result = await loadWorkflowPackageVectors(await readFile(vectorsPath), { sha256: vectorsHash })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.vectors.digestVectors.some((vector) => vector.name === 'utf8')).toBe(true)
    expect(result.vectors.boundaryVectors.some((vector) => typeof vector.recipe === 'object')).toBe(true)
    expect(Object.isFrozen(result.vectors.pathVectors)).toBe(true)
  })

  it('rejects missing vector families and mismatched vector provenance', async () => {
    const bytes = new TextEncoder().encode('{"contractVersion":1,"digestVectors":[]}')
    expect(await loadWorkflowPackageVectors(bytes, { sha256: await sha256Hex(bytes) })).toMatchObject({
      ok: false,
      code: 'invalid_schema',
    })
    expect(await loadWorkflowPackageVectors(await readFile(vectorsPath), { sha256: '0'.repeat(64) })).toMatchObject({
      ok: false,
      code: 'digest_mismatch',
    })
  })
})
