import { describe, expect, it, vi } from 'vitest'
import { runAfterCanvasLayoutFlush } from './canvas-activation-barrier'

describe('canvas activation barrier', () => {
  it('blocks an identity change and surfaces the persistence error when the pending layout rejects', async () => {
    const error = new Error('layout persistence failed')
    const flushPersistence = vi.fn().mockRejectedValue(error)
    let activeIdentity = 'workflow A'
    const activate = vi.fn(async () => {
      activeIdentity = 'workflow B'
    })
    const onError = vi.fn()

    await expect(runAfterCanvasLayoutFlush(() => ({ flushPersistence }), activate, onError)).rejects.toBe(error)

    expect(flushPersistence).toHaveBeenCalledOnce()
    expect(activate).not.toHaveBeenCalled()
    expect(activeIdentity).toBe('workflow A')
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('flushes before the identity change and does not suppress a later transition failure', async () => {
    const calls: string[] = []
    const transitionError = new Error('activation failed')
    const onError = vi.fn()

    await expect(
      runAfterCanvasLayoutFlush(
        () => ({
          flushPersistence: async () => {
            calls.push('flush A')
          },
        }),
        async () => {
          calls.push('activate B')
          throw transitionError
        },
        onError,
      ),
    ).rejects.toBe(transitionError)

    expect(calls).toEqual(['flush A', 'activate B'])
    expect(onError).not.toHaveBeenCalled()
  })
})
