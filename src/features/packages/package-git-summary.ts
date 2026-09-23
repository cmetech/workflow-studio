import { atom } from 'nanostores'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
import { parsePackageManifest } from '$src/lib/packages/manifest'
import type { CapturedPackageAnalysis } from './package-analysis'
import { packageVersionProposal } from './package-version-proposal'
import { comparePackageFiles, type PackageFileChange } from '$src/lib/git/package-version-actions'

export type PackageGitSummary =
  | { readonly phase: 'loading' }
  | { readonly phase: 'unavailable'; readonly message: string }
  | {
      readonly phase: 'ready'
      readonly changes: readonly PackageFileChange[]
      readonly baselineVersion: string | null
      readonly proposedVersion: string | null
    }

export function packageGitSummaryLabel(summary?: PackageGitSummary): string {
  if (!summary) return 'Local changes not loaded'
  if (summary.phase === 'loading') return 'Comparing local changes…'
  if (summary.phase === 'unavailable') return summary.message
  return `${summary.changes.length} local change${summary.changes.length === 1 ? '' : 's'}`
}

/** Saved file comparison only. No Git writes, runtime execution, or readiness dependency. */
export function createPackageGitSummaries(
  native: Pick<WorkspaceNativeBridge, 'gitReadPackageContext' | 'workspaceHashPackage' | 'workspaceReadTextArtifact'>,
) {
  const state = atom<{ workspaceId: string | null; summaries: ReadonlyMap<string, PackageGitSummary> }>({
    workspaceId: null,
    summaries: new Map(),
  })
  let generation = 0
  const proposals = new Map<string, (captured: CapturedPackageAnalysis) => string | null>()
  const captures = new Map<string, CapturedPackageAnalysis>()
  function reset() {
    ++generation
    proposals.clear()
    captures.clear()
    state.set({ workspaceId: null, summaries: new Map() })
  }
  async function refresh(
    workspaceId: string,
    roots: readonly string[],
    contract: WorkflowPackageContract,
    resources: ResourceResolutionContract,
  ) {
    const request = ++generation
    proposals.clear()
    if (state.get().workspaceId !== workspaceId) captures.clear()
    for (const root of captures.keys()) if (!roots.includes(root)) captures.delete(root)
    state.set({ workspaceId, summaries: new Map(roots.map((root) => [root, { phase: 'loading' }])) })
    // Keep native work bounded to one package at a time; never run from pointer frames.
    for (const root of roots) {
      if (request !== generation) return
      let summary: PackageGitSummary
      try {
        const context = await native.gitReadPackageContext(root)
        const snapshot = await native.workspaceHashPackage(root)
        if (
          context.workspaceId !== workspaceId ||
          snapshot.workspaceId !== workspaceId ||
          context.packageRoot !== root ||
          snapshot.packageRoot !== root
        )
          throw Error('Package or workspace changed. Refresh to compare again.')
        const manifestPath = (root ? root + '/' : '') + 'workflow-package.json'
        const manifest = await native.workspaceReadTextArtifact(manifestPath)
        const manifestHash = snapshot.files.find((file) => file.relativePath === 'workflow-package.json')
        const bytes = new TextEncoder().encode(manifest.text)
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')
        if (
          manifest.relativePath !== manifestPath ||
          manifest.sha256 !== manifestHash?.sha256 ||
          manifest.size !== manifestHash?.size ||
          hash !== manifestHash?.sha256 ||
          bytes.length !== manifestHash?.size
        )
          throw Error('Saved manifest changed. Refresh to compare again.')
        const current = parsePackageManifest(manifest.text, manifestPath, contract)
        const baselineText = context.baselineManifestText ?? context.committedManifestText
        const baseline = baselineText === null ? null : parsePackageManifest(baselineText, manifestPath, contract)
        if (!current.ok || (baseline && !baseline.ok)) throw Error('Package manifest cannot be compared.')
        const previous = baseline?.ok ? baseline.manifest : null
        const files = [...snapshot.files]
        const changes = comparePackageFiles(
          context.committedFiles.filter((file) => file.relativePath !== 'digests.json'),
          files,
        )
        const oldDigest = context.committedFiles.find((file) => file.relativePath === 'digests.json')?.sha256 ?? null
        if (oldDigest !== snapshot.generatedDigestHash)
          changes.push({
            path: 'digests.json',
            kind: oldDigest === null ? 'added' : snapshot.generatedDigestHash === null ? 'removed' : 'modified',
          })
        summary = { phase: 'ready', changes, baselineVersion: previous?.version ?? null, proposedVersion: null }
        if (request !== generation) return
        proposals.set(root, (captured) => {
          if (
            captured.snapshot.workspaceId !== workspaceId ||
            captured.snapshot.packageRoot !== root ||
            captured.snapshot.generatedDigestHash !== snapshot.generatedDigestHash ||
            comparePackageFiles(snapshot.files, captured.snapshot.files).length
          )
            return null
          return packageVersionProposal(
            previous,
            current.manifest,
            changes.filter((change) => change.path !== 'digests.json'),
            captured.analysis.references.references,
            new Set(captured.artifactTexts.keys()),
            contract,
            resources,
          ).suggestedVersion
        })
      } catch (error) {
        summary = {
          phase: 'unavailable',
          message:
            error && typeof error === 'object' && 'code' in error && error.code === 'git_not_repository'
              ? 'No local Git repository; changes unavailable'
              : `Local changes unavailable: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      if (request !== generation) return
      state.set({ workspaceId, summaries: new Map([...state.get().summaries, [root, summary]]) })
      const captured = captures.get(root)
      if (captured) applyAnalysis(root, captured)
    }
  }
  function applyAnalysis(root: string, captured: CapturedPackageAnalysis) {
    const current = state.get()
    captures.delete(root)
    if (
      captured.snapshot.workspaceId !== current.workspaceId ||
      captured.snapshot.packageRoot !== root ||
      !captured.analysis.ready
    )
      return
    const summary = current.summaries.get(root)
    if (summary?.phase === 'loading') {
      captures.set(root, captured)
      return
    }
    if (summary?.phase !== 'ready' || !summary.changes.length) return
    const proposedVersion = proposals.get(root)?.(captured) ?? null
    if (proposedVersion && proposedVersion !== summary.proposedVersion)
      state.set({ ...current, summaries: new Map([...current.summaries, [root, { ...summary, proposedVersion }]]) })
  }
  return { state, refresh, reset, applyAnalysis }
}
