import { beforeAll, expect, it } from 'vitest'
import authoringText from '../../../contracts/archon-2026-07-v6.json?raw'
import manifest from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json'
import { loadAuthoringContract } from '../contract/contract-loader'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '../package-contract/bundled-package-contract'
import { analyzeWorkflowPair } from '../validation/analyze-workflow'
import type { AuthoringContract } from '../contract/types'
import type { WorkflowPairText } from '../documents/types'
import type { WorkflowPackageManifest } from './types'
import type { PackageCreationSnapshot } from './creation'
import {
  planResourceCreation,
  planResourceExtraction,
  planResourceSelection,
  type ResourceActionContext,
} from './resource-actions'
let authoring: AuthoringContract
let workspace: PackageCreationSnapshot
beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(authoringText), {
    kind: 'bundled',
    identifier: 'resource-actions',
  })
  if (!loaded.ok) throw new Error(loaded.code)
  authoring = loaded.contract
  workspace = {
    workspaceId: 'workspace',
    contract: await loadBundledWorkflowPackageContract(),
    resourceContract: (await loadBundledResourceResolution()).contract,
    entries: [],
    packages: [{ root: 'packages/test', id: 'test' }],
  }
})
async function fixture(
  text = '# preserve header\nname: test\ndescription: Example\nnodes:\n  - id: run\n    script: old # preserve this comment\n    runtime: uv\n',
  extra: Record<string, string> = {},
): Promise<ResourceActionContext> {
  const definitionPath = 'packages/test/main.yaml'
  const companionPath = 'packages/test/main.hermes.yaml'
  const workflow: WorkflowPairText = {
    workflowId: 'workflow',
    generation: 0,
    savedGeneration: 0,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: definitionPath,
      text,
      revision: 0,
      savedRevision: 0,
      diskHash: 'a'.repeat(64),
    },
    companion: {
      id: 'companion',
      kind: 'companion',
      path: companionPath,
      text: 'language_compatibility: archon-2026-07\n',
      revision: 0,
      savedRevision: 0,
      diskHash: 'b'.repeat(64),
    },
  }
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'test',
      workflowId: 'workflow',
      pairGeneration: 0,
      definition: workflow.definition,
      companion: workflow.companion,
      profile: authoring.profile,
      contractDigest: authoring.contract_digest,
      reason: 'open',
    },
    authoring,
  )
  const entries = [workflow.definition, workflow.companion!].map((file) => ({
    relativePath: file.path,
    text: file.text,
    sha256: file.diskHash!,
    kind: 'file' as const,
    size: file.text.length,
    modifiedAt: '',
    symlink: 'none' as const,
    readOnly: false,
  }))
  entries.push(
    ...Object.entries(extra).map(([path, text]) => ({
      relativePath: `packages/test/${path}`,
      text,
      sha256: 'c'.repeat(64),
      kind: 'file' as const,
      size: text.length,
      modifiedAt: '',
      symlink: 'none' as const,
      readOnly: false,
    })),
  )
  const member = { definition: 'main.yaml', companion: 'main.hermes.yaml' }
  const manifestText = JSON.stringify({ ...manifest, id: 'test', workflows: [member] })
  entries.push({
    relativePath: 'packages/test/workflow-package.json',
    text: manifestText,
    sha256: 'd'.repeat(64),
    kind: 'file',
    size: manifestText.length,
    modifiedAt: '',
    symlink: 'none',
    readOnly: false,
  })
  return {
    package: {
      id: 'test',
      root: 'packages/test',
      manifestPath: 'packages/test/workflow-package.json',
      manifest: { ...manifest, id: 'test', workflows: [member] } as WorkflowPackageManifest,
      workflows: [member],
      artifacts: [],
    },
    workflow,
    analysis,
    authoring,
    workspace: { ...workspace, entries },
    nodeId: 'run',
    scopeKey: 'root',
    fieldPath: 'nodes[].script',
  }
}

