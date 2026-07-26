export interface ApplicationDisposal {
  dispose(): Promise<void>
  unmount(): void
}

export function createApplicationDisposal(
  disposeResources: () => Promise<void>,
  onUnmountError: (error: unknown) => void,
): ApplicationDisposal {
  let completed = false
  let inFlight: Promise<void> | null = null

  function dispose(): Promise<void> {
    if (completed) return Promise.resolve()
    if (inFlight) return inFlight
    const operation = Promise.resolve()
      .then(disposeResources)
      .then(() => {
        completed = true
      })
      .finally(() => {
        if (inFlight === operation) inFlight = null
      })
    inFlight = operation
    return operation
  }

  return {
    dispose,
    unmount(): void {
      if (completed) return
      void dispose().catch(onUnmountError)
    },
  }
}
