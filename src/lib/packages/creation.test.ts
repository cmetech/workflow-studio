import { beforeAll, expect, it } from 'vitest'
import authoringText from '../../../contracts/archon-2026-07-v6.json?raw'
import fixtureManifest from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json'
import { loadAuthoringContract } from '../contract/contract-loader'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '../package-contract/bundled-package-contract'
import {
  planPackageCreation,
  planWorkflowImport,
  type PackageCreationSnapshot,
  type PackageWorkflowSource,
} from './creation'

let snapshot: PackageCreationSnapshot
let source: PackageWorkflowSource
beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(authoringText), {
    kind: 'bundled',
    identifier: 'creation-test',
  })
  if (!loaded.ok) throw new Error(loaded.code)
  snapshot = {
    workspaceId: 'workspace',
    contract: await loadBundledWorkflowPackageContract(),
    resourceContract: (await loadBundledResourceResolution()).contract,
    entries: [],
    packages: [],
  }
  source = {
    kind: 'blank',
    authoring: loaded.contract,
    definition: {
      path: 'workflows/main.yaml',
      text: '# preserve comment\r\nname: test\r\ndescription: Example\r\nnodes:\r\n  - id: hello\r\n    prompt: Say hello\r\n',
    },
    companion: { path: 'workflows/main.hermes.yaml', text: 'language_compatibility: archon-2026-07\n' },
    resources: [],
  }
})
const metadata = { ...fixtureManifest, id: 'new-package', workflows: undefined }
const request = () => ({ root: 'packages/new-package', metadata, workflow: source })

it('plans a package and first workflow together without changing source bytes', async () => {
  const plan = await planPackageCreation(request(), snapshot)
  expect(plan.writes.map((file) => file.relativePath)).toEqual([
    'packages/new-package/workflow-package.json',
    'packages/new-package/workflows/main.yaml',
    'packages/new-package/workflows/main.hermes.yaml',
  ])
  expect(plan.writes[1]?.text).toBe(source.definition.text)
  expect(JSON.parse(plan.writes[0]!.text)).toMatchObject({
    id: 'new-package',
    workflows: [{ definition: 'workflows/main.yaml', companion: 'workflows/main.hermes.yaml' }],
    publisher: fixtureManifest.publisher,
  })
  expect(plan.writes.every((file) => file.expectedCurrentHash === null)).toBe(true)
  expect(plan.expectedEntries).toContainEqual({ relativePath: 'packages/new-package', expectedCurrentHash: null })
  expect(plan.moves).toEqual([])
  expect(plan.trashes).toEqual([])
})

it.each(['../escape', '/absolute', 'packages\\bad', 'packages/.git/bad'])(
  'rejects unsafe destination %s',
  async (root) => {
    await expect(planPackageCreation({ ...request(), root }, snapshot)).rejects.toMatchObject({
      code: expect.stringMatching(/^package_/),
    })
  },
)

it('rejects existing, nested, case-colliding roots and duplicate package ids', async () => {
  const occupied = {
    relativePath: 'PACKAGES/new-package/readme.md',
    kind: 'file' as const,
    symlink: 'none' as const,
    readOnly: false,
    size: 1,
    modifiedAt: '',
    sha256: 'a'.repeat(64),
    text: 'x',
  }
  await expect(planPackageCreation(request(), { ...snapshot, entries: [occupied] })).rejects.toMatchObject({
    code: 'package_path_collision',
  })
  await expect(
    planPackageCreation(request(), { ...snapshot, packages: [{ root: 'packages', id: 'other' }] }),
  ).rejects.toMatchObject({ code: 'package_root_nested' })
  await expect(
    planPackageCreation(request(), { ...snapshot, packages: [{ root: 'elsewhere', id: 'new-package' }] }),
  ).rejects.toMatchObject({ code: 'package_id_duplicate' })
})

