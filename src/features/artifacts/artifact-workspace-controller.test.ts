import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactWorkspaceController } from './artifact-workspace-controller'
import { createArtifactRecoveryStore, createRecoveryStore } from '$src/lib/recovery/recovery-store'
import { $artifactSession } from '$src/stores/artifacts'

function setup() {
  const records = new Map<string, string>()
  const recoveryNative = {
    recoveryList: async () => [...records].map(([key, content]) => ({ id: key, key, content, size: content.length })),
    recoveryWrite: vi.fn(async ({ key, content }: { key: string; content: string }) => {
      records.set(key, content)
    }),
    recoveryDelete: vi.fn(async (id: string) => {
      records.delete(id)
    }),
  }
  let text = 'original'
  let hash = 'disk'
  const native = {
    workspaceReadTextArtifact: vi.fn(async (relativePath: string) => ({
      relativePath,
      text,
      sha256: hash,
      size: text.length,
      modifiedAt: '',
      readOnly: false,
    })),
    workspaceWriteTextArtifact: vi.fn(
      async (request: { relativePath: string; text: string; expectedCurrentHash: string | null }) => {
        if (request.expectedCurrentHash !== hash)
          throw Object.assign(new Error('Conflict'), { code: 'workspace_revision_conflict' })
        text = request.text
        hash += '-saved'
        return { relativePath: request.relativePath, sha256: hash, size: text.length, modifiedAt: '' }
      },
    ),
  }
  const recovery = createArtifactRecoveryStore(recoveryNative)
  const controller = new ArtifactWorkspaceController({ workspaceId: 'workspace', native, recovery })
  return {
    controller,
    native,
    recovery,
    recoveryNative,
    records,
    external: () => {
      text = 'external'
      hash = 'external-hash'
    },
  }
}
afterEach(() => {
  $artifactSession.set(null)
  vi.useRealTimers()
})

it('saves invalid text verbatim and recovers only unsaved differing drafts across restart', async () => {
  const s = setup()
  await s.controller.open('scripts/a.py', 'python')
  s.controller.edit('def broken(:\r\n')
  await s.controller.save()
  await s.controller.close()
  expect(await s.recovery.list()).toEqual([])
  await s.controller.open('scripts/a.py', 'python')
  expect($artifactSession.get()?.text).toBe('def broken(:\r\n')
  s.controller.edit('def unsaved(:\n')
  await s.controller.close()
  expect(await createRecoveryStore(s.recoveryNative).list()).toEqual([])
  expect(await s.recovery.list()).toHaveLength(1)
  await s.controller.open('scripts/a.py', 'python')
  await s.controller.recover(s.controller.state.get().recoveryOffers[0]!)
  expect($artifactSession.get()).toMatchObject({ text: 'def unsaved(:\n', dirty: true, origin: 'recovery' })
  await s.controller.close()
})

it('requires a current comparison and uses the exact external hash when keeping mine', async () => {
  const s = setup()
  await s.controller.open('scripts/a.py', 'python')
  s.controller.edit('mine')
  s.external()
  await expect(s.controller.save()).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  expect(s.controller.state.get().externalChange?.choices).toEqual(['keep-mine', 'reload-disk', 'compare'])
  await expect(s.controller.resolveExternalChange('keep-mine')).rejects.toThrow()
  expect(s.controller.compare()).toMatchObject({ mine: 'mine', disk: 'external' })
  s.controller.edit('newer')
  await expect(s.controller.resolveExternalChange('keep-mine')).rejects.toThrow()
  s.controller.compare()
  await s.controller.resolveExternalChange('keep-mine')
  expect(s.native.workspaceWriteTextArtifact).toHaveBeenLastCalledWith({
    relativePath: 'scripts/a.py',
    text: 'newer',
    expectedCurrentHash: 'external-hash',
  })
  await s.controller.close()
})

it('retries failed close persistence and remains editable until close succeeds', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('draft')
  s.recoveryNative.recoveryWrite.mockRejectedValueOnce(new Error('write failed'))
  await expect(s.controller.close()).rejects.toThrow('write failed')
  expect($artifactSession.get()?.text).toBe('draft')
  await s.controller.close()
  expect(await s.recovery.list()).toHaveLength(1)
})

it('keeps newer edits dirty when a captured save completes', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('first')
  let finish!: (value: { relativePath: string; sha256: string; size: number; modifiedAt: string }) => void
  s.native.workspaceWriteTextArtifact.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const saving = s.controller.save()
  s.controller.edit('second')
  finish({ relativePath: 'a.py', sha256: 'saved-first', size: 5, modifiedAt: '' })
  await saving
  expect($artifactSession.get()).toMatchObject({ text: 'second', savedRevision: 1, revision: 2, dirty: true })
  await s.controller.close()
})
it('rejects obsolete reads and reloads clean external changes without resetting revisions', async () => {
  const s = setup()
  let release!: (value: Awaited<ReturnType<typeof s.native.workspaceReadTextArtifact>>) => void
  s.native.workspaceReadTextArtifact.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const old = s.controller.open('old.py', 'python')
  await vi.waitFor(() => expect(s.native.workspaceReadTextArtifact).toHaveBeenCalledOnce())
  await s.controller.open('new.py', 'python')
  release({ relativePath: 'old.py', text: 'obsolete', sha256: 'old', size: 8, modifiedAt: '', readOnly: false })
  await old
  expect($artifactSession.get()?.path).toBe('new.py')
  s.external()
  await s.controller.externalChanged()
  expect($artifactSession.get()).toMatchObject({ text: 'external', revision: 1, savedRevision: 1, dirty: false })
  await s.controller.close()
})

