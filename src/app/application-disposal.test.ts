import { describe, expect, it, vi } from 'vitest'
import { createApplicationDisposal, disposeApplicationResources } from './application-disposal'

describe('application disposal', () => {
  it('finishes Git authority disposal before starting document workspace disposal', async () => {
    const gitDisposal = deferred<void>()
    const calls: string[] = []
    const operation = disposeApplicationResources(
      async () => {
        calls.push('git started')
        await gitDisposal.promise
        calls.push('git finished')
      },
      async () => {
        calls.push('documents started')
      },
    )

    await vi.waitFor(() => expect(calls).toEqual(['git started']))
    gitDisposal.resolve()
    await operation

    expect(calls).toEqual(['git started', 'git finished', 'documents started'])
  })

  it('awaits document recovery disposal before reporting a Git disposal failure', async () => {
    const gitError = new Error('Git authority disposal failed')
    const documentDisposal = deferred<void>()
    const calls: string[] = []
    const operation = disposeApplicationResources(
      async () => {
        calls.push('git started')
        throw gitError
      },
      async () => {
        calls.push('documents started')
        await documentDisposal.promise
        calls.push('documents finished')
      },
    )
    let reported = false
    void operation.catch(() => {
      reported = true
    })

    await vi.waitFor(() => expect(calls).toEqual(['git started', 'documents started']))
    expect(reported).toBe(false)
    documentDisposal.resolve()

    await expect(operation).rejects.toBe(gitError)
    expect(calls).toEqual(['git started', 'documents started', 'documents finished'])
  })

  it('reports ordered Git and document failures only after both disposals finish', async () => {
    const gitError = new Error('Git authority disposal failed')
    const documentError = new Error('document recovery disposal failed')
    const documentDisposal = deferred<void>()
    const operation = disposeApplicationResources(
      async () => {
        throw gitError
      },
      async () => {
        await documentDisposal.promise
        throw documentError
      },
    )
    let reported = false
    void operation.catch(() => {
      reported = true
    })

    await Promise.resolve()
    expect(reported).toBe(false)
    documentDisposal.resolve()

    const error = await operation.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([gitError, documentError])
  })

  it('starts document disposal even when Git disposal throws synchronously', async () => {
    const gitError = new Error('synchronous Git disposal failure')
    const disposeDocuments = vi.fn(async () => undefined)

    await expect(
      disposeApplicationResources(() => {
        throw gitError
      }, disposeDocuments),
    ).rejects.toBe(gitError)

    expect(disposeDocuments).toHaveBeenCalledOnce()
  })

  it('runs the browser/HMR unmount fallback once and handles cleanup rejection without an unhandled promise', async () => {
    const calls: string[] = []
    const error = new Error('recovery cleanup failed')
    const dispose = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push('canvas flush', 'recovery flush', 'layout flush')
        throw error
      })
      .mockImplementationOnce(async () => {
        calls.push('canvas flush', 'recovery flush', 'layout flush', 'watcher unlisten', 'worker dispose')
      })
    const onError = vi.fn()
    const lifecycle = createApplicationDisposal(dispose, onError)

    lifecycle.unmount()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    expect(dispose).toHaveBeenCalledOnce()

    lifecycle.unmount()
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(2))
    await lifecycle.dispose()
    lifecycle.unmount()

    expect(dispose).toHaveBeenCalledTimes(2)
    expect(calls).toEqual([
      'canvas flush',
      'recovery flush',
      'layout flush',
      'canvas flush',
      'recovery flush',
      'layout flush',
      'watcher unlisten',
      'worker dispose',
    ])
  })

  it('reuses native close disposal during unmount and does not dispose twice after completion', async () => {
    const dispose = vi.fn(async () => undefined)
    const lifecycle = createApplicationDisposal(dispose, vi.fn())

    const nativeClose = lifecycle.dispose()
    lifecycle.unmount()
    await nativeClose
    lifecycle.unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
