import type { ExampleDescriptor } from '$src/lib/examples/types'
import { buildPackageCatalog } from '$src/lib/packages/discovery'
import { beforeAll, expect, it, vi } from 'vitest'
import authoringText from '../../../contracts/archon-2026-07-v6.json?raw'
import fixtureManifest from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '$src/lib/package-contract/bundled-package-contract'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { createPackageAuthoringController, type PackageAuthoringContext } from './package-authoring-controller'
import type { AuthoringContract } from '$src/lib/contract/types'
let authoring: AuthoringContract
let contract: Awaited<ReturnType<typeof loadBundledWorkflowPackageContract>>
let resourceContract: Awaited<ReturnType<typeof loadBundledResourceResolution>>['contract']
beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(authoringText), {
    kind: 'bundled',
    identifier: 'test',
  })
  if (!loaded.ok) throw Error(loaded.code)
  authoring = loaded.contract
  contract = await loadBundledWorkflowPackageContract()
  resourceContract = (await loadBundledResourceResolution()).contract
})
async function setup(files: Record<string, string> = {}, workflowExamples: readonly ExampleDescriptor[] = []) {
  const native = createBrowserBridge({ initialFiles: files })
  let context: PackageAuthoringContext = {
    workspaceId: 'browser-workspace',
    files: await native.workspaceScan(),
    packages: [],
    authoring: [authoring],
    activePair: null,
  }
  const onCompleted = vi.fn()
  const contextGetter = vi.fn(() => context)
  const controller = createPackageAuthoringController({
    getContext: contextGetter,
    native,
    contract,
    resourceContract,
    workflowExamples,
    onCompleted,
  })
  return {
    native,
    controller,
    onCompleted,
    contextGetter,
    setContext: (next: PackageAuthoringContext) => {
      context = next
    },
    getContext: contextGetter,
  }
}
it('creates a blank package with one guarded transaction then reports its root', async () => {
  const { controller, native, onCompleted } = await setup()
  const session = await controller.prepare()
  const blank = session.sources.find((source) => source.id.startsWith('blank:'))!
  expect(blank.disabledReason).toBeUndefined()
  const apply = vi.spyOn(native, 'workspaceApplyTransaction')
  await controller.create(session, {
    root: 'packages/new',
    metadata: { ...fixtureManifest, id: 'new' },
    workflow: blank.source,
  })
  expect(apply).toHaveBeenCalledOnce()
  expect((await native.workspaceReadTextArtifact('packages/new/workflow-package.json')).text).toContain(
    'workflows/main.yaml',
  )
  expect(onCompleted).toHaveBeenCalledWith('packages/new')
})
it('rejects a stale workspace session before writing or completion', async () => {
  const f = await setup()
  const session = await f.controller.prepare()
  f.setContext({ ...f.getContext(), workspaceId: 'different' })
  const apply = vi.spyOn(f.native, 'workspaceApplyTransaction')
  await expect(
    f.controller.create(session, {
      root: 'packages/new',
      metadata: fixtureManifest,
      workflow: session.sources[0]!.source,
    }),
  ).rejects.toThrow('workspace')
  expect(apply).not.toHaveBeenCalled()
  expect(f.onCompleted).not.toHaveBeenCalled()
})
it('offers saved workspace bytes but disables a source with unsaved edits', async () => {
  const text = '# exact source\nname: Saved\ndescription: Example\nnodes: []\n'
  const f = await setup({ 'saved.yaml': text, 'saved.hermes.yaml': 'language_compatibility: archon-2026-07\n' })
  f.setContext({
    ...f.getContext(),
    activePair: {
      workflowId: 'saved',
      generation: 1,
      savedGeneration: 1,
      definition: {
        id: 'd',
        kind: 'definition',
        path: 'saved.yaml',
        text: text + '# draft',
        revision: 2,
        savedRevision: 1,
        diskHash: null,
      },
      companion: null,
    },
  })
  const session = await f.controller.prepare()
  const option = session.sources.find((source) => source.id === 'workspace:saved.yaml')!
  expect(option.source.definition.text).toBe(text)
  expect(option.disabledReason).toMatch(/save|unsaved/i)
})
it('rejects unsupported or unresolved external resource sources before offering them', async () => {
  const f = await setup({
    'saved.yaml': 'name: Saved\ndescription: Example\nnodes:\n  - id: run\n    script: scripts/missing.py\n',
    'saved.hermes.yaml': 'language_compatibility: archon-2026-07\n',
  })
  const session = await f.controller.prepare()
  expect(session.sources.find((source) => source.id === 'workspace:saved.yaml')?.disabledReason).toBeTruthy()
})

