import { validatePackageExample } from './package-example-analysis'
import type { WorkspaceFileEntry } from '$src/lib/workspace/types'
import type { PackageMutationPlan, WorkspaceTransactionResult } from '$src/lib/native/types'
import { expect, it, vi } from 'vitest'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import {
  loadBundledResourceResolution,
  loadBundledWorkflowPackageContract,
} from '$src/lib/package-contract/bundled-package-contract'
import { createPackageExampleCopy, loadPackageExampleCatalog } from './package-examples'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'

async function setup() {
  const native = {
    workspaceScan: vi.fn(async (): Promise<WorkspaceFileEntry[]> => []),
    workspaceReadTextArtifact: vi.fn(),
    workspaceApplyTransaction: vi
      .fn<(plan: PackageMutationPlan) => Promise<WorkspaceTransactionResult>>()
      .mockResolvedValue({
        status: 'committed',
        results: [],
      }),
  }
  return {
    workspaceId: 'workspace',
    contract: await loadBundledWorkflowPackageContract(),
    resourceContract: (await loadBundledResourceResolution()).contract,
    authoring: await loadBundledAuthoringContracts(),
    native,
    open: vi.fn(),
  }
}
it('loads complete read-only package examples including the laptop supporting artifacts', async () => {
  const examples = await loadPackageExampleCatalog()
  const laptop = examples.find((example) => example.id === 'laptop-diagnostic')!
  expect(laptop.readOnly).toBe(true)
  expect(laptop.files.map((file) => file.path)).toEqual(
    expect.arrayContaining([
      'workflow-package.json',
      'digests.json',
      'scripts/analyze-snapshot.py',
      'commands/interpret-report.md',
      'fixtures/laptop-snapshot.json',
    ]),
  )
  expect(
    examples
      .find((example) => example.id === 'multi-workflow-support')!
      .files.filter((file) => /workflows\/.*\.yaml$/.test(file.path)).length,
  ).toBeGreaterThan(1)
})
it('copies a complete validated package through one atomic transaction before opening it', async () => {
  const deps = await setup()
  const example = (await loadPackageExampleCatalog()).find((item) => item.id === 'laptop-diagnostic')!
  const result = await createPackageExampleCopy(example, deps)
  expect(deps.native.workspaceApplyTransaction).toHaveBeenCalledOnce()
  const plan = deps.native.workspaceApplyTransaction.mock.calls[0]![0]
  expect(plan.writes.map((write) => write.relativePath)).toEqual(
    example.files.map((file) => `${result.root}/${file.path}`),
  )
  expect(plan.writes.every((write) => write.expectedCurrentHash === null)).toBe(true)
  expect(deps.open).toHaveBeenCalledWith(result)
})
it('copies every destination through the real revision-checked bridge', async () => {
  const deps = await setup()
  const native = createBrowserBridge({ initialFiles: {} })
  const example = (await loadPackageExampleCatalog())[0]!
  const result = await createPackageExampleCopy(example, { ...deps, workspaceId: 'browser-workspace', native })
  for (const file of example.files)
    expect((await native.workspaceReadTextArtifact(result.root + '/' + file.path)).text).toBe(file.text)
  expect(deps.open).toHaveBeenCalledWith(result)
})
it('leaves opening and success reporting untouched when the atomic copy fails', async () => {
  const deps = await setup()
  deps.native.workspaceApplyTransaction.mockRejectedValue(new Error('package_transaction_failed'))
  const example = (await loadPackageExampleCatalog())[0]!
  await expect(createPackageExampleCopy(example, deps)).rejects.toThrow('package_transaction_failed')
  expect(deps.open).not.toHaveBeenCalled()
})

it('avoids existing package roots and IDs and regenerates digests after allocating a copy ID', async () => {
  const deps = await setup()
  const example = (await loadPackageExampleCatalog()).find((item) => item.id === 'laptop-diagnostic')!
  const sourceManifest = example.files.find((file) => file.path === 'workflow-package.json')!.text
  deps.native.workspaceScan.mockResolvedValue(
    example.files.map((file) => ({
      relativePath: `elsewhere/${file.path}`,
      kind: 'file',
      symlink: 'none',
      size: new TextEncoder().encode(file.text).length,
      modifiedAt: '',
      readOnly: false,
    })),
  )
  deps.native.workspaceReadTextArtifact.mockResolvedValue({ text: sourceManifest })
  const result = await createPackageExampleCopy(example, deps)
  expect(result.id).toBe('laptop-diagnostic-2')
  expect(result.root).toBe('packages/laptop-diagnostic-2')
  const writes = deps.native.workspaceApplyTransaction.mock.calls[0]![0].writes
  const digest = writes.find((file) => file.relativePath.endsWith('/digests.json'))!.text
  expect(digest).not.toBe(example.files.find((file) => file.path === 'digests.json')!.text)
})

it('counts implicit package directories toward the production traversal limit', async () => {
  const deps = await setup()
  const example = (await loadPackageExampleCatalog()).find((item) => item.id === 'laptop-diagnostic')!
  const contract = {
    ...deps.contract,
    resource_rules: { ...deps.contract.resource_rules, max_traversal_entries: example.files.length },
  }
  const errors = await validatePackageExample(example, { ...deps, contract })
  expect(errors.some((error) => error.includes('package_traversal_limit'))).toBe(true)
})
