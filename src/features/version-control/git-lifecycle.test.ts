import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitNativeBridge } from '$src/lib/native/types'
import { createGitInspectionController, resetGitState, synchronizeGitLifecycle } from '$src/stores/git'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function nativeFixture(): GitNativeBridge {
  return {
    hostHealth: async () => ({ appVersion: 'test', os: 'linux', arch: 'x64' }),
    gitDetect: vi.fn(async () => ({ root: '/repo', branch: 'main', detachedHead: null })),
    gitStatus: vi.fn(async () => ({ entries: [] })),
    gitDiffPair: vi.fn(async () => ({ working: '', index: '' })),
    gitHistoryPair: vi.fn(async () => ({ commits: [], authorizationToken: 'default-token' })),
    gitRetainHistoryAuthorization: vi.fn(async () => undefined),
    gitRevokeHistoryAuthorization: vi.fn(async () => undefined),
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
    const pending = new Map<
      string,
      ReturnType<typeof deferred<{ commits: readonly never[]; authorizationToken: string }>>
    >()
    vi.mocked(native.gitHistoryPair).mockImplementation(async (_root, definitionPath) => {
      const result = deferred<{ commits: readonly never[]; authorizationToken: string }>()
      pending.set(definitionPath, result)
      return result.promise
    })
    vi.mocked(native.gitShowPair).mockResolvedValue({
      oid: 'bbbbbbbb',
      definition: 'name: B\n',
      companion: null,
    })
    const controller = createGitInspectionController(native)
    const pair = { definitionPath: 'flow.yaml', companionPath: null }

    const oldSamePair = controller.refreshPair(pair)
    await vi.waitFor(() => expect(pending.has('flow.yaml')).toBe(true))
    const oldFlow = pending.get('flow.yaml')!
    const obsolete = Array.from({ length: 17 }, (_, index) => {
      const obsoletePair = { definitionPath: `obsolete-${index}.yaml`, companionPath: null }
      return controller.refreshPair(obsoletePair)
    })
    await vi.waitFor(() => expect(pending.size).toBe(18))
    const winningRefresh = controller.refreshPair(pair)
    await vi.waitFor(() => expect(vi.mocked(native.gitHistoryPair).mock.calls).toHaveLength(19))
    const winningFlow = pending.get('flow.yaml')!
    expect(winningFlow).not.toBe(oldFlow)

    winningFlow.resolve({ commits: [], authorizationToken: 'token-b' })
    await winningRefresh
    for (let index = 0; index < obsolete.length; index += 1) {
      pending.get(`obsolete-${index}.yaml`)!.resolve({ commits: [], authorizationToken: `obsolete-${index}` })
    }
    oldFlow.resolve({ commits: [], authorizationToken: 'token-a' })
    await Promise.all([oldSamePair, ...obsolete])

    const snapshot = await controller.loadCommit('bbbbbbbb', pair)
    expect(snapshot?.definition).toBe('name: B\n')
    expect(native.gitRetainHistoryAuthorization).toHaveBeenCalledTimes(1)
    expect(native.gitRetainHistoryAuthorization).toHaveBeenCalledWith('token-b')
    expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith('token-a')
    for (let index = 0; index < obsolete.length; index += 1) {
      expect(native.gitRevokeHistoryAuthorization).toHaveBeenCalledWith(`obsolete-${index}`)
    }
    expect(native.gitShowPair).toHaveBeenCalledWith('/repo', 'bbbbbbbb', 'token-b', 'flow.yaml', null)
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
})
