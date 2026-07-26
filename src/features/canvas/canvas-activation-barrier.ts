export interface CanvasPersistencePort {
  flushPersistence(): Promise<void>
}

export interface CanvasActivationBarrierOptions {
  readonly getCanvas: () => CanvasPersistencePort | null
  readonly setLocked: (locked: boolean) => void
  readonly settle: () => Promise<void>
  readonly onPersistenceError: (error: unknown) => void
}

export interface CanvasActivationBarrier {
  run<T>(transition: () => Promise<T>): Promise<T>
}

export function createCanvasActivationBarrier(options: CanvasActivationBarrierOptions): CanvasActivationBarrier {
  let transitionQueue: Promise<void> = Promise.resolve()
  let pendingTransitions = 0

  return {
    run<T>(transition: () => Promise<T>): Promise<T> {
      pendingTransitions += 1
      if (pendingTransitions === 1) options.setLocked(true)

      const operation = transitionQueue.then(async () => {
        await options.settle()
        try {
          await options.getCanvas()?.flushPersistence()
        } catch (error: unknown) {
          options.onPersistenceError(error)
          throw error
        }
        try {
          return await transition()
        } finally {
          await options.settle()
        }
      })
      transitionQueue = operation.then(
        () => undefined,
        () => undefined,
      )

      return operation.finally(() => {
        pendingTransitions -= 1
        if (pendingTransitions === 0) options.setLocked(false)
      })
    },
  }
}
