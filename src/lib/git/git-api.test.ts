import { describe, expect, it, vi } from 'vitest'
import type { GitNativeBridge } from '$src/lib/native/types'
import { inspectGitPair, inspectGitRepository, loadGitCommit } from './git-api'

function nativeFixture(): GitNativeBridge {
  return {
    hostHealth: async () => ({ appVersion: 'test', os: 'linux', arch: 'x64' }),
    gitDetect: vi.fn(async () => ({ root: '/repo', branch: 'main', detachedHead: null })),
    gitStatus: vi.fn(async () => ({
      entries: [{ path: 'flows/a b.yaml', index: '.', worktree: 'M', untracked: false }],
    })),
    gitDiffPair: vi.fn(async () => ({ working: 'working diff', index: 'index diff' })),
    gitHistoryPair: vi.fn(async () => [
      {
        oid: '0123456789abcdef',
        shortOid: '0123456789ab',
        authorName: 'Ada',
        authoredAt: '2026-07-29T10:00:00Z',
        subject: 'pair update',
      },
    ]),
    gitShowPair: vi.fn(async () => ({
      oid: '0123456789abcdef',
      definition: 'name: historical\n',
      companion: null,
    })),
  }
}

describe('Git inspection API', () => {
  it('detects repository branch and status before a workflow is selected', async () => {
    const native = nativeFixture()

    const result = await inspectGitRepository(native)

    expect(result.repository?.branch).toBe('main')
    expect(result.pair).toBeNull()
    expect(native.gitStatus).toHaveBeenCalledWith('/repo')
    expect(native.gitDiffPair).not.toHaveBeenCalled()
    expect(native.gitHistoryPair).not.toHaveBeenCalled()
  })

  it('loads exact literal pair paths through the closed native methods', async () => {
    const native = nativeFixture()

    const result = await inspectGitPair(native, {
      definitionPath: 'flows/a b.yaml',
      companionPath: 'flows/a b.hermes.yaml',
    })

    expect(result.repository?.branch).toBe('main')
    expect(result.status.entries).toHaveLength(1)
    expect(result.diff.working).toBe('working diff')
    expect(result.history[0]?.subject).toBe('pair update')
    expect(native.gitDetect).toHaveBeenCalledWith()
    expect(native.gitStatus).toHaveBeenCalledWith('/repo')
    expect(native.gitDiffPair).toHaveBeenCalledWith('/repo', 'flows/a b.yaml', 'flows/a b.hermes.yaml')
    expect(native.gitHistoryPair).toHaveBeenCalledWith('/repo', 'flows/a b.yaml', 'flows/a b.hermes.yaml')
  })

  it('returns an explicit no-repository view without issuing repository reads', async () => {
    const native = nativeFixture()
    vi.mocked(native.gitDetect).mockResolvedValue(null)

    const result = await inspectGitPair(native, {
      definitionPath: 'flow.yaml',
      companionPath: null,
    })

    expect(result.repository).toBeNull()
    expect(result.status.entries).toEqual([])
    expect(result.history).toEqual([])
    expect(native.gitStatus).not.toHaveBeenCalled()
  })

  it('loads a historical pair using the selected validated commit OID', async () => {
    const native = nativeFixture()

    const snapshot = await loadGitCommit(native, '/repo', '0123456789abcdef', {
      definitionPath: 'flows/a b.yaml',
      companionPath: null,
    })

    expect(snapshot.definition).toBe('name: historical\n')
    expect(native.gitShowPair).toHaveBeenCalledWith('/repo', '0123456789abcdef', 'flows/a b.yaml', null)
  })
})
