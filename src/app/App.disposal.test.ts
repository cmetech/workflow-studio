import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import { receiveDocumentAnalysis } from '$src/stores/documents'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'

class WorkerForDisposalTest {
  static instances: WorkerForDisposalTest[] = []
  readonly postMessage = vi.fn()
  readonly addEventListener = vi.fn()
  readonly removeEventListener = vi.fn()
  readonly terminate = vi.fn()

  constructor() {
    WorkerForDisposalTest.instances.push(this)
  }
}

describe('App disposal fallback', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
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
    vi.stubGlobal('Worker', WorkerForDisposalTest)
  })

  afterEach(() => {
    setNativeBridgeForTest(undefined)
    clearWorkspace()
    WorkerForDisposalTest.instances.length = 0
  })

  it('flushes the pending canvas once and disposes watcher and worker on browser component unmount', async () => {
    const backing = createBrowserBridge()
    const unlisten = vi.fn()
    const layoutSave = vi.fn(backing.layoutSave)
    const recoveryList = vi.fn(backing.recoveryList)
    const onWorkspaceChanged = vi.fn(async (handler: Parameters<typeof backing.onWorkspaceChanged>[0]) => {
      const removeBackingHandler = await backing.onWorkspaceChanged(handler)
      return () => {
        unlisten()
        removeBackingHandler()
      }
    })
    const native: WorkspaceNativeBridge = { ...backing, layoutSave, recoveryList, onWorkspaceChanged }
    setNativeBridgeForTest(native)
    const { default: App } = await import('./App.svelte')
    loadWorkspaceEntries('workspace', 'Workspace', [
      {
        relativePath: 'examples/hello.yaml',
        kind: 'file',
        size: 1,
        modifiedAt: '0',
        symlink: 'none',
        readOnly: false,
      },
    ])
    const { container, unmount } = render(App)
    await vi.waitFor(() => expect(onWorkspaceChanged).toHaveBeenCalledOnce())

    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))
    const { $documentSession } = await import('$src/stores/documents')
    await vi.waitFor(() => expect($documentSession.get().pair).not.toBeNull())
    const session = $documentSession.get()
    receiveDocumentAnalysis({
      ...session.revision!,
      issues: [],
      structurallyValid: true,
      projection: {
        name: 'Hello',
        description: '',
        profile: 'hermes-legacy',
        nodes: [
          {
            id: 'collect',
            kind: 'command',
            value: 'Gather',
            dependsOn: [],
            options: {},
            source: { path: '/nodes/0', start: 0, end: 1 },
          },
        ],
        edges: [],
        definition: { name: 'Hello' },
        companion: null,
      },
    })
    await tick()
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 80, y: 90 } },
      }),
    )

    unmount()

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce())
    expect(layoutSave).toHaveBeenCalledOnce()
    expect(recoveryList).toHaveBeenCalled()
    expect(WorkerForDisposalTest.instances).toHaveLength(1)
    expect(WorkerForDisposalTest.instances[0]!.removeEventListener).toHaveBeenCalledOnce()
    expect(WorkerForDisposalTest.instances[0]!.terminate).toHaveBeenCalledOnce()
  }, 15_000)
})
