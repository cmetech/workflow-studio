import { render } from '@testing-library/svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'

describe('App setup startup gate', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    vi.stubGlobal(
      'Worker',
      class {
        postMessage(): void {}
        addEventListener(): void {}
        removeEventListener(): void {}
        terminate(): void {}
      },
    )
  })

  afterEach(() => setNativeBridgeForTest(undefined))

  it('subscribes to setup before status and gates workspace watcher startup until setup is ready', async () => {
    const backing = createBrowserBridge()
    const status = deferred<{ ready: boolean; snapshot: null }>()
    const order: string[] = []
    const onWorkspaceChanged = vi.fn(backing.onWorkspaceChanged)
    setNativeBridgeForTest({
      onSetupEvent: async () => {
        order.push('subscribe')
        return () => undefined
      },
      setupStatus: async () => {
        order.push('status')
        return status.promise
      },
      onWorkspaceChanged,
    })
    const { default: App } = await import('./App.svelte')
    const app = render(App)

    await vi.waitFor(() => expect(order).toEqual(['subscribe', 'status']))
    expect(onWorkspaceChanged).not.toHaveBeenCalled()
    status.resolve({ ready: true, snapshot: null })
    await vi.waitFor(() => expect(onWorkspaceChanged).toHaveBeenCalledOnce())
    app.unmount()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
