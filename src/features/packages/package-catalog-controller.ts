import { $packageCatalog, type PackageSelection } from '$src/stores/packages'
import { buildPackageCatalog, findPackageManifestPaths } from '$src/lib/packages/discovery'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import type { WorkspaceFileEntry } from '$src/lib/workspace/types'
import type { WorkflowPackageProjection } from '$src/lib/packages/types'
export interface PackageCatalogDependencies {
  readonly contract: WorkflowPackageContract
  readonly readManifest: (path: string) => Promise<string>
  readonly openWorkflow?: (
    definitionPath: string,
    companionPath: string | null,
    document?: 'definition' | 'companion',
  ) => Promise<void> | void
  readonly openArtifact?: (path: string, pkg?: WorkflowPackageProjection) => Promise<void> | void
}
export class PackageCatalogController {
  private generation = 0
  private disposed = false
  constructor(private readonly dependencies: PackageCatalogDependencies) {}
  async refresh(workspace: { readonly id: string; readonly files: readonly WorkspaceFileEntry[] }): Promise<void> {
    const generation = ++this.generation
    const previous = $packageCatalog.get()
    $packageCatalog.set({
      phase: 'loading',
      workspaceId: workspace.id,
      catalog: previous.workspaceId === workspace.id ? previous.catalog : { packages: [], findings: [] },
      active: previous.workspaceId === workspace.id ? previous.active : null,
      error: null,
    })
    try {
      const paths = findPackageManifestPaths(workspace.files)
      const entries = await Promise.all(
        paths.map(async (path) => [path, await this.dependencies.readManifest(path)] as const),
      )
      if (this.disposed || generation !== this.generation || $packageCatalog.get().workspaceId !== workspace.id) return
      const catalog = buildPackageCatalog({
        contract: this.dependencies.contract,
        files: workspace.files,
        manifestTexts: new Map(entries),
      })
      const active = $packageCatalog.get().active
      $packageCatalog.set({
        phase: 'ready',
        workspaceId: workspace.id,
        catalog,
        active:
          active &&
          (catalog.packages.some((p) => p.id === active.packageId) || this.repairableManifest(active, catalog.findings))
            ? active
            : null,
        error: null,
      })
    } catch (error) {
      if (this.disposed || generation !== this.generation || $packageCatalog.get().workspaceId !== workspace.id) return
      $packageCatalog.set({
        ...$packageCatalog.get(),
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  private repairableManifest(selection: PackageSelection, findings: readonly { path: string }[]): boolean {
    return (
      selection.kind === 'artifact' &&
      selection.path?.split('/').at(-1) === 'workflow-package.json' &&
      findings.some((f) => f.path === selection.path)
    )
  }
  select(selection: PackageSelection): void {
    const state = $packageCatalog.get()
    const pkg = state.catalog.packages.find((p) => p.id === selection.packageId)
    if (
      !pkg
        ? !this.repairableManifest(selection, state.catalog.findings)
        : selection.kind !== 'overview' && !pkg.artifacts.some((a) => a.workspacePath === selection.path)
    )
      return
    $packageCatalog.set({ ...state, active: selection })
  }
  async open(selection: PackageSelection): Promise<void> {
    this.select(selection)
    const state = $packageCatalog.get()
    if (state.active !== selection) return
    const pkg = state.catalog.packages.find((p) => p.id === selection.packageId)
    if (!pkg) {
      if (selection.path) await this.dependencies.openArtifact?.(selection.path, undefined)
      return
    }
    const full = (path: string) => (pkg.root ? `${pkg.root}/${path}` : path)
    const companionMember = pkg.workflows.find((m) => m.companion && full(m.companion) === selection.path)
    if (companionMember) {
      $packageCatalog.set({ ...state, active: { ...selection, kind: 'workflow' } })
      await this.dependencies.openWorkflow?.(
        full(companionMember.definition),
        full(companionMember.companion!),
        'companion',
      )
    } else if (selection.kind === 'workflow') {
      const member = pkg.workflows.find((m) => full(m.definition) === selection.path)
      if (member)
        await this.dependencies.openWorkflow?.(
          full(member.definition),
          member.companion ? full(member.companion) : null,
        )
    } else if (selection.kind === 'artifact' && selection.path)
      await this.dependencies.openArtifact?.(selection.path, pkg)
  }
  dispose(): void {
    this.disposed = true
    this.generation++
  }
}
