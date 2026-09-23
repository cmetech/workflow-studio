export interface GitRepository {
  readonly root: string
  readonly branch: string | null
  readonly detachedHead: string | null
}

export interface GitPathStatus {
  readonly path: string
  readonly originalPath?: string
  readonly index: string
  readonly worktree: string
  readonly untracked: boolean
}

export interface GitStatus {
  readonly entries: readonly GitPathStatus[]
}

export interface GitDiff {
  readonly working: string
  readonly index: string
  readonly authorizationToken?: string
}

export interface GitCommitSummary {
  readonly oid: string
  readonly shortOid: string
  readonly authorName: string
  readonly authoredAt: string
  readonly subject: string
}

export interface GitHistoryResult {
  readonly commits: readonly GitCommitSummary[]
  readonly authorizationToken: string
}

export interface GitPairSnapshot {
  readonly oid: string
  readonly definition: string | null
  readonly companion: string | null
}

export type GitVersionResult =
  | {
      readonly outcome: 'committed'
      readonly oid: string
      readonly status: GitStatus | null
      readonly warnings: readonly string[]
    }
  | {
      readonly outcome: 'unknown'
      readonly candidateOid: string
      readonly code: 'git_commit_outcome_unknown'
      readonly message: string
    }

export interface GitPairPaths {
  readonly definitionPath: string
  readonly companionPath: string | null
}

export interface GitInspection {
  readonly pair?: GitPairPaths | null
  readonly repository: GitRepository | null
  readonly status: GitStatus
  readonly diff: GitDiff
  readonly history: readonly GitCommitSummary[]
  readonly historyAuthorizationToken?: string | null
}

export const emptyGitInspection: GitInspection = Object.freeze({
  pair: null,
  repository: null,
  status: Object.freeze({ entries: Object.freeze([]) }),
  diff: Object.freeze({ working: '', index: '', authorizationToken: '' }),
  history: Object.freeze([]),
  historyAuthorizationToken: null,
})

export type GitBase =
  | { readonly kind: 'head'; readonly oid: string; readonly reference: string }
  | { readonly kind: 'unborn'; readonly reference: string }
export interface GitCommittedPackageFile {
  /** Package-relative; includes the root digests.json when committed. */
  readonly relativePath: string
  readonly sha256: string
  readonly size: number
  readonly gitMode: string
}
export interface GitPackageContext {
  readonly workspaceId: string
  readonly packageRoot: string
  readonly repository: GitRepository
  readonly base: GitBase
  readonly contextToken: string
  readonly committedManifestText: string | null
  readonly baselineManifestText: string | null
  readonly committedFiles: readonly GitCommittedPackageFile[]
  readonly committedIndexText: string | null
  readonly workingIndexText: string | null
  readonly workingIndexHash: string | null
}
export interface GitPackageVersionRequest {
  readonly contextToken: string
  /** A fresh post-preparation snapshot; null requests verified whole-package deletion. */
  readonly sourceSnapshotToken: string | null
  readonly expectedIndexHash: string
  readonly version: string | null
  readonly message: string
}
export interface GitPackageVersionPreview {
  readonly authorizationToken: string
  readonly packageRoot: string
  readonly base: GitBase
  readonly version: string | null
  readonly message: string
  /** Exact repository-relative changed paths, including deletions. */
  readonly changedPaths: readonly string[]
  readonly diff: string
}
