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
    gitHistoryPair: vi.fn(async () => []),
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
