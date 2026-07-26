export interface WindowCloseEvent {
  preventDefault(): void
}

export interface WindowClosePort {
  onCloseRequested(handler: (event: WindowCloseEvent) => void | Promise<void>): Promise<() => void>
  destroy(): Promise<void>
}

export async function installWindowCloseLifecycle(
  window: WindowClosePort,
  flush: () => Promise<void>,
  onError: (error: unknown) => void = () => undefined,
): Promise<() => void> {
  let finalizing = false
  return window.onCloseRequested(async (event) => {
    event.preventDefault()
    if (finalizing) return
    finalizing = true
    try {
      await flush()
      await window.destroy()
    } catch (error: unknown) {
      finalizing = false
      onError(error)
    }
  })
}
