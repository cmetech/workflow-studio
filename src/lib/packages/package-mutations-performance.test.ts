import { beforeAll, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { createBrowserBridge } from '../native/browser-bridge'
import { loadBundledAuthoringContracts } from '../contract/bundled-contracts'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '../package-contract/bundled-package-contract'
import { capturePackageAnalysis } from '../../features/packages/package-analysis'
import { analyzeCapturedPackage } from '../../features/packages/package-analysis-pure'
import { analyzeWorkflowPair } from '../validation/analyze-workflow'
import type { MutationAnalyzer } from '../documents/transactions'
import manifest from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json'
import { planPackageMutation, type PackageMutationContext } from './package-mutations'

vi.mock('../validation/analyze-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validation/analyze-workflow')>()
  return { ...actual, analyzeWorkflowPair: vi.fn(actual.analyzeWorkflowPair) }
})
let contracts: Pick<PackageMutationContext, 'contract' | 'resourceContract' | 'authoring'>
beforeAll(async () => {
  contracts = {
    contract: await loadBundledWorkflowPackageContract(),
    resourceContract: (await loadBundledResourceResolution()).contract,
    authoring: await loadBundledAuthoringContracts(),
  }
})

it('routes shared-reference validation through the supplied worker analyzer with linear work', async () => {
  const memberCount = 3,
    consumersPerMember = 3
  const members = Array.from({ length: memberCount }, (_, index) => ({
    definition: `workflows/member${index}.yaml`,
    companion: `policy/member${index}.yaml`,
  }))
  const initialFiles: Record<string, string> = {
    'pkg/workflow-package.json': JSON.stringify({ ...manifest, workflows: members }),
    'pkg/commands/shared.md': 'Summarize the supplied text.\n',
    ...Object.fromEntries(
      members.flatMap((member, index) => [
        [
          'pkg/' + member.definition,
          stringify({
            name: `member${index}`,
            description: 'Shared command',
            nodes: Array.from({ length: consumersPerMember }, (_, node) => ({ id: `run${node}`, command: 'shared' })),
          }),
        ],
        ['pkg/' + member.companion, 'language_compatibility: archon-2026-07\n'],
      ]),
    ),
  }
  const native = createBrowserBridge({ initialFiles })
  const capture = await capturePackageAnalysis({
    ...contracts,
    native,
    packageRoot: 'pkg',
    analyze: analyzeCapturedPackage,
  })
  const actual = await vi.importActual<typeof import('../validation/analyze-workflow')>(
    '../validation/analyze-workflow',
  )
  const keys: string[] = []
  const analyzePair: MutationAnalyzer = vi.fn(async (pair, contract) => {
    keys.push(
      JSON.stringify([
        pair.workflowId,
        pair.generation,
        pair.definition.path,
        pair.definition.text,
        pair.definition.revision,
        pair.companion?.path,
        pair.companion?.text,
        pair.companion?.revision,
        contract.contract_digest,
      ]),
    )
    return actual.analyzeWorkflowPair(
      {
        type: 'analyze',
        requestId: 'worker-test-' + keys.length,
        workflowId: pair.workflowId,
        pairGeneration: pair.generation,
        definition: pair.definition,
        companion: pair.companion,
        profile: contract.profile,
        contractDigest: contract.contract_digest,
        reason: 'explicit-validate',
      },
      contract,
    )
  })
  vi.mocked(analyzeWorkflowPair).mockClear()
  const context = { ...contracts, capture, analyzePair }
  const preview = await planPackageMutation(context, {
    kind: 'rename-artifact',
    path: 'commands/shared.md',
    destination: 'commands/renamed.md',
  })
  expect(preview.referenceChanges).toHaveLength(memberCount * consumersPerMember)
  expect(analyzePair).toHaveBeenCalled()
  expect(analyzeWorkflowPair).not.toHaveBeenCalled()
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys.length).toBeLessThanOrEqual(2 * memberCount + 2 * memberCount * consumersPerMember)
  for (const member of members) {
    const write = preview.plan.writes.find((row) => row.relativePath === 'pkg/' + member.definition)
    expect(write?.text).toContain('renamed.md')
    expect(write?.text).not.toContain('command: shared')
  }
})
