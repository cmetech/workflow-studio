import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { ProgressSnapshot } from '$src/lib/progress/types'

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

  it('shows a retryable setup failure and releases startup only after retry succeeds', async () => {
    const backing = createBrowserBridge()
    const retryResult = deferred<ProgressSnapshot>()
    const setupStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('Setup status is temporarily unavailable.'))
      .mockResolvedValueOnce({ ready: false, snapshot: null })
    const onWorkspaceChanged = vi.fn(backing.onWorkspaceChanged)
    setNativeBridgeForTest({
      onSetupEvent: async () => () => undefined,
      setupStatus,
      setupStart: () => retryResult.promise,
      onWorkspaceChanged,
    })
    const { default: App } = await import('./App.svelte')
    const app = render(App)

    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getByRole('alert')).toHaveTextContent('Setup status is temporarily unavailable.')
    expect(onWorkspaceChanged).not.toHaveBeenCalled()

    await fireEvent.click(retry)

    expect(screen.getByRole('button', { name: 'Retrying setup' })).toBeDisabled()
    retryResult.resolve(setupSnapshot({ status: 'succeeded', cancellable: false }))
    await vi.waitFor(() => expect(onWorkspaceChanged).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })).not.toBeInTheDocument()
    app.unmount()
  })
})

function setupSnapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    runId: 'recovered-setup',
    sequence: 1,
    startedAt: 100,
    status: 'running',
    cancellable: true,
    currentStageId: null,
    stages: [{ id: 'ready', label: 'Verify readiness', status: 'succeeded' }],
    logs: [],
    failure: null,
    savedLogAvailable: false,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