it('fails closed on unresolved scripts, malformed workflows and unidentified workspace sources', async () => {
  const script = {
    ...source,
    definition: {
      ...source.definition,
      text: 'name: test\ndescription: test\nnodes:\n  - id: run\n    script: analyze\n    runtime: uv\n',
    },
  }
  await expect(planPackageCreation({ ...request(), workflow: script }, snapshot)).rejects.toMatchObject({
    code: 'package_resource_missing',
  })
  await expect(
    planPackageCreation(
      { ...request(), workflow: { ...source, definition: { ...source.definition, text: 'broken: [' } } },
      snapshot,
    ),
  ).rejects.toMatchObject({ code: 'package_workflow_invalid' })
  await expect(
    planPackageCreation({ ...request(), workflow: { ...source, kind: 'workspace' } }, snapshot),
  ).rejects.toMatchObject({ code: 'package_source_unverified' })
})

it('copies only explicitly identified resources and binds original hashes when adopting a workflow', async () => {
  const definition = {
    ...source.definition,
    sourcePath: 'old/main.yaml',
    text: 'name: test\ndescription: test\nnodes:\n  - id: run\n    script: analyze\n    runtime: uv\n',
  }
  const resource = { path: 'scripts/analyze.py', sourcePath: 'old/scripts/analyze.py', text: '# exact\r\nprint(1)\r\n' }
  const companion = { ...source.companion!, sourcePath: 'old/main.hermes.yaml' }
  const entries = [definition, companion, resource].map((file) => ({
    relativePath: file.sourcePath,
    text: file.text,
    sha256: 'a'.repeat(64),
    kind: 'file' as const,
    symlink: 'none' as const,
    readOnly: false,
    size: file.text.length,
    modifiedAt: '',
  }))
  const plan = await planPackageCreation(
    {
      ...request(),
      workflow: { ...source, kind: 'workspace', definition, companion, resources: [resource] },
      mode: 'move',
    },
    { ...snapshot, entries },
  )
  expect(plan.moves).toEqual([
    { sourcePath: 'old/main.yaml', destinationPath: 'packages/new-package/workflows/main.yaml' },
    { sourcePath: 'old/main.hermes.yaml', destinationPath: 'packages/new-package/workflows/main.hermes.yaml' },
  ])
  expect(plan.writes.find((file) => file.relativePath.endsWith('analyze.py'))?.text).toBe(resource.text)
  expect(plan.expectedEntries).toContainEqual({
    relativePath: 'old/scripts/analyze.py',
    expectedCurrentHash: 'a'.repeat(64),
  })
  expect(plan.trashes).toEqual([])
})

it('imports membership with an exact manifest hash and refuses existing member destinations', async () => {
  const text = JSON.stringify(fixtureManifest, null, 2)
  const entry = {
    relativePath: 'packages/existing/workflow-package.json',
    text,
    sha256: 'b'.repeat(64),
    kind: 'file' as const,
    symlink: 'none' as const,
    readOnly: false,
    size: text.length,
    modifiedAt: '',
  }
  const existing = { ...snapshot, entries: [entry], packages: [{ root: 'packages/existing', id: fixtureManifest.id }] }
  const plan = await planWorkflowImport({ root: 'packages/existing', workflow: source, mode: 'copy' }, existing)
  expect(plan.writes[0]).toMatchObject({ relativePath: entry.relativePath, expectedCurrentHash: entry.sha256 })
  expect(JSON.parse(plan.writes[0]!.text).workflows).toEqual([
    { definition: 'main.yaml' },
    { definition: 'workflows/main.yaml', companion: 'workflows/main.hermes.yaml' },
  ])
  await expect(
    planWorkflowImport(
      {
        root: 'packages/existing',
        workflow: { ...source, definition: { ...source.definition, path: 'main.yaml' } },
        mode: 'copy',
      },
      existing,
    ),
  ).rejects.toMatchObject({ code: 'package_member_duplicate' })
})

it('rejects case-aliased parent directories, symlink ancestors, stale sources and file/directory aliases', async () => {
  const directory = {
    relativePath: 'PACKAGES',
    kind: 'directory' as const,
    size: 0,
    modifiedAt: '',
    symlink: 'none' as const,
    readOnly: false,
  }
  await expect(planPackageCreation(request(), { ...snapshot, entries: [directory] })).rejects.toMatchObject({
    code: 'package_path_collision',
  })
  await expect(
    planPackageCreation(request(), {
      ...snapshot,
      entries: [{ ...directory, relativePath: 'packages', symlink: 'safe' }],
    }),
  ).rejects.toMatchObject({ code: 'package_path_collision' })
  const colliding = { ...source, resources: [{ path: 'workflows', text: 'not a folder' }] }
  await expect(planPackageCreation({ ...request(), workflow: colliding }, snapshot)).rejects.toMatchObject({
    code: 'package_path_collision',
  })
})

