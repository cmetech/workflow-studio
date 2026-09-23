import { NativeError } from '$src/lib/native/types'
import { extractTransactionRecovery, type TransactionRecoveryReceipt } from '$src/lib/native/transaction-recovery'
import type { WorkspaceNativeBridge, WorkspacePackageSnapshot } from '$src/lib/native/types'
import type { GitPackageContext } from '$src/lib/git/types'
import { comparePackageFiles, packageVersionError, suggestPackageVersion } from '$src/lib/git/package-version-actions'
import { parsePackageManifest } from '$src/lib/packages/manifest'
import { replaceManifestProperty } from '$src/lib/packages/manifest-edit'
import { classifyPackageArtifact } from '$src/lib/packages/artifact-kind'
import { comparePackagePaths } from '$src/lib/packages/paths'
import { prepareGeneratedPackageFiles } from '$src/lib/packages/preparation'
import { MARKETPLACE_INDEX_PATH } from '$src/lib/packages/marketplace-index'
import {
  capturePackageAnalysis,
  type CapturedPackageAnalysis,
  type PackageAnalysisDependencies,
} from './package-analysis'
import type { PreparePackageDependencies, PreparationReview } from './prepare-package-controller'

export interface PackagePreparationSnapshot {
  readonly captured: CapturedPackageAnalysis
  readonly context: GitPackageContext
  readonly baselineVersion: string | null
}
export interface PackagePreparationBackendDependencies extends Omit<PackageAnalysisDependencies, 'native' | 'index'> {
  readonly native: WorkspaceNativeBridge
  readonly flush: () => Promise<void>
}
async function textIdentity(text: string) {
  const bytes = new TextEncoder().encode(text)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return { sha256, size: bytes.length }
}
function inventory(snapshot: WorkspacePackageSnapshot) {
  const digest = snapshot.packageRoot + '/digests.json'
  return snapshot.entries
    .filter((entry) => entry.relativePath !== digest)
    .map((entry) => [entry.relativePath, entry.kind, entry.symlink])
    .sort((a, b) => comparePackagePaths(a[0]!, b[0]!))
}
function assertSource(
  expected: WorkspacePackageSnapshot,
  actual: WorkspacePackageSnapshot,
  manifest?: { sha256: string; size: number },
  generatedHash = expected.generatedDigestHash,
) {
  const files = expected.files.map((file) =>
    file.relativePath === 'workflow-package.json' && manifest ? { ...file, ...manifest } : file,
  )
  if (
    expected.workspaceId !== actual.workspaceId ||
    expected.packageRoot !== actual.packageRoot ||
    generatedHash !== actual.generatedDigestHash ||
    JSON.stringify(inventory(expected)) !== JSON.stringify(inventory(actual)) ||
    files.length !== actual.files.length ||
    comparePackageFiles(files, actual.files).length
  )
    throw new Error('package_source_changed')
}

