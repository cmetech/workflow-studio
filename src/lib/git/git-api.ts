import type { GitNativeBridge } from '$src/lib/native/types'
import type { GitInspection, GitPairPaths, GitPairSnapshot } from './types'
import { emptyGitInspection } from './types'

export async function inspectGitRepository(native: GitNativeBridge): Promise<GitInspection> {
  const repository = await native.gitDetect()
  if (!repository) return emptyGitInspection
  return {
    pair: null,
    repository,
    status: await native.gitStatus(repository.root),
    diff: { working: '', index: '' },
    history: [],
  }
}

export async function inspectGitPair(native: GitNativeBridge, pair: GitPairPaths): Promise<GitInspection> {
  const repository = await native.gitDetect()
  if (!repository) return emptyGitInspection
  const [status, diff, history] = await Promise.all([
    native.gitStatus(repository.root),
    native.gitDiffPair(repository.root, pair.definitionPath, pair.companionPath),
    native.gitHistoryPair(repository.root, pair.definitionPath, pair.companionPath),
  ])
  const pairPaths = new Set([pair.definitionPath, pair.companionPath].filter((path): path is string => path !== null))
  return {
    pair,
    repository,
    status: {
      entries: status.entries.filter(
        ({ path, originalPath }) => pairPaths.has(path) || (originalPath !== undefined && pairPaths.has(originalPath)),
      ),
    },
    diff,
    history,
  }
}

export function loadGitCommit(
  native: GitNativeBridge,
  root: string,
  oid: string,
  pair: GitPairPaths,
): Promise<GitPairSnapshot> {
  return native.gitShowPair(root, oid, pair.definitionPath, pair.companionPath)
}
