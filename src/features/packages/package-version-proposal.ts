import type { WorkflowPackageManifest } from '$src/lib/packages/types'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
import type { PackageReference } from '$src/lib/packages/package-references'
import { classifyPackageArtifact } from '$src/lib/packages/artifact-kind'
import {
  packageVersionError,
  suggestPackageVersion,
  type PackageFileChange,
} from '$src/lib/git/package-version-actions'

/** Shared proposal rules for preparation and an authenticated overview analysis. */
export function packageVersionProposal(
  baselineManifest: WorkflowPackageManifest | null,
  current: WorkflowPackageManifest,
  changes: readonly PackageFileChange[],
  references: readonly PackageReference[],
  textPaths: ReadonlySet<string>,
  contract: WorkflowPackageContract,
  resourceContract: ResourceResolutionContract,
) {
  const summary = {
    removedWorkflows:
      baselineManifest?.workflows
        .filter((old) => !current.workflows.some((current) => current.definition === old.definition))
        .map((member) => member.definition) ?? [],
    addedCapabilities: changes
      .filter(
        (change) =>
          change.kind === 'added' &&
          (['script', 'command', 'workflow'].includes(
            classifyPackageArtifact({
              path: change.path,
              members: current.workflows,
              contract: resourceContract,
              textAvailable: textPaths.has(change.path),
            }).kind,
          ) ||
            references.some((reference) => reference.artifactPath === change.path)),
      )
      .map((change) => change.path),
    // Companion changes conservatively suggest a major version; users explicitly choose the final version.
    compatibilityChanged:
      !!baselineManifest &&
      (baselineManifest.id !== current.id ||
        changes.some((change) =>
          current.workflows.some((member) => member.companion === change.path && change.kind !== 'added'),
        )),
  }
  const currentVersion = current.version
  const suggestion = baselineManifest ? suggestPackageVersion(summary, baselineManifest.version, contract) : null
  const suggestedVersion =
    baselineManifest && packageVersionError(currentVersion, baselineManifest.version, contract) === null
      ? currentVersion
      : (suggestion?.version ?? currentVersion)
  return { summary, suggestion, suggestedVersion }
}
