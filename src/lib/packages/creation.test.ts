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
  packageWorkflowName,
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

it('reads an aliased workflow name using YAML scalar semantics for destination uniqueness', () => {
  expect(
    packageWorkflowName({
      ...source,
      definition: {
        ...source.definition,
        text: source.definition.text.replace(
          'name: test\r\ndescription: Example',
          'description: &title Example\r\nname: *title',
        ),
      },
    }),
  ).toBe('Example')
})

it.each([
  [
    'anchored name used by a prompt',
    'name: &title Original\ndescription: Example\nnodes:\n  - id: hello\n    prompt: *title\n',
  ],
  [
    'anchored name without consumers',
    'name: &title Original\ndescription: Example\nnodes:\n  - id: hello\n    prompt: Hello\n',
  ],
])('refuses copy rename of an %s without changing other YAML semantics', async (_label, text) => {
  const first = await planPackageCreation(request(), snapshot)
  const existing = {
    ...snapshot,
    packages: [{ root: request().root, id: metadata.id }],
    entries: first.writes.map((file) => ({
      relativePath: file.relativePath,
      text: file.text,
      sha256: 'a'.repeat(64),
      kind: 'file' as const,
      symlink: 'none' as const,
      readOnly: false,
      size: file.text.length,
      modifiedAt: '',
    })),
  }
  const selected = { ...source, definition: { ...source.definition, text } }
  await expect(
    planWorkflowImport(
      {
        root: request().root,
        workflow: selected,
        mode: 'copy',
        destination: {
          definition: 'workflows/copied.yaml',
          companion: 'workflows/copied.hermes.yaml',
          name: 'Changed',
        },
      },
      existing,
    ),
  ).rejects.toMatchObject({
    code: 'package_workflow_name_anchored',
    message: expect.stringContaining('Keep the original name'),
  })
  expect(selected.definition.text).toBe(text)
})

it.each(['copy', 'move'] as const)(
  'preserves an anchored workflow name and all aliases during %s with unchanged name',
  async (mode) => {
    const text = 'name: &title Original\ndescription: Example\nnodes:\n  - id: hello\n    prompt: *title\n'
    const selected = {
      ...source,
      kind: 'workspace' as const,
      definition: { ...source.definition, text, sourcePath: 'old/main.yaml' },
      companion: { ...source.companion!, sourcePath: 'old/main.hermes.yaml' },
    }
    const first = await planPackageCreation(request(), snapshot)
    const existing = {
      ...snapshot,
      packages: [{ root: request().root, id: metadata.id }],
      entries: [
        ...first.writes.map((file) => ({ relativePath: file.relativePath, text: file.text })),
        ...[selected.definition, selected.companion].map((file) => ({
          relativePath: file.sourcePath,
          text: file.text,
        })),
      ].map((file) => ({
        ...file,
        sha256: 'a'.repeat(64),
        kind: 'file' as const,
        symlink: 'none' as const,
        readOnly: false,
        size: file.text.length,
        modifiedAt: '',
      })),
    }
    expect(packageWorkflowName(selected)).toBe('Original')
    const plan = await planWorkflowImport(
      {
        root: request().root,
        workflow: selected,
        mode,
        destination: {
          definition: 'workflows/copied.yaml',
          companion: 'workflows/copied.hermes.yaml',
          name: 'Original',
        },
      },
      existing,
    )
    if (mode === 'copy') expect(plan.writes.find((file) => file.relativePath.endsWith('/copied.yaml'))?.text).toBe(text)
    else {
      expect(plan.writes).toHaveLength(1)
      expect(plan.moves).toContainEqual({
        sourcePath: 'old/main.yaml',
        destinationPath: request().root + '/workflows/copied.yaml',
      })
    }
    expect(selected.definition.text).toBe(text)
  },
)

it('adds a second blank at explicit destinations with a distinct name while preserving unrelated YAML bytes', async () => {
  const first = await planPackageCreation(request(), snapshot)
  const existing = {
    ...snapshot,
    packages: [{ root: request().root, id: metadata.id }],
    entries: first.writes.map((file) => ({
      relativePath: file.relativePath,
      text: file.text,
      sha256: 'a'.repeat(64),
      kind: 'file' as const,
      symlink: 'none' as const,
      readOnly: false,
      size: file.text.length,
      modifiedAt: '',
    })),
  }
  const destination = {
    definition: 'workflows/second.yaml',
    companion: 'policies/second.yaml',
    name: 'Second workflow',
  }
  const plan = await planWorkflowImport({ root: request().root, workflow: source, mode: 'copy', destination }, existing)
  expect(plan.writes[1]).toEqual({
    relativePath: request().root + '/' + destination.definition,
    text: source.definition.text.replace('name: test', 'name: Second workflow'),
    expectedCurrentHash: null,
  })
  expect(plan.writes[2]?.text).toBe(source.companion!.text)
  expect(JSON.parse(plan.writes[0]!.text).workflows).toEqual([
    { definition: source.definition.path, companion: source.companion!.path },
    { definition: destination.definition, companion: destination.companion },
  ])
  expect(plan.expectedEntries).toContainEqual({
    relativePath: request().root + '/workflow-package.json',
    expectedCurrentHash: 'a'.repeat(64),
  })
  expect(source.definition.path).toBe('workflows/main.yaml')
  expect(source.definition.text).toContain('name: test\r\n')
  const withReadOnlyMember = {
    ...existing,
    entries: existing.entries.map((entry) =>
      entry.relativePath.endsWith('/main.yaml') ? { ...entry, readOnly: true } : entry,
    ),
  }
  await expect(
    planWorkflowImport({ root: request().root, workflow: source, mode: 'copy', destination }, withReadOnlyMember),
  ).resolves.toMatchObject({ moves: [], trashes: [] })
  await expect(
    planWorkflowImport(
      { root: request().root, workflow: source, mode: 'copy', destination: { ...destination, name: 'test' } },
      existing,
    ),
  ).rejects.toMatchObject({ code: 'package_workflow_name_duplicate' })
  await expect(
    planWorkflowImport(
      {
        root: request().root,
        workflow: source,
        mode: 'copy',
        destination: { ...destination, definition: source.definition.path },
      },
      existing,
    ),
  ).rejects.toMatchObject({ code: 'package_member_duplicate' })
})

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

