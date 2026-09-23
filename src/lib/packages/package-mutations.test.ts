import { beforeAll, expect, it } from 'vitest'
import { createBrowserBridge } from '../native/browser-bridge'
import { loadBundledAuthoringContracts } from '../contract/bundled-contracts'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '../package-contract/bundled-package-contract'
import { capturePackageAnalysis } from '../../features/packages/package-analysis'
import { analyzeCapturedPackage } from '../../features/packages/package-analysis-pure'
import manifest from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json'
import { planPackageMutation, type PackageMutationContext } from './package-mutations'
let contracts: Pick<PackageMutationContext, 'contract' | 'resourceContract' | 'authoring'>
beforeAll(async () => {
  contracts = {
    contract: await loadBundledWorkflowPackageContract(),
    resourceContract: (await loadBundledResourceResolution()).contract,
    authoring: await loadBundledAuthoringContracts(),
  }
})
async function fixture(extra: Record<string, string> = {}, single = false) {
  const members = [
    { definition: 'workflows/one.yaml', companion: 'policy/custom.yaml' },
    ...(!single ? [{ definition: 'workflows/two.yaml', companion: 'policy/two.yaml' }] : []),
  ]
  const files: Record<string, string> = {
    'pkg/workflow-package.json': JSON.stringify({ ...manifest, workflows: members }, null, 2) + '\n',
    'pkg/commands/shared.md': 'Summarize the supplied text.\n',
    ...Object.fromEntries(
      members.flatMap((member, index) => [
        [
          'pkg/' + member.definition,
          `# retained header\nname: member${index}\ndescription: Shared command\nnodes:\n  - id: run\n    command: 'shared' # retained comment\n`,
        ],
        ['pkg/' + member.companion, 'language_compatibility: archon-2026-07\n'],
      ]),
    ),
    ...extra,
  }
  const native = createBrowserBridge({ initialFiles: files })
  const capture = await capturePackageAnalysis({
    ...contracts,
    native,
    packageRoot: 'pkg',
    analyze: analyzeCapturedPackage,
  })
  return { context: { ...contracts, capture } satisfies PackageMutationContext, native, files }
}
it('removes only manifest membership with exact original hashes and leaves declared pair and shared resources', async () => {
  const { context, native, files } = await fixture()
  const preview = await planPackageMutation(context, {
    kind: 'remove-workflow',
    definition: 'workflows/one.yaml',
    trashPair: false,
  })
  expect(preview.plan.trashes).toEqual([])
  expect(preview.plan.moves).toEqual([])
  expect(preview.plan.writes.map((write) => write.relativePath)).toEqual(['pkg/workflow-package.json'])
  expect(preview.plan.packageSnapshotToken).toBe(context.capture.snapshot.sourceSnapshotToken)
  expect(preview.changes[0]).toMatchObject({
    path: 'pkg/workflow-package.json',
    expectedHash: context.capture.snapshot.files.find((file) => file.relativePath === 'workflow-package.json')!.sha256,
  })
  await native.workspaceApplyTransaction(preview.plan)
  expect(JSON.parse((await native.workspaceReadTextArtifact('pkg/workflow-package.json')).text).workflows).toEqual([
    { definition: 'workflows/two.yaml', companion: 'policy/two.yaml' },
  ])
  for (const path of ['pkg/workflows/one.yaml', 'pkg/policy/custom.yaml', 'pkg/commands/shared.md'])
    expect((await native.workspaceReadTextArtifact(path)).text).toBe(files[path])
})
it('trashes only the selected declared pair and preserves the command shared by another member', async () => {
  const { context, native, files } = await fixture()
  const preview = await planPackageMutation(context, {
    kind: 'remove-workflow',
    definition: 'workflows/one.yaml',
    trashPair: true,
  })
  expect(preview.plan.trashes.map((item) => item.relativePath).sort()).toEqual([
    'pkg/policy/custom.yaml',
    'pkg/workflows/one.yaml',
  ])
  await native.workspaceApplyTransaction(preview.plan)
  await expect(native.workspaceReadTextArtifact('pkg/policy/custom.yaml')).rejects.toMatchObject({
    code: 'path_not_found',
  })
  expect((await native.workspaceReadTextArtifact('pkg/commands/shared.md')).text).toBe(files['pkg/commands/shared.md'])
  expect((await native.workspaceReadTextArtifact('pkg/workflows/two.yaml')).text).toBe(files['pkg/workflows/two.yaml'])
})
it('refuses to remove the last required package member', async () => {
  const { context } = await fixture({}, true)
  await expect(
    planPackageMutation(context, { kind: 'remove-workflow', definition: 'workflows/one.yaml', trashPair: false }),
  ).rejects.toMatchObject({ code: 'package_last_workflow' })
})
it('renames a shared command and rewrites each proven consumer without losing YAML comments or scalar style', async () => {
  const { context, native, files } = await fixture()
  const preview = await planPackageMutation(context, {
    kind: 'rename-artifact',
    path: 'commands/shared.md',
    destination: 'commands/renamed.md',
  })
  expect(preview.referenceChanges).toHaveLength(2)
  expect(preview.plan.moves).toEqual([
    expect.objectContaining({ sourcePath: 'pkg/commands/shared.md', destinationPath: 'pkg/commands/renamed.md' }),
  ])
  await native.workspaceApplyTransaction(preview.plan)
  expect((await native.workspaceReadTextArtifact('pkg/commands/renamed.md')).text).toBe(files['pkg/commands/shared.md'])
  for (const path of ['pkg/workflows/one.yaml', 'pkg/workflows/two.yaml']) {
    const text = (await native.workspaceReadTextArtifact(path)).text
    expect(text).toContain('# retained header')
    expect(text).toMatch(/command: 'renamed(?:\.md)?' # retained comment/)
  }
})
it('refuses to trash a referenced artifact and identifies both consumers', async () => {
  const { context } = await fixture()
  await expect(
    planPackageMutation(context, { kind: 'trash-artifact', path: 'commands/shared.md' }),
  ).rejects.toMatchObject({
    code: 'package_artifact_referenced',
    references: expect.arrayContaining([
      expect.objectContaining({ workflowPath: 'workflows/one.yaml' }),
      expect.objectContaining({ workflowPath: 'workflows/two.yaml' }),
    ]),
  })
})
it('rejects case-fold collisions and reserved paths before constructing any native mutation', async () => {
  const { context } = await fixture({ 'pkg/commands/RENAMED.md': 'existing' })
  await expect(
    planPackageMutation(context, {
      kind: 'rename-artifact',
      path: 'commands/shared.md',
      destination: 'commands/renamed.md',
    }),
  ).rejects.toMatchObject({ code: 'package_path_collision' })
  await expect(
    planPackageMutation(context, { kind: 'trash-artifact', path: 'workflow-package.json' }),
  ).rejects.toMatchObject({ code: 'package_artifact_reserved' })
})
it('reports unknown textual references for manual edits instead of guessing a rewrite', async () => {
  const { context } = await fixture({ 'pkg/notes.txt': 'Use commands/shared.md for this example.' })
  await expect(
    planPackageMutation(context, {
      kind: 'rename-artifact',
      path: 'commands/shared.md',
      destination: 'commands/renamed.md',
    }),
  ).rejects.toMatchObject({
    code: 'package_manual_references',
    manualReferences: [expect.objectContaining({ path: 'notes.txt' })],
  })
})
it('keeps the preview bound to original bytes when a resource changes before native commit', async () => {
  const { context, native } = await fixture()
  const preview = await planPackageMutation(context, {
    kind: 'remove-workflow',
    definition: 'workflows/one.yaml',
    trashPair: true,
  })
  const before = await native.workspaceReadTextArtifact('pkg/commands/shared.md')
  await native.workspaceWriteTextArtifact({
    relativePath: before.relativePath,
    expectedCurrentHash: before.sha256,
    text: 'concurrent saved edit',
  })
  await expect(native.workspaceApplyTransaction(preview.plan)).rejects.toMatchObject({ code: 'package_source_changed' })
  expect((await native.workspaceReadTextArtifact('pkg/workflows/one.yaml')).text).toContain('member0')
  expect((await native.workspaceReadTextArtifact('pkg/commands/shared.md')).text).toBe('concurrent saved edit')
})

it.each(['scripts/renamed.py', 'scripts/renamed'])(
  'renames a named script to %s through its published resource surface and proves both rewritten consumers',
  async (destination) => {
    const extra = Object.fromEntries(
      ['one', 'two'].map((name) => [
        'pkg/workflows/' + name + '.yaml',
        `name: ${name}\ndescription: Named script\nnodes:\n  - id: run\n    script: shared # keep script comment\n    runtime: uv\n`,
      ]),
    )
    const { context, native } = await fixture({ ...extra, 'pkg/scripts/shared.py': 'print("passive source")\n' })
    const preview = await planPackageMutation(context, {
      kind: 'rename-artifact',
      path: 'scripts/shared.py',
      destination,
    })
    expect(preview.referenceChanges).toHaveLength(2)
    await native.workspaceApplyTransaction(preview.plan)
    for (const name of ['one', 'two'])
      expect((await native.workspaceReadTextArtifact('pkg/workflows/' + name + '.yaml')).text).toMatch(
        /script: renamed(?:\.py)? # keep script comment/,
      )
  },
)
