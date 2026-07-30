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

export interface GitVersionResult {
  readonly oid: string
  readonly status: GitStatus
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
