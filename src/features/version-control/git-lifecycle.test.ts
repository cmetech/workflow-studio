import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeError, type GitNativeBridge } from '$src/lib/native/types'
import { $gitState, createGitInspectionController, resetGitState, synchronizeGitLifecycle } from '$src/stores/git'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function nativeFixture(): GitNativeBridge {
  return {
    hostHealth: async () => ({ appVersion: 'test', os: 'linux', arch: 'x64' }),
    gitBeginHistorySession: vi.fn(async () => 1),
    gitDetect: vi.fn(async () => ({ root: '/repo', branch: 'main', detachedHead: null })),
    gitStatus: vi.fn(async () => ({ entries: [] })),
    gitDiffPair: vi.fn(async () => ({ working: '', index: '' })),
    gitHistoryPair: vi.fn(async () => ({ commits: [], authorizationToken: 'default-token' })),
    gitRetainHistoryAuthorization: vi.fn(async () => undefined),
    gitRevokeHistoryAuthorization: vi.fn(async () => undefined),
    gitDisposeHistorySession: vi.fn(async () => undefined),
    gitShowPair: vi.fn(),
  }
}

describe('Git inspection lifecycle', () => {
  afterEach(resetGitState)

  it('publishes only the latest historical OID when deferred previews resolve in reverse order', async () => {
    const native = nativeFixture()
    const first = deferred<{ oid: string; definition: string; companion: null }>()
    const second = deferred<{ oid: string; definition: string; companion: null }>()
    vi.mocked(native.gitShowPair).mockImplementation(async (_root, oid) =>
      oid === 'aaaaaaaa' ? first.promise : second.promise,
    )
    const controller = createGitInspectionController(native)
    const pair = { definitionPath: 'flow.yaml', companionPath: null }
    await controller.refreshPair(pair)

    const loadA = controller.loadCommit('aaaaaaaa', pair)
    const loadB = controller.loadCommit('bbbbbbbb', pair)
    second.resolve({ oid: 'bbbbbbbb', definition: 'name: B\n', companion: null })
    expect((await loadB)?.definition).toBe('name: B\n')
    first.resolve({ oid: 'aaaaaaaa', definition: 'name: A\n', companion: null })
    expect(await loadA).toBeNull()
  })

  it('discards a historical result after the pair or repository identity changes', async () => {
    const native = nativeFixture()
    const pending = deferred<{ oid: string; definition: string; companion: null }>()
    vi.mocked(native.gitShowPair).mockReturnValue(pending.promise)
    const controller = createGitInspectionController(native)
    const pairA = { definitionPath: 'a.yaml', companionPath: null }
    await controller.refreshPair(pairA)
    const preview = controller.loadCommit('aaaaaaaa', pairA)

    vi.mocked(native.gitDetect).mockResolvedValue({ root: '/other-repo', branch: 'main', detachedHead: null })
    await controller.refreshPair({ definitionPath: 'b.yaml', companionPath: null })
    pending.resolve({ oid: 'aaaaaaaa', definition: 'name: stale\n', companion: null })
    expect(await preview).toBeNull()
  })

  it('retains only the same-pair renderer winner when older history and eviction pressure resolve later', async () => {
    const native = nativeFixture()
    let tokenSequence = 0
    vi.mocked(native.gitHistoryPair).mockImplementation(async () => ({
      commits: [],
      authorizationToken: `token-${tokenSequence++}`,
    }))
    const pendingRetains: ReturnType<typeof deferred<void>>[] = []
    vi.mocked(native.gitRetainHistoryAuthorization).mockImplementation(async () => {
      const result = deferred<void>()
      pendingRetains.push(result)
      return result.promise
    })
    vi.mocked(native.gitShowPair).mockResolvedValue({
      oid: 'bbbbbbbb',
      definition: 'name: B\n',
      companion: null,
    })
    const controller = createGitInspectionController(native)
    const pair = { definitionPath: 'flow.yaml', companionPath: null }

    const obsolete: Promise<void>[] = []
    for (let index = 0; index < 17; index += 1) {
      const obsoletePair = { definitionPath: `obsolete-${index}.yaml`, companionPath: null }
      obsolete.push(controller.refreshPair(obsoletePair))
      await vi.waitFor(() => expect(pendingRetains).toHaveLength(index + 1))
    }
    const winningRefresh = controller.refreshPair(pair)
    await vi.waitFor(() => expect(pendingRetains).toHaveLength(18))
    pendingRetains[17]!.resolve()
    await winningRefresh
    for (let index = 0; index < 17; index += 1) pendingRetains[index]!.resolve()
    await Promise.all(obsolete)

    const snapshot = await controller.loadCommit('bbbbbbbb', pair)
    expect(snapshot?.definition).toBe('name: B\n')
    expect(native.gitRetainHistoryAuthorization).toHaveBeenCalledTimes(18)
    expect(native.gitRetainHistoryAuthorization).toHaveBeenLastCalledWith('token-17', 1, 18)
    for (let index = 0; index < 17; index += 1) {
      expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith(`token-${index}`)
    }
    expect(native.gitShowPair).toHaveBeenCalledWith('/repo', 'bbbbbbbb', 'token-17', 'flow.yaml', null)
  })

  it('resets without a workspace, refreshes repository-only without a pair, and refreshes the pair when open', async () => {
    const controller = {
      reset: vi.fn(),
      refreshRepository: vi.fn(async () => undefined),
      refreshPair: vi.fn(async () => undefined),
    }
    await synchronizeGitLifecycle(controller, { workspaceId: null, pair: null })
    expect(controller.reset).toHaveBeenCalledOnce()

    await synchronizeGitLifecycle(controller, { workspaceId: 'workspace', pair: null })
    expect(controller.refreshRepository).toHaveBeenCalledOnce()

    const pair = { definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' }
    await synchronizeGitLifecycle(controller, { workspaceId: 'workspace', pair })
    expect(controller.refreshPair).toHaveBeenCalledWith(pair)
  })

  it('prevents an old controller from publishing or revoking a newly mounted controller winner', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitBeginHistorySession).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    const oldHistory = deferred<{ commits: readonly never[]; authorizationToken: string }>()
    vi.mocked(native.gitHistoryPair)
      .mockReturnValueOnce(oldHistory.promise)
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'new-token' })
    const oldController = createGitInspectionController(native)
    const oldRefresh = oldController.refreshPair({ definitionPath: 'old.yaml', companionPath: null })
    await vi.waitFor(() => expect(native.gitHistoryPair).toHaveBeenCalledTimes(1))
    const newController = createGitInspectionController(native)
    await newController.refreshPair({ definitionPath: 'new.yaml', companionPath: null })

    oldHistory.resolve({ commits: [], authorizationToken: 'old-token' })
    await oldRefresh
    await oldController.dispose()

    expect($gitState.get().inspection.pair?.definitionPath).toBe('new.yaml')
    expect($gitState.get().inspection.historyAuthorizationToken).toBe('new-token')
    expect(native.gitRetainHistoryAuthorization).toHaveBeenCalledWith('new-token', 2, 1)
    expect(native.gitRetainHistoryAuthorization).not.toHaveBeenCalledWith('old-token', 1, 1)
    expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith('old-token')
    expect(native.gitDisposeHistorySession).toHaveBeenCalledWith(1)
  })

  it('disposes once, invalidates in-flight work, and revokes late provisional authority', async () => {
    const native = nativeFixture()
    const history = deferred<{ commits: readonly never[]; authorizationToken: string }>()
    vi.mocked(native.gitHistoryPair).mockReturnValue(history.promise)
    const controller = createGitInspectionController(native)
    const refresh = controller.refreshPair({ definitionPath: 'flow.yaml', companionPath: null })
    await vi.waitFor(() => expect(native.gitHistoryPair).toHaveBeenCalledTimes(1))

    const firstDispose = controller.dispose()
    const secondDispose = controller.dispose()
    expect(secondDispose).toBe(firstDispose)
    await firstDispose
    history.resolve({ commits: [], authorizationToken: 'late-token' })
    await refresh

    expect(native.gitDisposeHistorySession).toHaveBeenCalledTimes(1)
    expect(native.gitDisposeHistorySession).toHaveBeenCalledWith(1)
    expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith('late-token')
    expect($gitState.get().inspection.historyAuthorizationToken).toBeNull()
  })

  it('clears and revokes the prior pair when a replacement refresh fails', async () => {
    const native = nativeFixture()
    const controller = createGitInspectionController(native)
    await controller.refreshPair({ definitionPath: 'a.yaml', companionPath: null })
    vi.mocked(native.gitHistoryPair).mockClear()
    vi.mocked(native.gitStatus).mockRejectedValueOnce(new Error('replacement failed'))

    await controller.refreshPair({ definitionPath: 'b.yaml', companionPath: null })

    expect($gitState.get().phase).toBe('error')
    expect($gitState.get().inspection.pair).toBeNull()
    expect($gitState.get().inspection.historyAuthorizationToken).toBeNull()
    expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith('default-token')
    expect(native.gitHistoryPair).not.toHaveBeenCalled()
  })

  it('retains only the new winner after a successful pair switch', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitHistoryPair)
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'token-a' })
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'token-b' })
    const controller = createGitInspectionController(native)
    await controller.refreshPair({ definitionPath: 'a.yaml', companionPath: null })
    await controller.refreshPair({ definitionPath: 'b.yaml', companionPath: null })

    expect(native.gitRetainHistoryAuthorization).toHaveBeenNthCalledWith(1, 'token-a', 1, 1)
    expect(native.gitRetainHistoryAuthorization).toHaveBeenNthCalledWith(2, 'token-b', 1, 2)
    expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith('token-a')
    expect($gitState.get().inspection.historyAuthorizationToken).toBe('token-b')
  })

  it('retries session acquisition after an initial begin rejection', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitBeginHistorySession)
      .mockRejectedValueOnce(new Error('session unavailable'))
      .mockResolvedValueOnce(2)
    const controller = createGitInspectionController(native)
    const pair = { definitionPath: 'flow.yaml', companionPath: null }

    await controller.refreshPair(pair)
    expect($gitState.get().phase).toBe('error')

    await controller.refreshPair(pair)

    expect($gitState.get().phase).toBe('ready')
    expect($gitState.get().inspection.pair).toEqual(pair)
    expect(native.gitBeginHistorySession).toHaveBeenCalledTimes(2)
    expect(native.gitRetainHistoryAuthorization).toHaveBeenCalledWith('default-token', 2, 1)
  })

  it('never acquires a history session for repository-only inspection or disposal', async () => {
    const native = nativeFixture()
    const controller = createGitInspectionController(native)

    await controller.refreshRepository()
    await controller.dispose()

    expect($gitState.get().phase).toBe('idle')
    expect(native.gitBeginHistorySession).not.toHaveBeenCalled()
    expect(native.gitDisposeHistorySession).not.toHaveBeenCalled()
  })

  it('recovers preview authority from the native error returned when an old controller session activates later', async () => {
    const native = nativeFixture()
    const oldBegin = deferred<number>()
    vi.mocked(native.gitBeginHistorySession)
      .mockReturnValueOnce(oldBegin.promise)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
    vi.mocked(native.gitHistoryPair)
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'new-token' })
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'recovered-token' })
    vi.mocked(native.gitShowPair)
      .mockRejectedValueOnce(new NativeError('git_pair_not_authorized', 'old controller activation revoked the token'))
      .mockResolvedValueOnce({ oid: 'aaaaaaaa', definition: 'name: recovered\n', companion: null })

    const oldController = createGitInspectionController(native)
    const oldRefresh = oldController.refreshPair({ definitionPath: 'old.yaml', companionPath: null })
    await vi.waitFor(() => expect(native.gitBeginHistorySession).toHaveBeenCalledTimes(1))

    const newController = createGitInspectionController(native)
    const pair = { definitionPath: 'new.yaml', companionPath: null }
    await newController.refreshPair(pair)
    oldBegin.resolve(2)
    await oldRefresh

    const snapshot = await newController.loadCommit('aaaaaaaa', pair)

    expect(snapshot?.definition).toBe('name: recovered\n')
    expect(native.gitBeginHistorySession).toHaveBeenCalledTimes(3)
    expect(native.gitDisposeHistorySession).toHaveBeenCalledWith(2)
    expect(native.gitRetainHistoryAuthorization).toHaveBeenCalledWith('recovered-token', 3, 2)
    expect(native.gitShowPair).toHaveBeenNthCalledWith(2, '/repo', 'aaaaaaaa', 'recovered-token', 'new.yaml', null)
    expect($gitState.get().inspection.historyAuthorizationToken).toBe('recovered-token')
  })

  it('bounds native pair-not-authorized preview recovery to one retry', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitBeginHistorySession).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    vi.mocked(native.gitHistoryPair)
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'initial-token' })
      .mockResolvedValueOnce({ commits: [], authorizationToken: 'recovered-token' })
    vi.mocked(native.gitShowPair).mockRejectedValue(
      new NativeError('git_pair_not_authorized', 'the preview capability remains unauthorized'),
    )
    const controller = createGitInspectionController(native)
    const pair = { definitionPath: 'flow.yaml', companionPath: null }
    await controller.refreshPair(pair)

    await expect(controller.loadCommit('aaaaaaaa', pair)).rejects.toMatchObject({
      code: 'git_pair_not_authorized',
    })

    expect(native.gitBeginHistorySession).toHaveBeenCalledTimes(2)
    expect(native.gitHistoryPair).toHaveBeenCalledTimes(2)
    expect(native.gitShowPair).toHaveBeenCalledTimes(2)
    expect(native.gitShowPair).toHaveBeenLastCalledWith('/repo', 'aaaaaaaa', 'recovered-token', 'flow.yaml', null)
  })

  it('does not revoke recovered preview authority when a restarted session reissues the token value', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitBeginHistorySession).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    vi.mocked(native.gitShowPair)
      .mockRejectedValueOnce(new NativeError('git_context_changed', 'session changed'))
      .mockResolvedValueOnce({ oid: 'aaaaaaaa', definition: 'name: recovered\n', companion: null })
    const controller = createGitInspectionController(native)
    const pair = { definitionPath: 'flow.yaml', companionPath: null }
    await controller.refreshPair(pair)

    const snapshot = await controller.loadCommit('aaaaaaaa', pair)

    expect(snapshot?.definition).toBe('name: recovered\n')
    expect(native.gitRevokeHistoryAuthorization).not.toHaveBeenCalledWith('default-token')
  })

  it('disposes a late session resolution without publishing or creating history authority', async () => {
    const native = nativeFixture()
    const begin = deferred<number>()
    vi.mocked(native.gitBeginHistorySession).mockReturnValue(begin.promise)
    const controller = createGitInspectionController(native)
    const refresh = controller.refreshPair({ definitionPath: 'flow.yaml', companionPath: null })
    await vi.waitFor(() => expect(native.gitBeginHistorySession).toHaveBeenCalledOnce())

    const disposal = controller.dispose()
    begin.resolve(7)
    await Promise.all([refresh, disposal])

    expect(native.gitDisposeHistorySession).toHaveBeenCalledOnce()
    expect(native.gitDisposeHistorySession).toHaveBeenCalledWith(7)
    expect(native.gitHistoryPair).not.toHaveBeenCalled()
    expect(native.gitRetainHistoryAuthorization).not.toHaveBeenCalled()
    expect($gitState.get().phase).toBe('idle')
  })

  it('does not turn a rejected in-flight begin into a disposal failure', async () => {
    const native = nativeFixture()
    const begin = deferred<number>()
    vi.mocked(native.gitBeginHistorySession).mockReturnValue(begin.promise)
    const controller = createGitInspectionController(native)
    const refresh = controller.refreshPair({ definitionPath: 'flow.yaml', companionPath: null })
    await vi.waitFor(() => expect(native.gitBeginHistorySession).toHaveBeenCalledOnce())

    const disposal = controller.dispose()
    begin.reject(new Error('begin failed'))

    await expect(disposal).resolves.toBeUndefined()
    await refresh
    expect(native.gitDisposeHistorySession).not.toHaveBeenCalled()
    expect($gitState.get().phase).toBe('idle')
  })

  it('shares one in-flight session acquisition across concurrent refreshes', async () => {
    const native = nativeFixture()
    const begin = deferred<number>()
    vi.mocked(native.gitBeginHistorySession).mockReturnValue(begin.promise)
    const controller = createGitInspectionController(native)

    const first = controller.refreshPair({ definitionPath: 'first.yaml', companionPath: null })
    const second = controller.refreshPair({ definitionPath: 'second.yaml', companionPath: null })
    await vi.waitFor(() => expect(native.gitBeginHistorySession).toHaveBeenCalledOnce())
    begin.resolve(9)
    await Promise.all([first, second])

    expect(native.gitBeginHistorySession).toHaveBeenCalledOnce()
    expect(native.gitHistoryPair).toHaveBeenCalledOnce()
    expect(native.gitHistoryPair).toHaveBeenCalledWith('/repo', 'second.yaml', null, 9, 1)
    expect($gitState.get().inspection.pair?.definitionPath).toBe('second.yaml')
  })

  it('bounds current context-change recovery to one fresh session', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitBeginHistorySession).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    vi.mocked(native.gitHistoryPair).mockRejectedValue(
      new NativeError('git_context_changed', 'the native context keeps changing'),
    )
    const controller = createGitInspectionController(native)

    await controller.refreshPair({ definitionPath: 'flow.yaml', companionPath: null })

    expect(native.gitBeginHistorySession).toHaveBeenCalledTimes(2)
    expect(native.gitHistoryPair).toHaveBeenCalledTimes(2)
    expect($gitState.get().phase).toBe('error')
    expect($gitState.get().error).toBe('the native context keeps changing')
  })
})
