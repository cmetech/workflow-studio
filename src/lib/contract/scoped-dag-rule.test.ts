import { describe, expect, it } from 'vitest'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from './contract-loader'
import { readScopedDagCapabilities } from './scoped-dag-rule'

async function archonContract() {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled' as const,
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  return loaded.contract
}

describe('scoped DAG capability reader', () => {
  it('reads the exact Hermes v6 loop-group descriptors without inferring fields', async () => {
    const capabilities = readScopedDagCapabilities(await archonContract())

    expect(capabilities.groupKind).toBe('loop_group')
    expect(capabilities.bodyPath).toEqual(['loop_group', 'nodes'])
    expect(capabilities.primarySink).toBe('first-terminal-in-definition-order')
    expect(capabilities.allowedNodeKinds).toEqual(['command', 'prompt', 'bash', 'script', 'loop', 'approval', 'cancel'])
    expect(capabilities.previousIteration.prefix).toBe('$LOOP_PREV.')
  })

  it('refuses visual authoring when a required scoped output capability is absent', async () => {
    const contract = await archonContract()
    const withoutReferences = {
      ...contract,
      semantic_rules: contract.semantic_rules.filter((rule) => rule.id !== 'scoped-output-reference-v1'),
    }

    expect(() => readScopedDagCapabilities(withoutReferences)).toThrow(/scoped output reference capability/i)
  })
})
