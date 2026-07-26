import { describe, expect, it, vi } from 'vitest'
import { installWindowCloseLifecycle, type WindowClosePort } from './window-close-lifecycle'

describe('window close lifecycle', () => {
  it('prevents native close and awaits document flush before one reentrancy-safe destroy', async () => {
    let handler: ((event: { preventDefault(): void }) => void | Promise<void>) | undefined
    let releaseFlush: (() => void) | undefined
    const port: WindowClosePort = {
      onCloseRequested: vi.fn(async (next) => {
        handler = next
        return vi.fn()
      }),
      destroy: vi.fn(async () => undefined),
    }
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve
        }),
    )
    await installWindowCloseLifecycle(port, flush)
    const first = { preventDefault: vi.fn() }
    const closing = Promise.resolve(handler?.(first))
    await vi.waitFor(() => expect(releaseFlush).toBeDefined())

    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(port.destroy).not.toHaveBeenCalled()
    const repeated = { preventDefault: vi.fn() }
    await handler?.(repeated)
    expect(repeated.preventDefault).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()

    releaseFlush?.()
    await closing
    expect(port.destroy).toHaveBeenCalledOnce()
  })

  it('keeps the window open after a flush error and permits a later retry', async () => {
    let handler: ((event: { preventDefault(): void }) => void | Promise<void>) | undefined
    const port: WindowClosePort = {
      onCloseRequested: vi.fn(async (next) => {
        handler = next
        return vi.fn()
      }),
      destroy: vi.fn(async () => undefined),
    }
    const flush = vi.fn().mockRejectedValueOnce(new Error('recovery flush failed')).mockResolvedValue(undefined)
    const onError = vi.fn()
    await installWindowCloseLifecycle(port, flush, onError)

    await handler?.({ preventDefault: vi.fn() })
    expect(port.destroy).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'recovery flush failed' }))

    await handler?.({ preventDefault: vi.fn() })
    expect(flush).toHaveBeenCalledTimes(2)
    expect(port.destroy).toHaveBeenCalledOnce()
  })
})
