import { describe, expect, it, vi } from 'vitest'
import { createCanvasActivationBarrier } from './canvas-activation-barrier'

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  return {
    promise: new Promise<void>((next) => {
      resolve = next
    }),
    resolve,
  }
}

describe('canvas activation barrier', () => {
  it('locks before flush, suppresses late A mutation, and serializes B then latest-intent C', async () => {
    const publicationB = deferred()
    let locked = false
    let activeIdentity = 'workflow A'
    let latestIntent = 0
    let pendingLayout: string | null = 'initial A layout'
    const writes: string[] = []
    const transitions: string[] = []
    const flushPersistence = vi.fn(async () => {
      if (pendingLayout) writes.push(pendingLayout)
      pendingLayout = null
    })
    const settle = vi.fn(async () => undefined)
    const barrier = createCanvasActivationBarrier({
      getCanvas: () => ({ flushPersistence }),
      setLocked: (next) => {
        locked = next
      },
      settle,
      onPersistenceError: vi.fn(),
    })
    const dragStop = (layout: string) => {
      if (!locked) pendingLayout = layout
    }
    const activate = (identity: string, publication: Promise<void> = Promise.resolve()) => {
      const intent = ++latestIntent
      return barrier.run(async () => {
        transitions.push(`start ${identity}`)
        await publication
        if (intent === latestIntent) activeIdentity = identity
        transitions.push(`finish ${identity}`)
      })
    }

    const openingB = activate('workflow B', publicationB.promise)
    expect(locked).toBe(true)
    await vi.waitFor(() => expect(flushPersistence).toHaveBeenCalledOnce())

    dragStop('late A layout')
    const openingC = activate('workflow C')
    expect(transitions).toEqual(['start workflow B'])
    publicationB.resolve()
    await Promise.all([openingB, openingC])

    expect(writes).toEqual(['initial A layout'])
    expect(pendingLayout).toBeNull()
    expect(transitions).toEqual(['start workflow B', 'finish workflow B', 'start workflow C', 'finish workflow C'])
    expect(activeIdentity).toBe('workflow C')
    expect(settle).toHaveBeenCalledTimes(4)
    expect(locked).toBe(false)
  })

  it('unlocks after a rejected flush, surfaces the error, and does not deadlock the next transition', async () => {
    const error = new Error('layout persistence failed')
    const flushPersistence = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
    const locks: boolean[] = []
    let activeIdentity = 'workflow A'
    const onError = vi.fn()
    const barrier = createCanvasActivationBarrier({
      getCanvas: () => ({ flushPersistence }),
      setLocked: (locked) => locks.push(locked),
      settle: async () => undefined,
      onPersistenceError: onError,
    })

    await expect(
      barrier.run(async () => {
        activeIdentity = 'workflow B'
      }),
    ).rejects.toBe(error)

    expect(activeIdentity).toBe('workflow A')
    expect(onError).toHaveBeenCalledWith(error)
    expect(locks).toEqual([true, false])

    await expect(
      barrier.run(async () => {
        activeIdentity = 'workflow C'
      }),
    ).resolves.toBeUndefined()
    expect(activeIdentity).toBe('workflow C')
    expect(locks).toEqual([true, false, true, false])
  })

  it('keeps the canvas locked through the publication settle when a transition rejects', async () => {
    const publicationSettle = deferred()
    const transitionError = new Error('activation failed')
    let locked = false
    let settleCalls = 0
    const barrier = createCanvasActivationBarrier({
      getCanvas: () => null,
      setLocked: (next) => {
        locked = next
      },
      settle: () => {
        settleCalls += 1
        return settleCalls === 2 ? publicationSettle.promise : Promise.resolve()
      },
      onPersistenceError: vi.fn(),
    })

    const activation = barrier.run(async () => {
      throw transitionError
    })
    const activationResult = activation.then(
      () => null,
      (error: unknown) => error,
    )
    await vi.waitFor(() => expect(settleCalls).toBe(2))
    expect(locked).toBe(true)

    publicationSettle.resolve()
    expect(await activationResult).toBe(transitionError)
    expect(locked).toBe(false)
  })
})