async function packageSetup(
  definition = 'name: Saved\ndescription: Example\nnodes:\n  - id: hello\n    prompt: Say hello\n',
  resources: Record<string, string> = {},
) {
  const manifest = JSON.stringify({
    ...fixtureManifest,
    workflows: [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }],
  })
  const f = await setup({
    'pkg/workflow-package.json': manifest,
    'pkg/main.yaml': definition,
    'pkg/main.hermes.yaml': 'language_compatibility: archon-2026-07\n',
    ...resources,
  })
  const packages = buildPackageCatalog({
    contract,
    files: f.getContext().files,
    manifestTexts: new Map([['pkg/workflow-package.json', manifest]]),
  }).packages
  f.setContext({ ...f.getContext(), packages })
  return f
}
it('copies a package workflow and its verified resource closure without normalizing source bytes', async () => {
  const definition =
    '# source comment\r\nname: Script\r\ndescription: Example\r\nnodes:\r\n  - id: run\r\n    script: analyze\r\n    runtime: uv\r\n'
  const resource = '# preserved\r\nprint(1)\r\n'
  const f = await packageSetup(definition, { 'pkg/scripts/analyze.py': resource })
  const session = await f.controller.prepare()
  const option = session.sources.find((source) => source.id === 'workspace:pkg/main.yaml')!
  expect(option.disabledReason).toBeUndefined()
  expect(option.source.resources).toEqual([
    { path: 'scripts/analyze.py', sourcePath: 'pkg/scripts/analyze.py', text: resource },
  ])
  await f.controller.create(session, {
    root: 'copied',
    metadata: { ...fixtureManifest, id: 'copied' },
    workflow: option.source,
  })
  expect((await f.native.workspaceReadTextArtifact('copied/main.yaml')).text).toBe(definition)
  expect((await f.native.workspaceReadTextArtifact('copied/scripts/analyze.py')).text).toBe(resource)
})
it('imports a source and updates only existing package membership', async () => {
  const f = await packageSetup()
  const session = await f.controller.prepare()
  const blank = session.sources.find((source) => source.id.startsWith('blank:'))!
  await f.controller.importWorkflow(session, { root: 'pkg', workflow: blank.source, mode: 'copy' })
  expect(
    JSON.parse((await f.native.workspaceReadTextArtifact('pkg/workflow-package.json')).text).workflows,
  ).toHaveLength(2)
  expect(f.onCompleted).toHaveBeenCalledWith('pkg')
})
it('creates exact text artifacts exclusively and rejects reserved or occupied filenames', async () => {
  const f = await packageSetup()
  const session = await f.controller.prepare()
  await expect(f.controller.addTextArtifact(session, 'pkg', 'main.yaml', 'replace')).rejects.toThrow('exists')
  await expect(f.controller.addTextArtifact(session, 'pkg', 'workflow-package.json', 'replace')).rejects.toThrow(
    'reserved',
  )
  const apply = vi.spyOn(f.native, 'workspaceApplyTransaction')
  const hash = vi.spyOn(f.native, 'workspaceHashPackage')
  await f.controller.addTextArtifact(session, 'pkg', 'assets/exact.txt', 'invalid [\r\n')
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ packageSnapshotToken: (await hash.mock.results[0]!.value).sourceSnapshotToken }),
  )
  expect((await f.native.workspaceReadTextArtifact('pkg/assets/exact.txt')).text).toBe('invalid [\r\n')
  expect(f.onCompleted).toHaveBeenCalledWith('pkg', 'pkg/assets/exact.txt')
})
it('does not report completion when the guarded native transaction fails', async () => {
  const f = await setup()
  const session = await f.controller.prepare()
  vi.spyOn(f.native, 'workspaceApplyTransaction').mockRejectedValueOnce(Error('revision conflict'))
  await expect(
    f.controller.create(session, { root: 'new', metadata: fixtureManifest, workflow: session.sources[0]!.source }),
  ).rejects.toThrow('revision conflict')
  expect(f.onCompleted).not.toHaveBeenCalled()
})
it('passes the verified package snapshot token and exact filename to a binary import grant', async () => {
  const f = await packageSetup()
  const session = await f.controller.prepare()
  vi.spyOn(f.native, 'chooseImportArtifact').mockResolvedValueOnce({ sourceGrantToken: 'opaque-grant' })
  const imported = vi.spyOn(f.native, 'workspaceImportArtifact').mockResolvedValueOnce({
    relativePath: 'pkg/assets/exact.bin',
    sha256: 'f'.repeat(64),
    size: 4,
    modifiedAt: '',
    readOnly: false,
    mediaType: 'application/octet-stream',
  })
  const hash = vi.spyOn(f.native, 'workspaceHashPackage')
  await f.controller.importArtifact(session, 'pkg', 'assets/exact.bin')
  expect(imported).toHaveBeenCalledWith({
    relativePath: 'pkg/assets/exact.bin',
    sourceGrantToken: 'opaque-grant',
    packageSnapshotToken: (await hash.mock.results[0]!.value).sourceSnapshotToken,
  })
  expect(f.onCompleted).toHaveBeenCalledWith('pkg', 'pkg/assets/exact.bin')
})