/** Orchestrates pure contract analysis and native snapshot/transaction/Git authority; never executes package code. */
export function createPackagePreparationBackend(
  deps: PackagePreparationBackendDependencies,
): PreparePackageDependencies<PackagePreparationSnapshot> {
  const native = deps.native,
    root = deps.packageRoot
  const preparedStates = new WeakMap<
    PackagePreparationSnapshot,
    Pick<PackagePreparationSnapshot, 'captured' | 'context'> & { recovery: TransactionRecoveryReceipt }
  >()
  const analyze = (context: GitPackageContext) => capturePackageAnalysis({ ...deps, index: context })
  return {
    flush: deps.flush,
    async validate(): Promise<PreparationReview<PackagePreparationSnapshot>> {
      const context = await native.gitReadPackageContext(root)
      if (context.packageRoot !== root) throw new Error('package_source_changed')
      const captured = await analyze(context)
      if (captured.snapshot.workspaceId !== context.workspaceId) throw new Error('package_source_changed')
      const baselineText = context.baselineManifestText ?? context.committedManifestText
      const baseline =
        baselineText === null
          ? null
          : parsePackageManifest(baselineText, root + '/workflow-package.json', deps.contract)
      if (baseline && !baseline.ok) throw new Error('package_baseline_invalid')
      const baselineManifest = baseline?.ok ? baseline.manifest : null
      const changes = comparePackageFiles(
        context.committedFiles.filter((file) => file.relativePath !== 'digests.json'),
        captured.snapshot.files,
      )
      const summary = {
        removedWorkflows:
          baselineManifest?.workflows
            .filter((old) => !captured.package.workflows.some((current) => current.definition === old.definition))
            .map((member) => member.definition) ?? [],
        addedCapabilities: changes
          .filter(
            (change) =>
              change.kind === 'added' &&
              (['script', 'command', 'workflow'].includes(
                classifyPackageArtifact({
                  path: change.path,
                  members: captured.package.workflows,
                  contract: deps.resourceContract,
                  textAvailable: captured.artifactTexts.has(change.path),
                }).kind,
              ) ||
                captured.analysis.references.references.some((reference) => reference.artifactPath === change.path)),
          )
          .map((change) => change.path),
        // Companion changes conservatively suggest a major version; users explicitly choose the final version.
        compatibilityChanged:
          !!baselineManifest &&
          (baselineManifest.id !== captured.package.id ||
            changes.some((change) =>
              captured.package.workflows.some((member) => member.companion === change.path && change.kind !== 'added'),
            )),
      }
      const currentVersion = captured.package.manifest.version
      const suggestion = baselineManifest
        ? suggestPackageVersion(summary, baselineManifest.version, deps.contract)
        : null
      const suggestedVersion =
        baselineManifest && packageVersionError(currentVersion, baselineManifest.version, deps.contract) === null
          ? currentVersion
          : (suggestion?.version ?? currentVersion)
      const viewChanges = [
        ...changes.map((change) => ({ ...change, path: root + '/' + change.path, trustImpact: true })),
        { kind: 'metadata' as const, path: root + '/digests.json' },
        { kind: 'metadata' as const, path: MARKETPLACE_INDEX_PATH },
      ]
      return {
        snapshot: { captured, context, baselineVersion: baselineManifest?.version ?? null },
        analysis: captured.analysis,
        changes: viewChanges,
        includedPaths: viewChanges.map((change) => change.path),
        trustChanges: changes.map(
          (change) => `${root}/${change.path}: ${change.kind} content changes the package digest.`,
        ),
        suggestedVersion,
        suggestionReasons: summary.compatibilityChanged
          ? ['Workflow settings or package identity changed; review compatibility before choosing a version.']
          : (suggestion?.reasons ?? ['This is the first reachable local package version.']),
      }
    },
    async prepare(review, input) {
      let recovery = preparedStates.get(review)?.recovery ?? extractTransactionRecovery(null)
      const retain = (result: unknown) => {
        const next = extractTransactionRecovery(result)
        recovery = extractTransactionRecovery({
          pathResults: [...recovery.pathResults, ...next.pathResults],
          omittedPathResults: recovery.omittedPathResults + next.omittedPathResults,
        })
      }
      try {
        const { captured, context } = preparedStates.get(review) ?? review
        const { baselineVersion } = review
        const versionError = packageVersionError(input.version, baselineVersion, deps.contract)
        if (versionError) throw new Error(versionError)
        if (!input.message.trim()) throw new Error('git_message_required')
        if (!captured.analysis.ready || captured.analysis.blockers.length) throw new Error('package_analysis_required')
        const current = await native.workspaceHashPackage(root)
        assertSource(captured.snapshot, current)
        const manifestPath = root + '/workflow-package.json'
        const manifestText = replaceManifestProperty(captured.manifestText, 'version', input.version)
        const manifest = await textIdentity(manifestText)
        if (manifestText !== captured.manifestText) {
          const original = captured.snapshot.files.find((file) => file.relativePath === 'workflow-package.json')!
          const changed = await native.workspaceApplyTransaction({
            workspaceId: captured.snapshot.workspaceId,
            packageSnapshotToken: current.sourceSnapshotToken,
            expectedEntries: [
              ...captured.snapshot.files.map((file) => ({
                relativePath: root + '/' + file.relativePath,
                expectedCurrentHash: file.sha256,
              })),
              { relativePath: root + '/digests.json', expectedCurrentHash: captured.snapshot.generatedDigestHash },
              { relativePath: MARKETPLACE_INDEX_PATH, expectedCurrentHash: context.workingIndexHash },
            ],
            writes: [{ relativePath: manifestPath, text: manifestText, expectedCurrentHash: original.sha256 }],
            moves: [],
            trashes: [],
          })
          retain(changed)
        }
        const versioned = await analyze(context)
        assertSource(captured.snapshot, versioned.snapshot, manifest)
        const generated = await prepareGeneratedPackageFiles({ ...context, ...versioned, contract: deps.contract })
        retain(await native.workspaceReplaceGeneratedFiles(generated.request))
        const final = await native.workspaceHashPackage(root)
        assertSource(captured.snapshot, final, manifest, (await textIdentity(generated.digestsText)).sha256)
        const indexHash = (await textIdentity(generated.indexText)).sha256
        const freshContext = await native.gitReadPackageContext(root)
        if (
          freshContext.workspaceId !== context.workspaceId ||
          freshContext.packageRoot !== root ||
          JSON.stringify(freshContext.base) !== JSON.stringify(context.base) ||
          freshContext.workingIndexHash !== indexHash ||
          freshContext.workingIndexText !== generated.indexText
        )
          throw new Error('package_source_changed')
        const preview = await native.gitPreviewPackageVersion({
          contextToken: freshContext.contextToken,
          sourceSnapshotToken: final.sourceSnapshotToken,
          expectedIndexHash: indexHash,
          version: input.version,
          message: input.message,
        })
        if (preview.version !== input.version || preview.message !== input.message || preview.packageRoot !== root)
          throw new Error('git_preview_mismatch')
        // Only our exact generated writes become the next authorized source. Other edits still require review.
        preparedStates.set(review, { captured: { ...versioned, snapshot: final }, context: freshContext, recovery })
        return {
          authorizationToken: preview.authorizationToken,
          diff: preview.diff,
          version: input.version,
          message: input.message,
          includedPaths: preview.changedPaths,
          recovery,
        }
      } catch (cause) {
        if (!recovery.pathResults.length && !recovery.omittedPathResults) throw cause
        retain(cause)
        const code =
          cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
            ? cause.code
            : 'package_preparation_failed'
        throw Object.assign(
          new NativeError(
            code,
            cause instanceof Error ? cause.message : 'Package preparation failed.',
            recovery.pathResults,
          ),
          { omittedPathResults: recovery.omittedPathResults },
        )
      }
    },
    commit: (token) => native.gitCommitPackageVersion(token),
  }
}
