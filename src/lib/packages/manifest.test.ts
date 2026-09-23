import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadBundledWorkflowPackageContract,
  loadBundledWorkflowPackageVectors,
} from '../package-contract/bundled-package-contract'
import type { WorkflowPackageContract } from '../package-contract/types'
import { parsePackageManifest } from './manifest'

let contract: WorkflowPackageContract
let valid: Record<string, unknown>
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
  valid = (await loadBundledWorkflowPackageVectors()).validationVectors.find((v) => v.name === 'manifest_valid')!
    .value as Record<string, unknown>
})
function parse(value: unknown) {
  return parsePackageManifest(JSON.stringify(value), 'packages/test/workflow-package.json', contract)
}

describe('package manifest acceptance', () => {
  it('matches all upstream manifest validation vectors and diagnostic codes', async () => {
    const vectors = (await loadBundledWorkflowPackageVectors()).validationVectors.filter(
      (v) => v.document === 'workflow-package.json',
    )
    for (const vector of vectors) {
      const expected = vector.expected as { accepted: boolean; diagnosticCode?: string }
      const result = parse(vector.value)
      expect(result.ok, vector.name).toBe(expected.accepted)
      if (!expected.accepted)
        expect(
          result.findings.map((f) => f.code),
          vector.name,
        ).toContain(expected.diagnosticCode)
    }
  })

  it('preserves forbidden unknown values in the raw document while rejecting structured use', () => {
    const result = parse({ ...valid, unknownField: { retain: 'me' } })
    expect(result.ok).toBe(false)
    expect(result.rawDocument).toMatchObject({ unknownField: { retain: 'me' } })
  })

  it.each([
    { displayName: ' leading' },
    { publisher: 'publisher\u001c' },
    { tags: ['support', 'support'] },
    { workflows: [{ definition: 'workflows/stra\u00dfe.yaml' }, { definition: 'workflows/STRASSE.yaml' }] },
    { workflows: [{ definition: 'workflows/main.yaml', companion: 'workflows/MAIN.yaml' }] },
    { workflows: [{ definition: 'main.txt' }] },
    { version: '1.2.3\n' },
    { externalRequirements: { runtimes: ['uv', 'uv'], tools: [], providers: [], services: [], secrets: [] } },
  ])('rejects semantic defects not necessarily covered by JSON Schema: %j', (change) => {
    expect(parse({ ...valid, ...change })).toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: 'package_manifest_invalid' })],
    })
  })

  it.each(['../outside.yaml', 'folder/C:outside.yaml', 'cafe\u0301.yaml', '\ud800.yaml'])(
    'rejects unsafe member %s before projection',
    (definition) => {
      expect(parse({ ...valid, workflows: [{ definition }] }).ok).toBe(false)
    },
  )

  it('rejects duplicate JSON keys, including escape-equivalent keys in nested objects', () => {
    const canonical = JSON.stringify(valid)
    for (const text of [
      canonical.replace('"id":', '"id":"overwritten","id":'),
      canonical.replace('"runtimes":', '"\\u0072untimes":[],"runtimes":'),
    ]) {
      // Removing duplicate-key evidence with JSON.parse leaves a schema-valid manifest.
      expect(parse(JSON.parse(text)).ok).toBe(true)
      expect(parsePackageManifest(text, 'workflow-package.json', contract)).toMatchObject({ ok: false })
    }
  })

  it('retains valid supplementary Unicode metadata and freezes its projection', () => {
    const result = parse({ ...valid, displayName: 'Support \ud83d\ude80' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('fixture must be valid')
    expect(Object.isFrozen(result.manifest.workflows)).toBe(true)
  })

  it('enforces package byte limits independently of standalone workflow limits', () => {
    const text = ' '.repeat(contract.resource_rules.max_file_bytes + 1)
    expect(parsePackageManifest(text, 'workflow-package.json', contract)).toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: 'package_file_size_limit' })],
    })
  })
})
