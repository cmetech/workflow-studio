import { beforeEach, expect, it, vi } from 'vitest'
import { $packageCatalog, resetPackages } from '$src/stores/packages'
import { PackageCatalogController } from './package-catalog-controller'
import { loadBundledWorkflowPackageContract } from '$src/lib/package-contract/bundled-package-contract'
import manifestText from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json?raw'
import type { WorkspaceFileEntry } from '$src/lib/workspace/types'

function file(relativePath: string, changes: Partial<WorkspaceFileEntry> = {}): WorkspaceFileEntry {
  return { relativePath, kind: 'file', size: 64, modifiedAt: '', symlink: 'none', readOnly: false, ...changes }
}

it.each(['definition', 'companion'] as const)(
  'keeps the manifest repairable after a missing %s and restores navigation after correction',
  async (missing) => {
    const manifest = JSON.parse(manifestText)
    manifest.workflows = [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }, { definition: 'remaining.yaml' }]
    let text = JSON.stringify(manifest)
    const openArtifact = vi.fn()
    const openWorkflow = vi.fn()
    const controller = new PackageCatalogController({
      contract: await loadBundledWorkflowPackageContract(),
      readManifest: async () => text,
      openArtifact,
      openWorkflow,
    })
    const workspace = {
      id: 'a',
      files: ['workflow-package.json', 'main.yaml', 'main.hermes.yaml', 'remaining.yaml'].map((path) =>
        file(`p/${path}`),
      ),
    }
    await controller.refresh(workspace)
    await controller.open({ packageId: 'diagnostics', kind: 'workflow', path: 'p/remaining.yaml' })
    expect(openWorkflow).toHaveBeenCalledWith('p/remaining.yaml', null)
    manifest.workflows[0][missing] = missing === 'definition' ? 'absent.yaml' : 'absent.hermes.yaml'
    text = JSON.stringify(manifest)
    await controller.refresh(workspace)
    expect($packageCatalog.get().catalog.packages).toEqual([])
    expect($packageCatalog.get().catalog.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'package_member_missing', severity: 'blocking' })]),
    )
    expect($packageCatalog.get().active).toBeNull()
    const repair = {
      packageId: 'manifest:p/workflow-package.json',
      kind: 'artifact' as const,
      path: 'p/workflow-package.json',
    }
    await controller.open(repair)
    expect(openArtifact).toHaveBeenCalledWith('p/workflow-package.json', undefined)
    await controller.refresh(workspace)
    expect($packageCatalog.get().active).toEqual(repair)
    openWorkflow.mockClear()
    await controller.open({ packageId: 'diagnostics', kind: 'workflow', path: 'p/remaining.yaml' })
    expect(openWorkflow).not.toHaveBeenCalled()
    manifest.workflows[0][missing] = missing === 'definition' ? 'main.yaml' : 'main.hermes.yaml'
    text = JSON.stringify(manifest)
    await controller.refresh(workspace)
    expect($packageCatalog.get().catalog.findings).toEqual([])
    await controller.open({ packageId: 'diagnostics', kind: 'workflow', path: 'p/remaining.yaml' })
    expect(openWorkflow).toHaveBeenCalledWith('p/remaining.yaml', null)
  },
)

