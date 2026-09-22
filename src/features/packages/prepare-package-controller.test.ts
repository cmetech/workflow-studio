import { expect, it, vi } from 'vitest'
import { PreparePackageController } from './prepare-package-controller'
import type { PackageAnalysis } from '$src/lib/packages/readiness'

function fixture() {
  const analysis = { ready: true, blockers: [], advisories: [] } as unknown as PackageAnalysis
  const review = {
    snapshot: { token: 'source' },
    analysis,
    changes: [],
    includedPaths: ['packages/demo/workflow-package.json'],
    trustChanges: [],
    suggestedVersion: '1.0.1',
    suggestionReasons: ['Documentation changed.'],
  }
  const deps = {
    flush: vi.fn(async () => {}),
    validate: vi.fn(async () => review),
    prepare: vi.fn(async (_snapshot: { token: string }, input: { version: string; message: string }) => ({
      ...input,
      authorizationToken: 'preview',
      diff: '+ reviewed bytes',
      includedPaths: review.includedPaths,
    })),
    commit: vi.fn(async (_token: string) => {
      void _token
      return {
        outcome: 'committed' as const,
        oid: 'abc',
        status: null,
        warnings: ['Refresh pending.'],
      }
    }),
  }
  return { deps, review, controller: new PreparePackageController(deps) }
}
const input = { version: '1.0.1', message: 'Prepare version' }
it('flushes, validates, reviews final bytes, and only then records a local commit', async () => {
  const { controller, deps } = fixture()
  await controller.validate()
  expect(deps.flush.mock.invocationCallOrder[0]).toBeLessThan(deps.validate.mock.invocationCallOrder[0]!)
  expect(controller.state.get().step).toBe('review')
  controller.acceptReview()
  await controller.prepare(input)
  expect(controller.state.get()).toMatchObject({
    step: 'version',
    finalPreview: { diff: '+ reviewed bytes', ...input },
  })
  expect(deps.commit).not.toHaveBeenCalled()
  await controller.commit(input)
  expect(controller.state.get()).toMatchObject({
    step: 'complete',
    commitOid: 'abc',
    version: '1.0.1',
    warnings: ['Refresh pending.'],
  })
  expect(deps.commit).toHaveBeenCalledExactlyOnceWith('preview')
})
it('blocks preparation for findings and retains the validation report', async () => {
  const { controller, review, deps } = fixture()
  review.analysis = {
    ...review.analysis,
    ready: false,
    blockers: [{ code: 'missing', message: 'Missing script', path: 'script.py', severity: 'blocking' }],
  }
  await controller.validate()
  controller.acceptReview()
  await controller.prepare(input)
  expect(controller.state.get()).toMatchObject({ step: 'validate', analysis: { ready: false } })
  expect(deps.prepare).not.toHaveBeenCalled()
})
it('does not capture after a failed save', async () => {
  const { controller, deps } = fixture()
  deps.flush.mockRejectedValue(new Error('Save conflict'))
  await controller.validate()
  expect(deps.validate).not.toHaveBeenCalled()
  expect(controller.state.get()).toMatchObject({ step: 'validate', error: { message: 'Save conflict' } })
})
it('ignores validation results after cancellation', async () => {
  const { controller, deps, review } = fixture()
  let resolve!: (value: typeof review) => void
  deps.validate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = controller.validate()
  await vi.waitFor(() => expect(deps.validate).toHaveBeenCalled())
  expect(controller.cancel()).toBe(true)
  resolve(review)
  await pending
  expect(controller.state.get()).toEqual({ step: 'validate' })
})
it('requires another final preview after version or message changes', async () => {
  const { controller, deps } = fixture()
  await controller.validate()
  controller.acceptReview()
  await controller.prepare(input)
  await controller.commit({ ...input, message: 'Changed message' })
  expect(deps.commit).not.toHaveBeenCalled()
  expect(controller.state.get()).toMatchObject({
    step: 'version',
    error: { message: expect.stringContaining('preview') },
  })
})
it('clears expired authorization and never retries the commit silently', async () => {
  const { controller, deps } = fixture()
  await controller.validate()
  controller.acceptReview()
  await controller.prepare(input)
  deps.commit.mockRejectedValue(new Error('git_preview_expired'))
  await controller.commit(input)
  await controller.commit(input)
  expect(deps.commit).toHaveBeenCalledTimes(1)
  expect(controller.state.get().step).toBe('version')
})
it('retains a recoverable preparation error and requires a fresh source validation', async () => {
  const { controller, deps } = fixture()
  await controller.validate()
  controller.acceptReview()
  deps.prepare.mockRejectedValue(new Error('package_source_changed'))
  await controller.prepare(input)
  expect(controller.state.get()).toMatchObject({ step: 'validate', error: { message: 'package_source_changed' } })
  expect(deps.commit).not.toHaveBeenCalled()
})
it('prevents duplicate mutations and cancellation while a commit is pending', async () => {
  const { controller, deps } = fixture()
  await controller.validate()
  controller.acceptReview()
  await controller.prepare(input)
  let resolve!: (result: Awaited<ReturnType<typeof deps.commit>>) => void
  deps.commit.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = controller.commit(input)
  await vi.waitFor(() => expect(deps.commit).toHaveBeenCalled())
  expect(controller.cancel()).toBe(false)
  await controller.commit(input)
  expect(deps.commit).toHaveBeenCalledTimes(1)
  resolve({ outcome: 'committed', oid: 'abc', status: null, warnings: [] })
  await pending
  expect(controller.state.get().step).toBe('complete')
})
