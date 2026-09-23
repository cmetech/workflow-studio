import type { AuthoringContract } from '$src/lib/contract/types'
import type { WorkspaceNativeBridge, WorkspacePackageSnapshot } from '$src/lib/native/types'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
import type { PackageAnalysis } from '$src/lib/packages/readiness'
import type { PackageIndexContext } from '$src/lib/packages/preparation'
import type { WorkflowPackageProjection } from '$src/lib/packages/types'
import { freezePackageValue } from '$src/lib/package-contract/package-contract-loader'
import type { PackageAnalysisInput, PackageAnalysisResult } from './package-analysis-pure'
import { runPackageAnalysis } from './package-analysis-client'
export type PackageAnalysisRunner = (input: PackageAnalysisInput) => Promise<PackageAnalysisResult>
export interface PackageAnalysisDependencies {
  /** Explicit adapter for trusted offline build tools; browser callers use the packaged worker. */
  readonly analyze?: PackageAnalysisRunner
  readonly packageRoot: string
  readonly native: Pick<WorkspaceNativeBridge, 'workspaceHashPackage' | 'workspaceReadTextArtifact'>
  readonly contract: WorkflowPackageContract
  readonly resourceContract: ResourceResolutionContract
  /** Exactly one active contract per profile; ambiguous choices fail closed. */
  readonly authoring: readonly AuthoringContract[]
  readonly index?: PackageIndexContext
}
export interface CapturedPackageAnalysis {
  readonly package: WorkflowPackageProjection
  readonly snapshot: WorkspacePackageSnapshot
  readonly manifestText: string
  readonly artifactTexts: ReadonlyMap<string, string>
  readonly analyzedHashes: ReadonlyMap<string, string>
  readonly analysis: PackageAnalysis
}
async function hashText(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
/** Capture complete native inventory, then analyze only text matching its exact-byte hashes. */
export async function capturePackageAnalysis(deps: PackageAnalysisDependencies): Promise<CapturedPackageAnalysis> {
  const snapshot = await deps.native.workspaceHashPackage(deps.packageRoot)
  if (snapshot.packageRoot !== deps.packageRoot) throw new Error('package_analysis_stale')
  const prefix = deps.packageRoot ? deps.packageRoot + '/' : ''
  const texts = new Map<string, string>()
  const analyzedHashes = new Map<string, string>()
  for (const file of snapshot.files) {
    const path = prefix + file.relativePath
    try {
      const read = await deps.native.workspaceReadTextArtifact(path)
      if (
        read.relativePath !== path ||
        read.sha256 !== file.sha256 ||
        read.size !== file.size ||
        (await hashText(read.text)) !== file.sha256
      )
        throw new Error('package_analysis_stale')
      texts.set(file.relativePath, read.text)
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        (error.code !== 'invalid_utf8' && error.code !== 'artifact_binary')
      )
        throw error
      // A binary payload participates in native snapshot revalidation and digest composition.
    }
    analyzedHashes.set(file.relativePath, file.sha256)
  }
  const manifestText = texts.get('workflow-package.json')
  if (manifestText === undefined) throw new Error('package_manifest_invalid')
  const result = await (deps.analyze ?? runPackageAnalysis)({
    snapshot,
    texts,
    contract: deps.contract,
    resourceContract: deps.resourceContract,
    authoring: deps.authoring,
    ...(deps.index ? { index: deps.index } : {}),
  })
  if (result.package.root !== snapshot.packageRoot) throw new Error('package_analysis_worker_identity')
  const references = result.analysis.references
  const analysis: PackageAnalysis = freezePackageValue({
    ...result.analysis,
    references: {
      ...references,
      forNode: (nodeId: string, workflowPath?: string) =>
        Object.freeze(
          references.references.filter(
            (reference) =>
              reference.nodeId === nodeId && (workflowPath === undefined || reference.workflowPath === workflowPath),
          ),
        ),
    },
  })
  return { package: result.package, snapshot, manifestText, artifactTexts: texts, analyzedHashes, analysis }
}
