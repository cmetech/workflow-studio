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
    const chooseWorkspaceFolder = vi.fn(async () => null)
    const workspaceSetRoot = vi.fn(backing.workspaceSetRoot)
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
      chooseWorkspaceFolder,
      workspaceSetRoot,
    })
    const { default: App } = await import('./App.svelte')
    const app = render(App)

    await vi.waitFor(() => expect(order).toEqual(['subscribe', 'status']))
    expect(onWorkspaceChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Cancel setup' })).toBeDisabled()
    const openButtons = screen
      .getAllByText('Open Folder')
      .map((element) => element.closest('button'))
      .filter((button): button is HTMLButtonElement => button !== null)
    expect(openButtons.every((button) => button.hasAttribute('disabled'))).toBe(true)
    await fireEvent.click(openButtons[0]!)
    const dropped = Object.assign(new File([''], 'workspace', { type: 'application/octet-stream' }), {
      path: '/blocked-drop',
    })
    await fireEvent.drop(document.querySelector('[aria-label="Open workspace drop zone"]')!, {
      dataTransfer: { files: [dropped] },
    })
    expect(chooseWorkspaceFolder).not.toHaveBeenCalled()
    expect(workspaceSetRoot).not.toHaveBeenCalled()

    status.resolve({ ready: true, snapshot: null })
    await vi.waitFor(() => expect(onWorkspaceChanged).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Open Folder' }).every((button) => !button.hasAttribute('disabled')),
    ).toBe(true)
    await fireEvent.click(screen.getAllByRole('button', { name: 'Open Folder' })[0]!)
    expect(chooseWorkspaceFolder).toHaveBeenCalledOnce()
    app.unmount()
  })

  it('shows a retryable setup failure and releases startup only after retry succeeds', async () => {
    const backing = createBrowserBridge()
    const retryResult = deferred<ProgressSnapshot>()
    const setupStatus = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Setup status is temporarily unavailable. Authorization=Bearer ui-secret https://example.test?token=query-secret',
        ),
      )
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
    expect(screen.getByRole('alert')).not.toHaveTextContent('ui-secret')
    expect(screen.getByRole('alert')).not.toHaveTextContent('query-secret')
    expect(onWorkspaceChanged).not.toHaveBeenCalled()
    expect(
      screen
        .getAllByText('Open Folder')
        .map((element) => element.closest('button'))
        .filter((button): button is HTMLButtonElement => button !== null)
        .every((button) => button.disabled),
    ).toBe(true)

    await fireEvent.click(retry)

    expect(screen.getByRole('button', { name: 'Retrying setup' })).toBeDisabled()
    retryResult.resolve(setupSnapshot({ status: 'succeeded', cancellable: false }))
    await vi.waitFor(() => expect(onWorkspaceChanged).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Open Folder' }).every((button) => !button.hasAttribute('disabled')),
    ).toBe(true)
    app.unmount()
  })

  it('starts the optional update check after readiness without blocking workspace startup', async () => {
    const backing = createBrowserBridge()
    const updateCheckResult = deferred<Awaited<ReturnType<typeof backing.updateCheck>>>()
    const order: string[] = []
    const onWorkspaceChanged = vi.fn(backing.onWorkspaceChanged)
    const updateCheck = vi.fn(() => updateCheckResult.promise)
    setNativeBridgeForTest({
      setupStatus: async () => ({ ready: true, snapshot: null }),
      onUpdateEvent: async () => {
        order.push('update-subscribe')
        return () => undefined
      },
      updateStatus: async () => {
        order.push('update-status')
        return await backing.updateStatus()
      },
      updateCheck,
      onWorkspaceChanged,
    })
    const { default: App } = await import('./App.svelte')
    const app = render(App)

    await vi.waitFor(() => {
      expect(order).toEqual(['update-subscribe', 'update-status'])
      expect(updateCheck).toHaveBeenCalledWith(true)
      expect(onWorkspaceChanged).toHaveBeenCalledOnce()
    })
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
