import type { WorkflowPackageContract } from '../package-contract/types'
import type { WorkspaceFileEntry } from '../workspace/types'

export interface PackageFinding {
  readonly code: string
  readonly path: string
  readonly message: string
  readonly severity: 'blocking' | 'advisory'
}
export interface PackageWorkflowMember {
  readonly definition: string
  readonly companion?: string | null
}
export interface WorkflowPackageManifest {
  readonly schemaVersion: 1
  readonly id: string
  readonly version: string
  readonly displayName: string
  readonly description: string
  readonly license: string
  readonly publisher: string
  readonly tags: readonly string[]
  readonly workflows: readonly PackageWorkflowMember[]
  readonly externalRequirements: Readonly<
    Record<'runtimes' | 'tools' | 'providers' | 'services' | 'secrets', readonly string[]>
  >
}
export type PackageManifestResult = {
  readonly text: string
  readonly rawDocument: unknown
  readonly findings: readonly PackageFinding[]
} & ({ readonly ok: true; readonly manifest: WorkflowPackageManifest } | { readonly ok: false })

export interface PackageArtifactEntry {
  readonly path: string
  readonly workspacePath: string
  readonly kind: WorkspaceFileEntry['kind']
  readonly size: number
  readonly readOnly: boolean
}
export interface WorkflowPackageProjection {
  readonly id: string
  readonly root: string
  readonly manifestPath: string
  readonly manifest: WorkflowPackageManifest
  readonly workflows: readonly PackageWorkflowMember[]
  readonly artifacts: readonly PackageArtifactEntry[]
}
export interface PackageCatalog {
  readonly packages: readonly WorkflowPackageProjection[]
  readonly findings: readonly PackageFinding[]
}
export interface PackageCatalogInput {
  readonly contract: WorkflowPackageContract
  readonly files: readonly WorkspaceFileEntry[]
  readonly manifestTexts: ReadonlyMap<string, string>
}
