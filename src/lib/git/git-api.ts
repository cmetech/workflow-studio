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
    diff: { working: '', index: '', authorizationToken: '' },
    history: [],
  }
}

export async function inspectGitPair(
  native: GitNativeBridge,
  pair: GitPairPaths,
  acquireActivation: () => Promise<{ readonly controllerEpoch: number; readonly requestGeneration: number }>,
): Promise<GitInspection> {
  const repository = await native.gitDetect()
  if (!repository) return emptyGitInspection
  const [status, diff] = await Promise.all([
    native.gitStatus(repository.root),
    native.gitDiffPair(repository.root, pair.definitionPath, pair.companionPath),
  ])
  const activation = await acquireActivation()
  const history = await native.gitHistoryPair(
    repository.root,
    pair.definitionPath,
    pair.companionPath,
    activation.controllerEpoch,
    activation.requestGeneration,
  )
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
    history: history.commits,
    historyAuthorizationToken: history.authorizationToken,
  }
}

export function loadGitCommit(
  native: GitNativeBridge,
  root: string,
  oid: string,
  authorizationToken: string,
  pair: GitPairPaths,
): Promise<GitPairSnapshot> {
  return native.gitShowPair(root, oid, authorizationToken, pair.definitionPath, pair.companionPath)
}
