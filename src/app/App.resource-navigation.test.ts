import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, expect, it, vi } from 'vitest'
import { tick } from 'svelte'
import App from './App.svelte'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
} from '$src/stores/documents'
import { clearWorkspace, loadWorkspaceEntries, workspace } from '$src/stores/workspace'
import { clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import { clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import { emptyScopeLayout } from '$src/lib/layout/types'
import { $activeActivity, showActivity } from '$src/stores/shell'
import { $activePackageSelection, $packageCatalog, resetPackages } from '$src/stores/packages'
import { ArtifactWorkspaceController } from '$src/features/artifacts/artifact-workspace-controller'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from '$src/workers/document-worker'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async () => () => undefined,
    onDragDropEvent: async () => () => undefined,
  }),
}))

class InlineDocumentWorker {
  private listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()
  private cache = createDocumentWorkerCache()
  postMessage(message: DocumentWorkerRequest): void {
    void processDocumentWorkerRequest(message, this.cache).then((response) => {
      for (const listener of this.listeners) listener({ data: response } as MessageEvent<DocumentWorkerResponse>)
    })
  }
  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.add(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
  }
  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.delete(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
  }
  terminate(): void {
    this.listeners.clear()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setNativeBridgeForTest(undefined)
  clearCanvasState()
  clearActiveLayout()
  closeDocumentSession()
  clearWorkspace()
  resetPackages()
  showActivity('explorer')
})

