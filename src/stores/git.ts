import { atom } from 'nanostores'
import { inspectGitPair, inspectGitRepository, loadGitCommit } from '$src/lib/git/git-api'
import type { GitInspection, GitPairPaths, GitPairSnapshot } from '$src/lib/git/types'
import { emptyGitInspection } from '$src/lib/git/types'
import type { GitNativeBridge } from '$src/lib/native/types'

export type GitViewState =
  | { readonly phase: 'idle'; readonly inspection: GitInspection; readonly error: null }
  | { readonly phase: 'loading'; readonly inspection: GitInspection; readonly error: null }
  | { readonly phase: 'ready'; readonly inspection: GitInspection; readonly error: null }
  | { readonly phase: 'error'; readonly inspection: GitInspection; readonly error: string }

const initialState: GitViewState = Object.freeze({ phase: 'idle', inspection: emptyGitInspection, error: null })

export const $gitState = atom<GitViewState>(initialState)
export const gitState = $gitState

export function setGitLoading(): void {
  $gitState.set(Object.freeze({ phase: 'loading', inspection: $gitState.get().inspection, error: null }))
}

export function setGitInspection(inspection: GitInspection): void {
  $gitState.set(Object.freeze({ phase: 'ready', inspection: freezeInspection(inspection), error: null }))
}

export function setGitError(message: string): void {
  $gitState.set(Object.freeze({ phase: 'error', inspection: $gitState.get().inspection, error: message }))
}

export function resetGitState(): void {
  $gitState.set(initialState)
}

export function createGitInspectionController(native: GitNativeBridge) {
  let generation = 0
  let previewGeneration = 0

  async function publish(load: () => Promise<GitInspection>): Promise<void> {
    const request = ++generation
    previewGeneration += 1
    setGitLoading()
    let inspection: GitInspection | undefined
    try {
      inspection = await load()
    } catch (error: unknown) {
      if (request === generation) {
        setGitError(error instanceof Error ? error.message : 'Local Git inspection failed.')
      }
      return
    }
    const token = inspection.historyAuthorizationToken ?? null
    if (request !== generation) {
      await revoke(token)
      return
    }
    if (token) {
      try {
        await native.gitRetainHistoryAuthorization(token)
      } catch (error: unknown) {
        await revoke(token)
        if (request === generation) {
          setGitError(error instanceof Error ? error.message : 'Local Git history authorization failed.')
        }
        return
      }
    }
    if (request !== generation) {
      await revoke(token)
      return
    }
    const previousToken = $gitState.get().inspection.historyAuthorizationToken ?? null
    setGitInspection(inspection)
    if (previousToken !== token) {
      await revoke(previousToken)
    }
  }

  async function revoke(token: string | null): Promise<void> {
    if (!token) return
    try {
      await native.gitRevokeHistoryAuthorization(token)
    } catch {
      // Revocation is best-effort here; native state is also bounded and cleared
      // whenever the workspace capability changes.
    }
  }

  return {
    reset(): void {
      const token = $gitState.get().inspection.historyAuthorizationToken ?? null
      generation += 1
      previewGeneration += 1
      resetGitState()
      void revoke(token)
    },
    refreshRepository(): Promise<void> {
      return publish(() => inspectGitRepository(native))
    },
    refreshPair(pair: GitPairPaths): Promise<void> {
      return publish(() => inspectGitPair(native, pair))
    },
    async loadCommit(oid: string, pair: GitPairPaths): Promise<GitPairSnapshot | null> {
      const state = $gitState.get().inspection
      const root = state.repository?.root
      if (!root) return Promise.reject(new Error('Open a workflow in a Git repository first.'))
      if (!samePair(state.pair, pair)) return Promise.reject(new Error('The selected workflow pair changed.'))
      const authorizationToken = state.historyAuthorizationToken
      if (!authorizationToken) return Promise.reject(new Error('Reload workflow history before previewing a commit.'))
      const request = ++previewGeneration
      const inspectionGeneration = generation
      const snapshot = await loadGitCommit(native, root, oid, authorizationToken, pair)
      const current = $gitState.get().inspection
      if (
        request !== previewGeneration ||
        inspectionGeneration !== generation ||
        snapshot.oid !== oid ||
        current.repository?.root !== root ||
        current.historyAuthorizationToken !== authorizationToken ||
        !samePair(current.pair, pair)
      ) {
        return null
      }
      return snapshot
    },
  }
}

export interface GitLifecycleController {
  reset(): void
  refreshRepository(): Promise<void>
  refreshPair(pair: GitPairPaths): Promise<void>
}

export function synchronizeGitLifecycle(
  controller: GitLifecycleController,
  context: { readonly workspaceId: string | null; readonly pair: GitPairPaths | null },
): Promise<void> {
  if (!context.workspaceId) {
    controller.reset()
    return Promise.resolve()
  }
  return context.pair ? controller.refreshPair(context.pair) : controller.refreshRepository()
}

function samePair(left: GitPairPaths | null | undefined, right: GitPairPaths): boolean {
  return left?.definitionPath === right.definitionPath && left.companionPath === right.companionPath
}

function freezeInspection(inspection: GitInspection): GitInspection {
  return Object.freeze({
    pair: inspection.pair ? Object.freeze({ ...inspection.pair }) : null,
    repository: inspection.repository ? Object.freeze({ ...inspection.repository }) : null,
    status: Object.freeze({
      entries: Object.freeze(inspection.status.entries.map((entry) => Object.freeze({ ...entry }))),
    }),
    diff: Object.freeze({ ...inspection.diff }),
    history: Object.freeze(inspection.history.map((commit) => Object.freeze({ ...commit }))),
    historyAuthorizationToken: inspection.historyAuthorizationToken ?? null,
  })
}
