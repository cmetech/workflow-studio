import { beforeEach, expect, it, vi } from 'vitest'
import { $packageCatalog, resetPackages } from '$src/stores/packages'
import { PackageCatalogController } from './package-catalog-controller'
import { loadBundledWorkflowPackageContract } from '$src/lib/package-contract/bundled-package-contract'
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