it.each([
  { name: 'absent', path: 'p/workflow-package.json', files: [] },
  {
    name: 'directory',
    path: 'p/workflow-package.json',
    files: [file('p/workflow-package.json', { kind: 'directory' })],
  },
  { name: 'symlink', path: 'p/workflow-package.json', files: [file('p/workflow-package.json', { symlink: 'safe' })] },
  {
    name: 'symlink ancestor',
    path: 'p/workflow-package.json',
    files: [file('p', { kind: 'directory', symlink: 'unsafe' }), file('p/workflow-package.json')],
  },
  { name: 'traversal', path: '../workflow-package.json', files: [file('../workflow-package.json')] },
])('does not turn a $name manifest finding into artifact access', async ({ path, files }) => {
  const openArtifact = vi.fn()
  const controller = new PackageCatalogController({
    contract: await loadBundledWorkflowPackageContract(),
    readManifest: async () => '{broken',
    openArtifact,
  })
  await controller.refresh({ id: 'a', files })
  await controller.open({ packageId: `manifest:${path}`, kind: 'artifact', path })
  expect(openArtifact).not.toHaveBeenCalled()
  expect($packageCatalog.get().active).toBeNull()
})
beforeEach(resetPackages)
it('discards an older workspace refresh after a newer refresh completes', async () => {
  let resolve!: (value: string) => void
  const contract = await loadBundledWorkflowPackageContract()
  const controller = new PackageCatalogController({
    contract,
    readManifest: () =>
      new Promise((r) => {
        resolve = r
      }),
  })
  const older = controller.refresh({
    id: 'a',
    files: [
      {
        relativePath: 'workflow-package.json',
        kind: 'file',
        size: 2,
        modifiedAt: '',
        symlink: 'none',
        readOnly: false,
      },
    ],
  })
  await controller.refresh({ id: 'b', files: [] })
  resolve('{}')
  await older
  expect($packageCatalog.get().workspaceId).toBe('b')
  expect($packageCatalog.get().phase).toBe('ready')
  expect($packageCatalog.get().catalog.findings).toEqual([])
})
it('invalidates a pending refresh when disposed', async () => {
  let resolve!: (value: string) => void
  const controller = new PackageCatalogController({
    contract: await loadBundledWorkflowPackageContract(),
    readManifest: () =>
      new Promise((r) => {
        resolve = r
      }),
  })
  const pending = controller.refresh({
    id: 'a',
    files: [
      {
        relativePath: 'workflow-package.json',
        kind: 'file',
        size: 2,
        modifiedAt: '',
        symlink: 'none',
        readOnly: false,
      },
    ],
  })
  controller.dispose()
  resetPackages()
  resolve('{}')
  await pending
  expect($packageCatalog.get().phase).toBe('idle')
})
it('routes declared companions through the workflow editor rather than generic artifact saving', async () => {
  const openWorkflow = vi.fn()
  const openArtifact = vi.fn()
  const controller = new PackageCatalogController({
    contract: await loadBundledWorkflowPackageContract(),
    readManifest: async () => '',
    openWorkflow,
    openArtifact,
  })
  const pkg = {
    id: 'test',
    root: 'p',
    manifestPath: 'p/workflow-package.json',
    manifest: {} as never,
    workflows: [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }],
    artifacts: [
      {
        path: 'main.hermes.yaml',
        workspacePath: 'p/main.hermes.yaml',
        kind: 'file' as const,
        size: 1,
        readOnly: false,
      },
    ],
  }
  $packageCatalog.set({
    phase: 'ready',
    workspaceId: 'a',
    catalog: { packages: [pkg], findings: [] },
    active: null,
    error: null,
  })
  await controller.open({ packageId: 'test', kind: 'artifact', path: 'p/main.hermes.yaml' })
  expect(openWorkflow).toHaveBeenCalledWith('p/main.yaml', 'p/main.hermes.yaml', 'companion')
  expect(openArtifact).not.toHaveBeenCalled()
  expect($packageCatalog.get().active?.kind).toBe('workflow')
})
it('opens a rejected manifest for source repair without advertising a valid package', async () => {
  const openArtifact = vi.fn()
  const controller = new PackageCatalogController({
    contract: await loadBundledWorkflowPackageContract(),
    readManifest: async () => '{broken',
    openArtifact,
  })
  await controller.refresh({
    id: 'a',
    files: [
      {
        relativePath: 'workflow-package.json',
        kind: 'file',
        size: 7,
        modifiedAt: '',
        symlink: 'none',
        readOnly: false,
      },
    ],
  })
  await controller.open({
    packageId: 'manifest:workflow-package.json',
    kind: 'artifact',
    path: 'workflow-package.json',
  })
  expect(openArtifact).toHaveBeenCalledWith('workflow-package.json', undefined)
  expect($packageCatalog.get().active?.path).toBe('workflow-package.json')
  expect($packageCatalog.get().catalog.packages).toEqual([])
})
it('revokes manifest repair access when a refresh removes its file', async () => {
  const openArtifact = vi.fn()
  const controller = new PackageCatalogController({
    contract: await loadBundledWorkflowPackageContract(),
    readManifest: async () => '{broken',
    openArtifact,
  })
  const repair = {
    packageId: 'manifest:workflow-package.json',
    kind: 'artifact' as const,
    path: 'workflow-package.json',
  }
  await controller.refresh({ id: 'a', files: [file('workflow-package.json')] })
  await controller.open(repair)
  expect(openArtifact).toHaveBeenCalledOnce()
  await controller.refresh({ id: 'a', files: [] })
  expect($packageCatalog.get().active).toBeNull()
  await controller.open(repair)
  expect(openArtifact).toHaveBeenCalledOnce()
})
it('opens only the canonical shared index outside a selected package', async () => {
  const openArtifact = vi.fn()
  const controller = new PackageCatalogController({
    contract: await loadBundledWorkflowPackageContract(),
    readManifest: async () => '',
    openArtifact,
  })
  $packageCatalog.set({
    phase: 'ready',
    workspaceId: 'a',
    active: null,
    error: null,
    catalog: {
      packages: [
        {
          id: 'test',
          root: 'p',
          manifestPath: 'p/workflow-package.json',
          manifest: {} as never,
          workflows: [],
          artifacts: [],
        },
      ],
      findings: [],
    },
  })
  await controller.open({ packageId: 'test', kind: 'artifact', path: 'outside.txt' })
  expect(openArtifact).not.toHaveBeenCalled()
  await controller.open({ packageId: 'test', kind: 'artifact', path: '.well-known/hermes-workflows/index.json' })
  expect(openArtifact).toHaveBeenCalledWith('.well-known/hermes-workflows/index.json', undefined)
})