it.each(['overview', 'artifact', 'workspace'] as const)(
  'retains a newer package %s selection after Back to Workflow finishes a slow recovery flush',
  async (destination) => {
    vi.stubGlobal('Worker', InlineDocumentWorker)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    if (!Range.prototype.getClientRects)
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    if (!Range.prototype.getBoundingClientRect)
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
      })
    const contract = (await loadBundledAuthoringContracts()).find((item) => item.profile === 'archon-2026-07')!
    const text =
      'name: Resources\ndescription: Resource editor\nnodes:\n  - id: run\n    script: old\n    runtime: uv\n'
    const companion = 'language_compatibility: archon-2026-07\n'
    const manifest = {
      schemaVersion: 1,
      id: 'resources',
      version: '1.0.0',
      displayName: 'Resources',
      description: 'Resources',
      license: 'MIT',
      publisher: 'local',
      tags: ['resources'],
      externalRequirements: { runtimes: [], providers: [], services: [], secrets: [], tools: [] },
      workflows: [{ definition: 'flow.yaml', companion: 'flow.hermes.yaml' }],
    }
    const bridge = createBrowserBridge({
      initialFiles: {
        'pkg/workflow-package.json': JSON.stringify(manifest),
        'pkg/flow.yaml': text,
        'pkg/flow.hermes.yaml': companion,
        'pkg/scripts/old.py': 'print(0)',
        'pkg/scripts/new.py': 'print(2)',
      },
    })
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const saveRecovery = bridge.recoveryWrite.bind(bridge)
    vi.spyOn(bridge, 'chooseWorkspaceFolder').mockResolvedValue('/second-workspace')
    const originalSetRoot = bridge.workspaceSetRoot.bind(bridge)
    const setRoot = vi.spyOn(bridge, 'workspaceSetRoot').mockImplementation(async (rootPath) => ({
      ...(await originalSetRoot(rootPath)),
      workspaceId: 'second-workspace',
    }))
    const recoveryWrite = vi.spyOn(bridge, 'recoveryWrite').mockImplementation(async (request) => {
      if (JSON.parse(request.content).recordType === 'artifact') await pending
      return saveRecovery(request)
    })
    const observed: { controller?: ArtifactWorkspaceController } = {}
    let closing: Promise<void> | undefined
    const originalClose = ArtifactWorkspaceController.prototype.close
    vi.spyOn(ArtifactWorkspaceController.prototype, 'close').mockImplementation(function (
      this: ArtifactWorkspaceController,
    ) {
      const operation = originalClose.call(this)
      closing ??= operation
      return operation
    })
    const originalOpen = ArtifactWorkspaceController.prototype.open
    vi.spyOn(ArtifactWorkspaceController.prototype, 'open').mockImplementation(function (
      this: ArtifactWorkspaceController,
      ...args
    ) {
      observed.controller = this
      return originalOpen.apply(this, args)
    })
    setNativeBridgeForTest(bridge)
    loadWorkspaceEntries('browser-workspace', 'Workspace', await bridge.workspaceScan())
    const workflowId = 'workflow:browser-workspace:pkg/flow.yaml'
    openDocumentSession(
      {
        workflowId,
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: workflowId + ':definition',
          kind: 'definition',
          path: 'pkg/flow.yaml',
          text,
          revision: 0,
          savedRevision: 0,
          diskHash: (await bridge.workspaceRead('pkg/flow.yaml')).sha256,
        },
        companion: {
          id: workflowId + ':companion',
          kind: 'companion',
          path: 'pkg/flow.hermes.yaml',
          text: companion,
          revision: 0,
          savedRevision: 0,
          diskHash: (await bridge.workspaceRead('pkg/flow.hermes.yaml')).sha256,
        },
      },
      contract.contract_digest,
    )
    const pair = $documentSession.get().pair!
    receiveDocumentAnalysis(
      await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: 'navigation-race',
          workflowId,
          pairGeneration: 0,
          definition: pair.definition,
          companion: pair.companion,
          profile: contract.profile,
          contractDigest: contract.contract_digest,
          reason: 'open',
        },
        contract,
      ),
    )
    expect(
      $documentSession.get().analysis?.structurallyValid,
      JSON.stringify($documentSession.get().analysis?.issues),
    ).toBe(true)
    setActiveLayout({
      schemaVersion: 2,
      workspaceId: 'browser-workspace',
      workflowPath: 'pkg/flow.yaml',
      activeScopeKey: 'root',
      scopeLayouts: {
        root: { ...emptyScopeLayout(), nodePositions: { run: { x: 0, y: 0 } }, viewport: { x: 0, y: 0, zoom: 1 } },
      },
      panels: { left: 280, right: 320, problems: 180 },
      editorMode: 'visual',
      updatedAt: '2026-09-22T00:00:00.000Z',
    })
    const rendered = render(App)
    const timeout = { timeout: 20_000 }
    try {
      await screen.findByRole('region', { name: 'Workflow graph' }, timeout)
      await waitFor(() => expect($packageCatalog.get().catalog.packages).toHaveLength(1), timeout)
      setCanvasSelection(['run'])
      const open = await screen.findByRole('button', { name: 'Open' }, timeout)
      await waitFor(() => expect(open).toBeEnabled(), timeout)
      await fireEvent.click(open)
      await screen.findByRole('textbox', { name: 'pkg/scripts/old.py' }, timeout)
      observed.controller!.edit('print(1)\n')
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: 'Back to Workflow' }))
      await waitFor(
        () =>
          expect(
            recoveryWrite.mock.calls.some(([request]) => JSON.parse(request.content).recordType === 'artifact'),
          ).toBe(true),
        timeout,
      )
      if (destination === 'workspace') {
        await fireEvent.click(screen.getByRole('button', { name: 'Open Folder' }))
        await waitFor(() => expect(bridge.chooseWorkspaceFolder).toHaveBeenCalledOnce(), timeout)
      } else {
        await fireEvent.click(
          screen.getByRole('treeitem', { name: destination === 'overview' ? /resources package/ : 'scripts/new.py' }),
        )
        expect($activePackageSelection.get()?.kind).toBe(destination)
        expect($activeActivity.get()).toBe('packages')
      }
      release()
      await closing
      await tick()
      if (destination === 'workspace') {
        await waitFor(() => expect(setRoot).toHaveBeenCalledWith('/second-workspace'), timeout)
        await waitFor(() => expect(workspace.get().id).toBe('second-workspace'), timeout)
        expect(screen.queryByText(/Artifact close already in progress/)).not.toBeInTheDocument()
      } else {
        expect($activeActivity.get()).toBe('packages')
        expect($activePackageSelection.get()?.kind).toBe(destination)
      }
      if (destination === 'artifact') {
        expect(await screen.findByRole('textbox', { name: 'pkg/scripts/new.py' }, timeout)).toHaveTextContent(
          'print(2)',
        )
        expect(screen.queryByText('Artifact is closed')).not.toBeInTheDocument()
      }
    } finally {
      release()
      rendered.unmount()
    }
  },
  60_000,
)
