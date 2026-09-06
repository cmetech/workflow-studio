import { describe, expect, it } from 'vitest'
import { createRecentWorkspaceStore } from './recent-workspaces'

describe('recent workspace storage', () => {
  it('deduplicates canonical roots, keeps the newest timestamp, marks unavailable roots, and caps persistence at 20', async () => {
    let persisted = ''
    const store = createRecentWorkspaceStore({
      load: async () => persisted,
      save: async (content) => {
        persisted = content
      },
      isAvailable: async (rootPath) => rootPath !== '/missing',
    })

    for (let index = 0; index < 22; index += 1) {
      await store.record(`/workspace-${index}`, `2026-07-25T12:${String(index).padStart(2, '0')}:00.000Z`)
    }
    await store.record('/workspace-21', '2026-07-25T13:00:00.000Z')
    await store.record('/missing', '2026-07-25T14:00:00.000Z')

    const recent = await store.list()
    expect(recent).toHaveLength(20)
    expect(recent[0]).toEqual({ rootPath: '/missing', lastOpenedAt: '2026-07-25T14:00:00.000Z', available: false })
    expect(recent.filter(({ rootPath }) => rootPath === '/workspace-21')).toHaveLength(1)
    expect(JSON.parse(persisted)).toHaveLength(20)
  })

  it('ignores malformed app-data records instead of trusting renderer-controlled shapes', async () => {
    const store = createRecentWorkspaceStore({
      load: async () =>
        '[null,{"rootPath":"","lastOpenedAt":"bad"},{"rootPath":"/valid","lastOpenedAt":"2026-07-25T12:00:00.000Z"}]',
      save: async () => undefined,
      isAvailable: async () => true,
    })

    await expect(store.list()).resolves.toEqual([
      { rootPath: '/valid', lastOpenedAt: '2026-07-25T12:00:00.000Z', available: true },
    ])
  })

  it('removes one root through the serialized storage queue and rejects blank paths', async () => {
    let persisted = JSON.stringify([
      { rootPath: '/keep', lastOpenedAt: '2026-07-25T13:00:00.000Z' },
      { rootPath: '/remove', lastOpenedAt: '2026-07-25T12:00:00.000Z' },
    ])
    const store = createRecentWorkspaceStore({
      load: async () => persisted,
      save: async (content) => {
        persisted = content
      },
      isAvailable: async () => true,
    })

    await store.remove('/remove')

    expect(JSON.parse(persisted)).toEqual([{ rootPath: '/keep', lastOpenedAt: '2026-07-25T13:00:00.000Z' }])
    await expect(store.remove('   ')).rejects.toBeInstanceOf(TypeError)
  })

  it('clears unavailable roots while preserving the current record order', async () => {
    let persisted = JSON.stringify([
      { rootPath: '/newest', lastOpenedAt: '2026-07-25T14:00:00.000Z' },
      { rootPath: '/missing', lastOpenedAt: '2026-07-25T13:00:00.000Z' },
      { rootPath: '/oldest', lastOpenedAt: '2026-07-25T12:00:00.000Z' },
    ])
    const checked: string[] = []
    const store = createRecentWorkspaceStore({
      load: async () => persisted,
      save: async (content) => {
        persisted = content
      },
      isAvailable: async (rootPath) => {
        checked.push(rootPath)
        return rootPath !== '/missing'
      },
    })

    await store.clearUnavailable()

    expect(checked).toEqual(['/newest', '/missing', '/oldest'])
    expect(JSON.parse(persisted)).toEqual([
      { rootPath: '/newest', lastOpenedAt: '2026-07-25T14:00:00.000Z' },
      { rootPath: '/oldest', lastOpenedAt: '2026-07-25T12:00:00.000Z' },
    ])
  })
})
