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

  async function publish(load: () => Promise<GitInspection>): Promise<void> {
    const request = ++generation
    setGitLoading()
    try {
      const inspection = await load()
      if (request === generation) setGitInspection(inspection)
    } catch (error: unknown) {
      if (request === generation) {
        setGitError(error instanceof Error ? error.message : 'Local Git inspection failed.')
      }
    }
  }

  return {
    reset(): void {
      generation += 1
      resetGitState()
    },
    refreshRepository(): Promise<void> {
      return publish(() => inspectGitRepository(native))
    },
    refreshPair(pair: GitPairPaths): Promise<void> {
      return publish(() => inspectGitPair(native, pair))
    },
    loadCommit(oid: string, pair: GitPairPaths): Promise<GitPairSnapshot> {
      const root = $gitState.get().inspection.repository?.root
      if (!root) return Promise.reject(new Error('Open a workflow in a Git repository first.'))
      return loadGitCommit(native, root, oid, pair)
    },
  }
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
  })
}
