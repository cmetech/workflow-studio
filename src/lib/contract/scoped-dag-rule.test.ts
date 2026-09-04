import { describe, expect, it } from 'vitest'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from './contract-loader'
import { readScopedDagCapabilities, requiresScopedDagCapabilities } from './scoped-dag-rule'
import type { ContractDocumentKind, WorkflowProfile } from './types'

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

  it('refuses activation when any published scoped semantic parameter changes', async () => {
    const contract = await archonContract()
    const semantic_rules = contract.semantic_rules.map((rule) =>
      rule.id === 'scoped-dag-topology-v1' ? { ...rule, parameters: { ...rule.parameters, max_nodes: 513 } } : rule,
    )

    expect(() => readScopedDagCapabilities({ ...contract, semantic_rules })).toThrow(/unsupported/i)
  })

  it.each([
    [
      'applies only to a different profile',
      (contract: Awaited<ReturnType<typeof archonContract>>) => ({
        ...contract,
        node_kinds: contract.node_kinds.map((nodeKind) =>
          nodeKind.id === 'loop_group'
            ? { ...nodeKind, applicability: { ...nodeKind.applicability, profiles: ['hermes-legacy'] as const } }
            : nodeKind,
        ),
      }),
      'archon-2026-07',
      'definition',
    ],
    [
      'is evaluated for the sidecar document',
      (contract: Awaited<ReturnType<typeof archonContract>>) => contract,
      'archon-2026-07',
      'sidecar',
    ],
    [
      'is deferred',
      (contract: Awaited<ReturnType<typeof archonContract>>) => ({
        ...contract,
        node_kinds: contract.node_kinds.map((nodeKind) =>
          nodeKind.id === 'loop_group' ? { ...nodeKind, status: 'deferred' as const } : nodeKind,
        ),
      }),
      'archon-2026-07',
      'definition',
    ],
    [
      'is deprecated',
      (contract: Awaited<ReturnType<typeof archonContract>>) => ({
        ...contract,
        node_kinds: contract.node_kinds.map((nodeKind) =>
          nodeKind.id === 'loop_group' ? { ...nodeKind, status: 'deprecated' as const } : nodeKind,
        ),
      }),
      'archon-2026-07',
      'definition',
    ],
  ])('does not require scoped capabilities when the loop-group descriptor %s', async (_, change, profile, document) => {
    expect(
      requiresScopedDagCapabilities(
        change(await archonContract()),
        profile as WorkflowProfile,
        document as ContractDocumentKind,
      ),
    ).toBe(false)
  })

  it('requires scoped capabilities for an applicable supported loop-group descriptor', async () => {
    expect(requiresScopedDagCapabilities(await archonContract(), 'archon-2026-07', 'definition')).toBe(true)
  })
})