it('creates a contract-selected uv artifact and one preserving YAML transaction', async () => {
  const context = await fixture()
  const plan = await planResourceCreation({
    ...context,
    basename: 'analyze-snapshot',
    initialText: '# draft\r\nprint(1)\r\n',
  })
  expect(plan.artifactPath).toBe('packages/test/scripts/analyze-snapshot.py')
  expect(plan.reference).toBe('analyze-snapshot')
  expect(plan.nextPair.definition.text).toBe(
    context.workflow.definition.text.replace('script: old', 'script: analyze-snapshot'),
  )
  expect(plan.transaction.before.definition).toBe(context.workflow.definition.text)
  expect(plan.transaction.after.definition).toBe(plan.nextPair.definition.text)
  expect(plan.nativePlan.writes).toEqual([
    { relativePath: plan.artifactPath, text: '# draft\r\nprint(1)\r\n', expectedCurrentHash: null },
    {
      relativePath: context.workflow.definition.path,
      text: plan.nextPair.definition.text,
      expectedCurrentHash: 'a'.repeat(64),
    },
  ])
  expect(plan.nativePlan.expectedEntries).toContainEqual({
    relativePath: context.workflow.companion!.path,
    expectedCurrentHash: 'b'.repeat(64),
  })
})

it('uses explicit Bun extension selection and rejects collisions or unsupported suffixes', async () => {
  const context = await fixture(
    'name: test\ndescription: Example\nnodes:\n  - id: run\n    script: old\n    runtime: bun\n',
    { 'scripts/report.ts': 'old shared' },
  )
  const plan = await planResourceCreation({ ...context, basename: 'report', suffix: '.js', initialText: 'export {}\n' })
  expect(plan.artifactPath).toBe('packages/test/scripts/report.js')
  expect(plan.reference).toBe('report.js')
  await expect(planResourceCreation({ ...context, basename: 'report', initialText: '' })).rejects.toMatchObject({
    code: 'package_path_collision',
  })
  await expect(
    planResourceCreation({ ...context, basename: 'report', suffix: '.sh', initialText: '' }),
  ).rejects.toMatchObject({ code: 'resource_suffix_unsupported' })
})

it('extracts exact inline text without trimming and does not silently replace inline code', async () => {
  const context = await fixture(
    'name: test\ndescription: Example\nnodes:\n  - id: run\n    script: |\n      print(1)\n\n    runtime: uv\n',
  )
  await expect(planResourceCreation({ ...context, basename: 'run', initialText: 'replacement' })).rejects.toMatchObject(
    { code: 'resource_inline_requires_extraction' },
  )
  const plan = await planResourceExtraction({ ...context, basename: 'run' })
  expect(plan.initialText).toBe('print(1)\n')
  expect(plan.nextPair.definition.text).toContain('script:')
  expect(plan.reference).toBe('run')
})

it('rejects stale analyses, unsaved workflow drafts, mismatched disk text and unknown surfaces', async () => {
  const context = await fixture()
  await expect(
    planResourceCreation({
      ...context,
      analysis: { ...context.analysis, definitionRevision: 2 },
      basename: 'run',
      initialText: '',
    }),
  ).rejects.toMatchObject({ code: 'resource_stale_workflow' })
  await expect(
    planResourceCreation({
      ...context,
      workflow: { ...context.workflow, definition: { ...context.workflow.definition, revision: 1 } },
      basename: 'run',
      initialText: '',
    }),
  ).rejects.toMatchObject({ code: 'resource_unsaved_workflow' })
  await expect(
    planResourceCreation({ ...context, fieldPath: 'nodes[].unknown', basename: 'run', initialText: '' }),
  ).rejects.toMatchObject({ code: 'resource_field_unsupported' })
  await expect(
    planResourceCreation({
      ...context,
      workspace: {
        ...context.workspace,
        entries: context.workspace.entries.map((file) =>
          file.relativePath === context.workflow.definition.path ? { ...file, text: 'changed' } : file,
        ),
      },
      basename: 'run',
      initialText: '',
    }),
  ).rejects.toMatchObject({ code: 'resource_source_changed' })
})

it('selects an existing shared resource without writing or changing the resource', async () => {
  const context = await fixture(undefined, { 'scripts/shared.py': 'print("shared")\n' })
  const plan = await planResourceSelection({ ...context, artifactPath: 'packages/test/scripts/shared.py' })
  expect(plan.reference).toBe('shared.py')
  expect(plan.nativePlan.writes).toHaveLength(1)
  expect(plan.nativePlan.writes[0]?.relativePath).toBe(context.workflow.definition.path)
  expect(plan.nativePlan.expectedEntries).toContainEqual({
    relativePath: 'packages/test/scripts/shared.py',
    expectedCurrentHash: 'c'.repeat(64),
  })
})

