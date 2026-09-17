import { describe, expect, it, vi } from 'vitest'
import { focusDeferredTarget } from './focus-deferred-target'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('focusDeferredTarget', () => {
  it('does not report success until the deferred surface exists and owns concrete focus', async () => {
    const loading = deferred<void>()
    const target = document.createElement('button')
    document.body.append(target)
    let completed = false
    const focusing = focusDeferredTarget({
      load: () => loading.promise,
      settle: async () => undefined,
      current: () => true,
      resolveTarget: () => target,
    }).then((result) => {
      completed = true
      return result
    })

    await Promise.resolve()
    expect(completed).toBe(false)
    loading.resolve()

    await expect(focusing).resolves.toBe(true)
    expect(target).toHaveFocus()
    target.remove()
  })

  it('rechecks ownership after loading and does not settle or focus a superseded request', async () => {
    const loading = deferred<void>()
    const settle = vi.fn(async () => undefined)
    const target = document.createElement('button')
    document.body.append(target)
    let current = true
    const focusing = focusDeferredTarget({
      load: () => loading.promise,
      settle,
      current: () => current,
      resolveTarget: () => target,
    })

    current = false
    loading.resolve()

    await expect(focusing).resolves.toBe(false)
    expect(settle).not.toHaveBeenCalled()
    expect(target).not.toHaveFocus()
    target.remove()
  })

  it('returns false when loading rejects or no concrete focus target is mounted', async () => {
    await expect(
      focusDeferredTarget({
        load: () => Promise.reject(new Error('surface unavailable')),
        settle: async () => undefined,
        current: () => true,
        resolveTarget: () => null,
      }),
    ).resolves.toBe(false)
    await expect(
      focusDeferredTarget({
        load: async () => undefined,
        settle: async () => undefined,
        current: () => true,
        resolveTarget: () => null,
      }),
    ).resolves.toBe(false)
  })
})
