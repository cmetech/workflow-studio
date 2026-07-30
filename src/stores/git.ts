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

export function setGitLoading(inspection: GitInspection = $gitState.get().inspection): void {
  $gitState.set(Object.freeze({ phase: 'loading', inspection: freezeInspection(inspection), error: null }))
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

let nextControllerId = 0
let activeControllerId = 0

export function createGitInspectionController(native: GitNativeBridge) {
  const controllerId = ++nextControllerId
  activeControllerId = controllerId
  resetGitState()
  let generation = 0
  let previewGeneration = 0
  let nativeRequestGeneration = 0
  let disposed = false
  let activeToken: string | null = null
  let disposePromise: Promise<void> | null = null
  let sessionAttempt: HistorySessionAttempt | null = null
  let activeSession: HistorySession | null = null

  function ownsPublication(): boolean {
    return !disposed && activeControllerId === controllerId
  }

  function publicationIsCurrent(request: number): boolean {
    return request === generation && ownsPublication()
  }

  async function publishRepository(): Promise<void> {
    const request = ++generation
    previewGeneration += 1
    const previousToken = activeToken
    activeToken = null
    if (ownsPublication()) setGitLoading(emptyGitInspection)
    await revoke(previousToken)
    if (!publicationIsCurrent(request)) return
    try {
      const inspection = await inspectGitRepository(native)
      if (!publicationIsCurrent(request)) return
      setGitInspection(inspection)
    } catch (error: unknown) {
      if (publicationIsCurrent(request)) {
        setGitError(error instanceof Error ? error.message : 'Local Git inspection failed.')
      }
    }
  }

  async function publishPair(pair: GitPairPaths): Promise<void> {
    const request = ++generation
    previewGeneration += 1
    const previousToken = activeToken
    activeToken = null
    if (ownsPublication()) setGitLoading(emptyGitInspection)
    await revoke(previousToken)
    if (!publicationIsCurrent(request)) return
    try {
      const inspection = await loadPairInspection(pair, request, () => publicationIsCurrent(request), 1)
      if (!inspection) return
      const token = inspection.historyAuthorizationToken ?? null
      if (!publicationIsCurrent(request)) {
        await revoke(token)
        return
      }
      activeToken = token
      setGitInspection(inspection)
    } catch (error: unknown) {
      if (error instanceof InactiveGitControllerError) return
      if (publicationIsCurrent(request)) {
        setGitError(error instanceof Error ? error.message : 'Local Git inspection failed.')
      }
    }
  }

  async function loadPairInspection(
    pair: GitPairPaths,
    request: number,
    isCurrent: () => boolean,
    contextRetries: number,
  ): Promise<GitInspection | null> {
    let session: HistorySession | null = null
    let token: string | null = null
    let nativeRequest = 0
    try {
      const inspection = await inspectGitPair(native, pair, async () => {
        if (!isCurrent()) throw new InactiveGitControllerError()
        session = await acquireHistorySession()
        if (!isCurrent()) throw new InactiveGitControllerError()
        nativeRequest = ++nativeRequestGeneration
        return { controllerEpoch: session.epoch, requestGeneration: nativeRequest }
      })
      token = inspection.historyAuthorizationToken ?? null
      if (!isCurrent()) {
        await revoke(token)
        return null
      }
      if (token) {
        await native.gitRetainHistoryAuthorization(token, session!.epoch, nativeRequest)
        if (!isCurrent()) {
          await revoke(token)
          return null
        }
      }
      return inspection
    } catch (error: unknown) {
      await revoke(token)
      if (!isCurrent()) return null
      if (isContextChanged(error) && contextRetries > 0) {
        if (session) await retireHistorySession(session)
        if (!isCurrent()) return null
        return loadPairInspection(pair, request, isCurrent, contextRetries - 1)
      }
      throw error
    }
  }

  async function acquireHistorySession(): Promise<HistorySession> {
    if (activeSession) return activeSession
    if (sessionAttempt) return sessionAttempt.adopted
    const raw = native.gitBeginHistorySession()
    const attempt = { raw, adopted: Promise.resolve(null as never), cleanup: null } as HistorySessionAttempt
    attempt.adopted = raw.then(
      async (epoch) => {
        if (sessionAttempt === attempt) sessionAttempt = null
        if (!ownsPublication()) {
          await retireSessionAttempt(attempt)
          throw new InactiveGitControllerError()
        }
        const session = { epoch, attempt }
        activeSession = session
        return session
      },
      (error: unknown) => {
        if (sessionAttempt === attempt) sessionAttempt = null
        throw error
      },
    )
    sessionAttempt = attempt
    return attempt.adopted
  }

  function retireSessionAttempt(attempt: HistorySessionAttempt): Promise<void> {
    attempt.cleanup ??= attempt.raw.then(
      (epoch) => native.gitDisposeHistorySession(epoch),
      () => undefined,
    )
    return attempt.cleanup
  }

  function retireHistorySession(session: HistorySession): Promise<void> {
    if (activeSession === session) activeSession = null
    return retireSessionAttempt(session.attempt)
  }

  function previewIsCurrent(request: number, inspectionGeneration: number, root: string, pair: GitPairPaths): boolean {
    if (request !== previewGeneration || inspectionGeneration !== generation || !ownsPublication()) return false
    const current = $gitState.get().inspection
    return current.repository?.root === root && samePair(current.pair, pair)
  }

  async function recoverPreviewAuthority(
    request: number,
    inspectionGeneration: number,
    root: string,
    pair: GitPairPaths,
  ): Promise<string | null> {
    const isCurrent = () => previewIsCurrent(request, inspectionGeneration, root, pair)
    const session = activeSession
    if (session) await retireHistorySession(session)
    if (!isCurrent()) return null
    const inspection = await loadPairInspection(pair, inspectionGeneration, isCurrent, 1)
    if (!inspection) return null
    const token = inspection.historyAuthorizationToken ?? null
    if (!token || !isCurrent()) {
      await revoke(token)
      return null
    }
    const previousToken = activeToken
    activeToken = token
    setGitInspection(inspection)
    if (previousToken !== token) await revoke(previousToken)
    if (!isCurrent()) {
      await revoke(token)
      return null
    }
    return token
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
      const token = activeToken
      activeToken = null
      generation += 1
      previewGeneration += 1
      if (ownsPublication()) resetGitState()
      void revoke(token)
    },
    refreshRepository(): Promise<void> {
      return publishRepository()
    },
    refreshPair(pair: GitPairPaths): Promise<void> {
      return publishPair(pair)
    },
    async loadCommit(oid: string, pair: GitPairPaths): Promise<GitPairSnapshot | null> {
      if (!ownsPublication()) return Promise.reject(new Error('The Git inspection controller is no longer active.'))
      const state = $gitState.get().inspection
      const root = state.repository?.root
      if (!root) return Promise.reject(new Error('Open a workflow in a Git repository first.'))
      if (!samePair(state.pair, pair)) return Promise.reject(new Error('The selected workflow pair changed.'))
      const authorizationToken = state.historyAuthorizationToken
      if (!authorizationToken) return Promise.reject(new Error('Reload workflow history before previewing a commit.'))
      const request = ++previewGeneration
      const inspectionGeneration = generation
      let token = authorizationToken
      let snapshot: GitPairSnapshot
      try {
        snapshot = await loadGitCommit(native, root, oid, token, pair)
      } catch (error: unknown) {
        if (!isPreviewAuthorityLoss(error) || !previewIsCurrent(request, inspectionGeneration, root, pair)) throw error
        const recoveredToken = await recoverPreviewAuthority(request, inspectionGeneration, root, pair)
        if (!recoveredToken) return null
        token = recoveredToken
        if (!previewIsCurrent(request, inspectionGeneration, root, pair)) return null
        snapshot = await loadGitCommit(native, root, oid, token, pair)
      }
      if (!previewIsCurrent(request, inspectionGeneration, root, pair)) return null
      const current = $gitState.get().inspection
      if (snapshot.oid !== oid || current.historyAuthorizationToken !== token) {
        return null
      }
      return snapshot
    },
    dispose(): Promise<void> {
      if (disposePromise) return disposePromise
      disposed = true
      generation += 1
      previewGeneration += 1
      const token = activeToken
      activeToken = null
      if (activeControllerId === controllerId) {
        activeControllerId = 0
        resetGitState()
      }
      const attempt = activeSession?.attempt ?? sessionAttempt
      activeSession = null
      sessionAttempt = null
      disposePromise = Promise.allSettled([
        revoke(token),
        attempt ? retireSessionAttempt(attempt) : Promise.resolve(),
      ]).then((results) => {
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (rejected) throw rejected.reason
      })
      return disposePromise
    },
  }
}

interface HistorySessionAttempt {
  readonly raw: Promise<number>
  adopted: Promise<HistorySession>
  cleanup: Promise<void> | null
}

interface HistorySession {
  readonly epoch: number
  readonly attempt: HistorySessionAttempt
}

class InactiveGitControllerError extends Error {}

function isContextChanged(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'git_context_changed'
  )
}

function isPreviewAuthorityLoss(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as { readonly code?: unknown }).code
  return code === 'git_context_changed' || code === 'git_pair_not_authorized'
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