it('binds membership and higher-precedence resource absence into native authorization', async () => {
  const context = await fixture()
  const plan = await planResourceCreation({ ...context, basename: 'new-script', initialText: '' })
  expect(plan.expectedWorkspaceEntries).toContainEqual({
    relativePath: 'packages/test/workflow-package.json',
    expectedCurrentHash: 'd'.repeat(64),
  })
  expect(plan.expectedWorkspaceEntries).toContainEqual({
    relativePath: 'packages/test/scripts/new-script',
    expectedCurrentHash: null,
  })
  await expect(
    planResourceCreation({
      ...context,
      workspace: {
        ...context.workspace,
        entries: context.workspace.entries.filter((file) => !file.relativePath.endsWith('workflow-package.json')),
      },
      basename: 'new-script',
      initialText: '',
    }),
  ).rejects.toMatchObject({ code: 'resource_package_required' })
})

it('refuses shared scalar alias edits that could change another node', async () => {
  const context = await fixture(
    'name: test\ndescription: Example\nnodes:\n  - id: run\n    script: &shared old\n    runtime: uv\n  - id: other\n    script: *shared\n    runtime: uv\n',
  )
  await expect(planResourceCreation({ ...context, basename: 'new-script', initialText: '' })).rejects.toMatchObject({
    code: 'mutation_ambiguous_alias',
  })
})

it('creates an MCP resource through the separate contract option surface', async () => {
  const context = await fixture('name: test\ndescription: Example\nnodes:\n  - id: run\n    prompt: Hello\n')
  const plan = await planResourceCreation({
    ...context,
    fieldPath: 'nodes[].mcp',
    basename: 'local',
    initialText: 'command: external\n',
  })
  expect(plan.artifactPath).toBe('packages/test/mcp/local.yaml')
  expect(plan.nextPair.definition.text).toContain('mcp: local')
})

it('rejects resource names classified as inline and runtime-incompatible selections', async () => {
  const context = await fixture(undefined, { 'scripts/wrong.js': 'export {}' })
  await expect(planResourceCreation({ ...context, basename: 'bad name', initialText: '' })).rejects.toMatchObject({
    code: 'resource_name_invalid',
  })
  await expect(
    planResourceSelection({ ...context, artifactPath: 'packages/test/scripts/wrong.js' }),
  ).rejects.toMatchObject({ code: 'resource_suffix_unsupported' })
})

it('patches only the selected loop-body node and preserves a same-named root resource', async () => {
  const context = await fixture(
    'name: test\ndescription: Example\nnodes:\n  - id: run\n    script: root-script\n    runtime: uv\n  - id: repeat\n    loop_group:\n      nodes:\n        - id: run\n          script: body-script # keep body comment\n          runtime: uv\n      until: done\n      max_iterations: 3\n',
  )
  const plan = await planResourceCreation({
    ...context,
    scopeKey: 'loop-group:repeat',
    fieldPath: 'nodes[].loop_group.nodes[].script',
    basename: 'new-body',
    initialText: '',
  })
  expect(plan.nextPair.definition.text).toBe(
    context.workflow.definition.text.replace('script: body-script', 'script: new-body'),
  )
  expect(plan.yamlMutation).toMatchObject({ path: ['nodes', 1, 'loop_group', 'nodes', 0, 'script'] })
})

it('creates resources in a workspace-root package without absolute paths', async () => {
  const nested = await fixture()
  const strip = (path: string) => path.replace('packages/test/', '')
  const workflow = {
    ...nested.workflow,
    definition: { ...nested.workflow.definition, path: 'main.yaml' },
    companion: { ...nested.workflow.companion!, path: 'main.hermes.yaml' },
  }
  const analysis = { ...nested.analysis, definitionPath: 'main.yaml', companionPath: 'main.hermes.yaml' }
  const result = await planResourceCreation({
    ...nested,
    workflow,
    analysis,
    package: { ...nested.package, root: '', manifestPath: 'workflow-package.json' },
    workspace: {
      ...nested.workspace,
      packages: [{ root: '', id: nested.package.id }],
      entries: nested.workspace.entries.map((entry) => ({ ...entry, relativePath: strip(entry.relativePath) })),
    },
    basename: 'root-script',
    initialText: 'print(1)',
  })
  expect(result.artifactPath).toBe('scripts/root-script.py')
  expect(result.nativePlan.expectedEntries.every((entry) => !entry.relativePath.startsWith('/'))).toBe(true)
})