it('rejects an edit that arrives after source authorization but before native publication', async () => {
  const text = 'name: Saved\ndescription: Example\nnodes:\n  - id: hello\n    prompt: Say hello\n'
  const f = await setup({ 'saved.yaml': text, 'saved.hermes.yaml': 'language_compatibility: archon-2026-07\n' })
  const session = await f.controller.prepare()
  const source = session.sources.find((option) => option.id === 'workspace:saved.yaml')!.source
  const saved = f.getContext()
  const dirty = {
    ...saved,
    activePair: {
      workflowId: 'saved',
      generation: 1,
      savedGeneration: 1,
      definition: {
        id: 'd',
        kind: 'definition' as const,
        path: 'saved.yaml',
        text: text + '# edit',
        revision: 2,
        savedRevision: 1,
        diskHash: null,
      },
      companion: null,
    },
  }
  f.contextGetter.mockReturnValueOnce(saved).mockReturnValueOnce(saved).mockReturnValueOnce(dirty)
  const apply = vi.spyOn(f.native, 'workspaceApplyTransaction')
  await expect(
    f.controller.create(session, { root: 'copied', metadata: fixtureManifest, workflow: source }),
  ).rejects.toThrow('Save')
  expect(apply).not.toHaveBeenCalled()
})

it('reports a committed operation if refreshing the completed package fails', async () => {
  const f = await setup()
  const session = await f.controller.prepare()
  f.onCompleted.mockRejectedValueOnce(Error('refresh failed'))
  await expect(
    f.controller.create(session, { root: 'new', metadata: fixtureManifest, workflow: session.sources[0]!.source }),
  ).rejects.toThrow('committed')
  expect((await f.native.workspaceReadTextArtifact('new/workflow-package.json')).text).toContain('diagnostics')
})

it('requires reopening when the active authoring contract changes after source selection', async () => {
  const f = await setup()
  const session = await f.controller.prepare()
  f.setContext({ ...f.getContext(), authoring: [{ ...authoring, contract_digest: 'sha256:changed' }] })
  const apply = vi.spyOn(f.native, 'workspaceApplyTransaction')
  await expect(
    f.controller.create(session, { root: 'new', metadata: fixtureManifest, workflow: session.sources[0]!.source }),
  ).rejects.toThrow('contract')
  expect(apply).not.toHaveBeenCalled()
})

it('creates a writable first-workflow copy from a read-only bundled example without changing its bytes', async () => {
  const text =
    '# bundled example\r\nname: Example\r\ndescription: Example\r\nnodes:\r\n  - id: hello\r\n    prompt: Say hello\r\n'
  const example: ExampleDescriptor = {
    id: 'demo',
    title: 'Demo',
    summary: 'Example',
    difficulty: 'starter',
    profiles: ['archon-2026-07'],
    profile: 'archon-2026-07',
    concepts: [],
    highlightedNodeIds: [],
    highlightedFieldIds: [],
    documentationTopicIds: [],
    definitionPath: 'examples/demo/main.yaml',
    companionPath: 'examples/demo/main.hermes.yaml',
    definitionText: text,
    companionText: 'language_compatibility: archon-2026-07\n',
    readOnly: true,
  }
  const f = await setup({}, [example])
  const session = await f.controller.prepare()
  const option = session.sources.find((source) => source.id === 'example:demo')!
  expect(option.disabledReason).toBeUndefined()
  await f.controller.create(session, { root: 'copy', metadata: fixtureManifest, workflow: option.source })
  expect((await f.native.workspaceReadTextArtifact('copy/workflows/main.yaml')).text).toBe(text)
  expect(example.definitionText).toBe(text)
})
