import { describe, expect, it, vi } from 'vitest'
import { createApplicationDisposal } from './application-disposal'

describe('application disposal', () => {
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