it('enforces encoded byte limits, manifest fields and copies no unselected resources', async () => {
  await expect(
    planPackageCreation({ ...request(), metadata: { ...metadata, version: 'invalid' } }, snapshot),
  ).rejects.toMatchObject({ code: 'package_manifest_invalid' })
  await expect(
    planPackageCreation(request(), {
      ...snapshot,
      contract: { ...snapshot.contract, resource_rules: { ...snapshot.contract.resource_rules, max_total_bytes: 10 } },
    }),
  ).rejects.toMatchObject({ code: 'package_size_limit' })
  const plan = await planPackageCreation(request(), {
    ...snapshot,
    entries: [
      {
        relativePath: 'unrelated.py',
        kind: 'file',
        size: 3,
        text: 'bad',
        modifiedAt: '',
        symlink: 'none',
        readOnly: false,
      },
    ],
  })
  expect(plan.writes.some((file) => file.relativePath.endsWith('unrelated.py'))).toBe(false)
})

it('rejects aliases of generated files and package roots containing the shared marketplace index', async () => {
  await expect(
    planPackageCreation(
      { ...request(), workflow: { ...source, resources: [{ path: 'WORKFLOW-PACKAGE.JSON', text: '{}' }] } },
      snapshot,
    ),
  ).rejects.toMatchObject({ code: 'package_generated_file' })
  await expect(planPackageCreation({ ...request(), root: '.well-known' }, snapshot)).rejects.toMatchObject({
    code: 'package_root_reserved',
  })
})

it('excludes only root digest metadata from payload limits and counts distinct implicit directories', async () => {
  const manifestText = JSON.stringify(fixtureManifest)
  const entries = [
    {
      relativePath: 'packages/existing/workflow-package.json',
      text: manifestText,
      sha256: 'b'.repeat(64),
      kind: 'file' as const,
      symlink: 'none' as const,
      readOnly: false,
      size: manifestText.length,
      modifiedAt: '',
    },
    {
      relativePath: 'packages/existing/digests.json',
      text: 'x'.repeat(5000),
      sha256: 'c'.repeat(64),
      kind: 'file' as const,
      symlink: 'none' as const,
      readOnly: false,
      size: 5000,
      modifiedAt: '',
    },
  ]
  const current = { ...snapshot, entries, packages: [{ root: 'packages/existing', id: fixtureManifest.id }] }
  const importing = { root: 'packages/existing', workflow: source, mode: 'copy' as const }
  const baseline = await planWorkflowImport(importing, current)
  const payloadBytes = baseline.writes.reduce((sum, file) => sum + new TextEncoder().encode(file.text).byteLength, 0)
  const limited = {
    ...current,
    contract: {
      ...snapshot.contract,
      resource_rules: {
        ...snapshot.contract.resource_rules,
        max_files: 3,
        max_total_bytes: payloadBytes,
        max_traversal_entries: 5,
      },
    },
  }
  await expect(planWorkflowImport(importing, limited)).resolves.toMatchObject({ workspaceId: 'workspace' })
  await expect(
    planPackageCreation(request(), {
      ...snapshot,
      contract: {
        ...snapshot.contract,
        resource_rules: { ...snapshot.contract.resource_rules, max_traversal_entries: 3 },
      },
    }),
  ).rejects.toMatchObject({ code: 'package_size_limit' })
  const rootSource = {
    ...source,
    definition: { ...source.definition, path: 'new.yaml' },
    companion: { ...source.companion!, path: 'new.hermes.yaml' },
  }
  await expect(
    planWorkflowImport(
      { ...importing, workflow: rootSource },
      {
        ...current,
        entries: entries.slice(0, 1),
        contract: {
          ...snapshot.contract,
          resource_rules: { ...snapshot.contract.resource_rules, max_traversal_entries: 3 },
        },
      },
    ),
  ).resolves.toMatchObject({ workspaceId: 'workspace' })
})