it('keeps exact workspace move sources and bytes when changing only import destination paths', async () => {
  const first = await planPackageCreation(request(), snapshot)
  const selected = {
    ...source,
    kind: 'workspace' as const,
    definition: {
      ...source.definition,
      text: source.definition.text.replace('name: test', 'name: Moved'),
      sourcePath: 'old/main.yaml',
    },
    companion: { ...source.companion!, sourcePath: 'old/main.hermes.yaml' },
  }
  const existing = {
    ...snapshot,
    packages: [{ root: request().root, id: metadata.id }],
    entries: [
      ...first.writes.map((file) => ({ relativePath: file.relativePath, text: file.text })),
      ...[selected.definition, selected.companion].map((file) => ({ relativePath: file.sourcePath, text: file.text })),
    ].map((file) => ({
      ...file,
      sha256: 'a'.repeat(64),
      kind: 'file' as const,
      symlink: 'none' as const,
      readOnly: false,
      size: file.text.length,
      modifiedAt: '',
    })),
  }
  const destination = { definition: 'workflows/moved.yaml', companion: 'policies/moved.yaml' }
  const plan = await planWorkflowImport(
    { root: request().root, workflow: selected, mode: 'move', destination },
    existing,
  )
  expect(plan.moves).toEqual([
    { sourcePath: 'old/main.yaml', destinationPath: request().root + '/workflows/moved.yaml' },
    { sourcePath: 'old/main.hermes.yaml', destinationPath: request().root + '/policies/moved.yaml' },
  ])
  expect(plan.writes).toHaveLength(1)
  expect(plan.trashes).toEqual([])
  expect(plan.expectedEntries).toContainEqual({ relativePath: 'old/main.yaml', expectedCurrentHash: 'a'.repeat(64) })
  await expect(
    planWorkflowImport(
      { root: request().root, workflow: selected, mode: 'move', destination: { ...destination, name: 'Changed' } },
      existing,
    ),
  ).rejects.toMatchObject({ code: 'package_move_name_change' })
  await expect(
    planWorkflowImport(
      {
        root: request().root,
        workflow: { ...selected, definition: { ...selected.definition, text: selected.definition.text + '# forged' } },
        mode: 'copy',
        destination: { ...destination, name: 'Changed' },
      },
      existing,
    ),
  ).rejects.toMatchObject({ code: 'package_source_changed' })
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

function importSnapshot(root: string, text: string): PackageCreationSnapshot {
  return {
    ...snapshot,
    packages: [{ root, id: fixtureManifest.id }],
    entries: [
      {
        relativePath: root ? `${root}/workflow-package.json` : 'workflow-package.json',
        text,
        sha256: 'b'.repeat(64),
        kind: 'file',
        symlink: 'none',
        readOnly: false,
        size: new TextEncoder().encode(text).byteLength,
        modifiedAt: '',
      },
    ],
  }
}
it('imports into a workspace-root package with canonical relative write and guard paths', async () => {
  const existing = importSnapshot('', JSON.stringify(fixtureManifest))
  const plan = await planWorkflowImport({ root: '', workflow: source, mode: 'copy' }, existing)
  expect(plan.writes.map((write) => write.relativePath)).toEqual([
    'workflow-package.json',
    'workflows/main.yaml',
    'workflows/main.hermes.yaml',
  ])
  expect(plan.expectedEntries).toContainEqual({
    relativePath: 'workflow-package.json',
    expectedCurrentHash: 'b'.repeat(64),
  })
  expect(plan.expectedEntries.every((entry) => entry.relativePath !== '' && !entry.relativePath.startsWith('/'))).toBe(
    true,
  )
  expect(plan.writes[1]!.text).toBe(source.definition.text)
  await expect(planPackageCreation(request(), existing)).rejects.toMatchObject({ code: 'package_root_nested' })
})
it('updates only manifest membership while preserving contract-admitted extensions and unrelated lexical bytes', async () => {
  const oldMembers = JSON.stringify(fixtureManifest.workflows)
  const text =
    JSON.stringify(fixtureManifest).replace(
      '"workflows":' + oldMembers,
      '"unknownNumber" : 9007199254740993, "escaped" : "\\u0061", "workflows" : ' + oldMembers,
    ) + '\r\n'
  const existing = importSnapshot('packages/existing', text)
  // Simulate an authoritative contract extension while preserving the pinned contract's strict default.
  const extended = {
    ...existing,
    contract: {
      ...existing.contract,
      package_manifest_schema: { ...existing.contract.package_manifest_schema, additionalProperties: true },
    },
  }
  const plan = await planWorkflowImport({ root: 'packages/existing', workflow: source, mode: 'copy' }, extended)
  const replacement = JSON.stringify([
    ...fixtureManifest.workflows,
    { definition: source.definition.path, companion: source.companion!.path },
  ])
  expect(plan.writes[0]!.text).toBe(text.replace(oldMembers, replacement))
  expect(plan.writes[0]!.text).toContain('9007199254740993')
})