it('reloads dirty disk text and rejects changed disk bytes after comparison', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('mine')
  s.external()
  await s.controller.externalChanged()
  s.controller.compare()
  s.native.workspaceWriteTextArtifact.mockRejectedValueOnce(
    Object.assign(new Error('race'), { code: 'workspace_revision_conflict' }),
  )
  await expect(s.controller.resolveExternalChange('keep-mine')).rejects.toMatchObject({
    code: 'workspace_revision_conflict',
  })
  expect(s.controller.state.get().externalChange?.comparedRevision).toBeNull()
  await s.controller.resolveExternalChange('reload-disk')
  expect($artifactSession.get()).toMatchObject({ text: 'external', dirty: false, revision: 2 })
  expect(await s.recovery.list()).toEqual([])
  await s.controller.close()
})

it('debounces recovery and retries disposal without resurrecting an obsolete draft', async () => {
  vi.useFakeTimers()
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('first')
  await vi.advanceTimersByTimeAsync(749)
  expect(s.recoveryNative.recoveryWrite).not.toHaveBeenCalled()
  s.controller.edit('latest')
  await vi.advanceTimersByTimeAsync(750)
  expect((await s.recovery.list())[0]?.text).toBe('latest')
  s.controller.edit('last')
  s.recoveryNative.recoveryWrite.mockRejectedValueOnce(new Error('storage full'))
  await expect(s.controller.dispose()).rejects.toThrow('storage full')
  await s.controller.dispose()
  expect((await s.recovery.list())[0]?.text).toBe('last')
  expect(() => s.controller.edit('closed')).toThrow('closed')
})

it('waits for an in-flight save before reopening the same artifact', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('saved-later')
  const originalWrite = s.native.workspaceWriteTextArtifact.getMockImplementation()!
  let release!: () => void
  s.native.workspaceWriteTextArtifact.mockImplementationOnce(async (request) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return originalWrite(request)
  })
  const saving = s.controller.save()
  const opening = s.controller.open('a.py', 'python')
  await new Promise((resolve) => setTimeout(resolve, 10))
  release()
  await saving
  await opening
  expect($artifactSession.get()?.text).toBe('saved-later')
  await s.controller.close()
})

it('does not replace an edit made while a new artifact read is pending', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  let release!: (value: Awaited<ReturnType<typeof s.native.workspaceReadTextArtifact>>) => void
  s.native.workspaceReadTextArtifact.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const opening = s.controller.open('b.py', 'python')
  await vi.waitFor(() => expect(s.native.workspaceReadTextArtifact).toHaveBeenCalledTimes(2))
  s.controller.edit('typed during navigation')
  release({ relativePath: 'b.py', text: 'other', sha256: 'other', size: 5, modifiedAt: '', readOnly: false })
  await opening
  expect($artifactSession.get()).toMatchObject({ path: 'a.py', text: 'typed during navigation' })
  await s.controller.close()
})

it('offers safe recreation for deleted artifacts and retains recovery when accepting deletion', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('precious draft')
  s.native.workspaceReadTextArtifact.mockRejectedValue(Object.assign(new Error('missing'), { code: 'path_not_found' }))
  s.native.workspaceWriteTextArtifact.mockRejectedValueOnce(
    Object.assign(new Error('deleted'), { code: 'workspace_revision_conflict' }),
  )
  await expect(s.controller.save()).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  expect(s.controller.state.get().externalChange?.disk).toBeNull()
  expect(s.controller.compare()).toMatchObject({ mine: 'precious draft', disk: null })
  s.native.workspaceWriteTextArtifact.mockResolvedValueOnce({
    relativePath: 'a.py',
    sha256: 'recreated',
    size: 14,
    modifiedAt: '',
  })
  await s.controller.resolveExternalChange('keep-mine')
  expect(s.native.workspaceWriteTextArtifact).toHaveBeenLastCalledWith({
    relativePath: 'a.py',
    text: 'precious draft',
    expectedCurrentHash: null,
  })
  s.controller.edit('next draft')
  await s.controller.externalChanged()
  await s.controller.resolveExternalChange('reload-disk')
  expect($artifactSession.get()).toBeNull()
  expect((await s.recovery.list())[0]?.text).toBe('next draft')
})

it('serializes discarding an offered draft before persisting edits made during discard', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('old')
  await s.controller.flush()
  let release!: () => void
  const originalDelete = s.recoveryNative.recoveryDelete.getMockImplementation()!
  s.recoveryNative.recoveryDelete.mockImplementationOnce(async (id) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await originalDelete(id)
  })
  const discarding = s.controller.discard()
  await vi.waitFor(() => expect(s.recoveryNative.recoveryDelete).toHaveBeenCalledOnce())
  s.controller.edit('newer')
  const flushing = s.controller.flush()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(s.recoveryNative.recoveryWrite).toHaveBeenCalledOnce()
  release()
  await discarding
  await flushing
  expect((await s.recovery.list())[0]?.text).toBe('newer')
  await s.controller.close()
})

it('opens recovery for an artifact that remains absent after restart', async () => {
  const s = setup()
  await s.controller.open('a.py', 'python')
  s.controller.edit('lost disk draft')
  await s.controller.close()
  s.native.workspaceReadTextArtifact.mockRejectedValue(Object.assign(new Error('missing'), { code: 'path_not_found' }))
  await s.controller.open('a.py', 'python')
  await s.controller.recover(s.controller.state.get().recoveryOffers[0]!)
  expect($artifactSession.get()).toMatchObject({ text: 'lost disk draft', diskHash: null, dirty: true })
  await s.controller.close()
})
