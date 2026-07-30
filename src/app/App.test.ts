import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyBrandTheme, loadBundledBrand } from '$src/lib/branding/load-brand'
import { editDocumentText } from '$src/lib/documents/revisions'
import { showActivity, showEditorMode } from '$src/stores/shell'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { clearWorkspace, loadWorkspaceEntries, workspace } from '$src/stores/workspace'
import {
  $documentSession,
  $documentSyncOrigins,
  $problemFocus,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
  updateDocumentSession,
} from '$src/stores/documents'
import { $activeLayout as activeLayoutStore, clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import { $canvasSelection, setCanvasSelection } from '$src/stores/canvas'
import { resetGitState } from '$src/stores/git'
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import archonFixtureText from '../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
import { canonicalizeContractPayload, sha256Hex } from '$src/lib/contract/canonical-json'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import type { ContractCacheStoredEntry } from '$src/lib/contract/contract-cache'
import { createCommandRegistry, listCommands } from '$src/lib/commands/registry'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from '$src/workers/document-worker'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'
import App from './App.svelte'

const contractResolverTestState = vi.hoisted(() => ({
  missingActiveProfile: null as 'hermes-legacy' | 'archon-2026-07' | null,
}))

vi.mock('$src/lib/contract/contract-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$src/lib/contract/contract-cache')>()
  return {
    ...actual,
    createContractCache(options: Parameters<typeof actual.createContractCache>[0]) {
      const cache = actual.createContractCache(options)
      return {
        ...cache,
        activeContract(profile: 'hermes-legacy' | 'archon-2026-07') {
          return contractResolverTestState.missingActiveProfile === profile ? undefined : cache.activeContract(profile)
        },
      }
    },
  }
})

async function cachedArchonFixture(): Promise<Uint8Array> {
  const payload: Record<string, unknown> = {
    ...(JSON.parse(archonFixtureText) as Record<string, unknown>),
    normalizer_version: 2,
  }
  payload.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(payload))}`
  return new TextEncoder().encode(JSON.stringify(payload))
}

async function cachedArchonEntry(): Promise<ContractCacheStoredEntry> {
  const bytes = await cachedArchonFixture()
  const content = new TextDecoder().decode(bytes)
  const payload = JSON.parse(content) as {
    contract_digest: `sha256:${string}`
    profile: 'archon-2026-07'
    schema_version: number
    normalizer_version: number
    contract_reader_version: number
  }
  return {
    digest: payload.contract_digest,
    profile: payload.profile,
    schemaVersion: payload.schema_version,
    normalizerVersion: payload.normalizer_version,
    readerVersion: payload.contract_reader_version,
    source: { kind: 'user', identifier: '/selected/archon-v2.json' },
    content,
    active: false,
  }
}

async function waitForSetupReady(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })).not.toBeInTheDocument()
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

class RealDocumentWorker {
  private readonly cache = createDocumentWorkerCache()
  private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()

  postMessage(message: DocumentWorkerRequest): void {
    void processDocumentWorkerRequest(message, this.cache).then((response) => {
      queueMicrotask(() => {
        for (const listener of this.listeners) listener(new MessageEvent('message', { data: response }))
      })
    })
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void {
    this.listeners.delete(listener)
  }

  terminate(): void {
    this.listeners.clear()
  }
}

describe('App', () => {
  it('mounts runtime brand management in Settings', async () => {
    showActivity('settings')
    render(App)

    expect(await screen.findByRole('heading', { name: 'Brand and theme packs' })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import brand pack' })).toBeEnabled())
  })

  it('initializes Git at the authoritative current workspace root after the root changes', async () => {
    const gitInit = vi.fn(async () => ({ root: '/current', branch: 'main', detachedHead: null }))
    setNativeBridgeForTest({
      gitDetect: vi.fn(async () => null),
      gitInit,
      workspaceScan: vi.fn(async () => []),
    })
    loadWorkspaceEntries('old', 'old', [], '/old')
    render(App)
    loadWorkspaceEntries('current', 'current', [], '/current')
    showActivity('git')

    await fireEvent.click(await screen.findByRole('button', { name: 'Initialize Git repository' }))
    expect(screen.getByText('/current')).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Initialize repository' }))

    await waitFor(() => expect(gitInit).toHaveBeenCalledWith('/current'))
    expect(gitInit).not.toHaveBeenCalledWith('/old')
  })

  it('does not acquire or dispose Git history authority when the application unmounts without history work', async () => {
    const gitBeginHistorySession = vi.fn(async () => 41)
    const gitDisposeHistorySession = vi.fn(async () => undefined)
    setNativeBridgeForTest({
      gitBeginHistorySession,
      gitDisposeHistorySession,
    })
    const app = render(App)
    app.unmount()

    await Promise.resolve()
    expect(gitBeginHistorySession).not.toHaveBeenCalled()
    expect(gitDisposeHistorySession).not.toHaveBeenCalled()
  })

  it('mounts the offline documentation activity with an explicit unavailable state before a contract is active', async () => {
    showActivity('documentation')
    render(App)

    expect(screen.getByText('Documentation is unavailable for the active contract.')).toBeVisible()
  })

  it('does not fall back to another profile documentation index for a projection-less session', () => {
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:stale.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'stale:definition',
          kind: 'definition',
          path: 'stale.yaml',
          text: 'name: Stale\n',
          revision: 0,
          savedRevision: 0,
          diskHash: null,
        },
        companion: null,
      },
      `sha256:${'f'.repeat(64)}`,
    )
    showActivity('documentation')
    render(App)

    expect(screen.getByText('Documentation is unavailable for the active contract.')).toBeVisible()
  })

  it('opens the exact offline documentation topic from an example card', async () => {
    const legacy = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')!
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:example-host.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'example-host:definition',
          kind: 'definition',
          path: 'example-host.yaml',
          text: 'name: Example host\n',
          revision: 0,
          savedRevision: 0,
          diskHash: null,
        },
        companion: null,
      },
      legacy.contract_digest,
    )
    showActivity('examples')
    render(App)

    const topics = await screen.findAllByRole('button', { name: 'Open documentation: Workflow definition' })
    await fireEvent.click(topics[0]!)

    expect(await screen.findByLabelText('Offline documentation')).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'Workflow definition' })).toBeVisible()
  })

  it('opens a legacy example topic without an active document', async () => {
    showActivity('examples')
    render(App)

    const minimalTitle = await screen.findByRole('heading', { name: 'Minimal prompt' })
    const minimalCard = minimalTitle.closest('article')!
    await fireEvent.click(within(minimalCard).getByRole('button', { name: 'Open documentation: Workflow definition' }))

    const documentation = await screen.findByLabelText('Offline documentation')
    expect(documentation).toHaveAttribute('data-profile', 'hermes-legacy')
    expect(await screen.findByRole('heading', { name: 'Workflow definition' })).toBeVisible()
  })

  it('uses the example profile rather than an open document profile for documentation', async () => {
    const archon = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'archon-2026-07')!
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:archon-host.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'archon-host:definition',
          kind: 'definition',
          path: 'archon-host.yaml',
          text: 'name: Archon host\n',
          revision: 0,
          savedRevision: 0,
          diskHash: null,
        },
        companion: null,
      },
      archon.contract_digest,
    )
    showActivity('examples')
    render(App)

    const minimalTitle = await screen.findByRole('heading', { name: 'Minimal prompt' })
    await fireEvent.click(
      within(minimalTitle.closest('article')!).getByRole('button', { name: 'Open documentation: Workflow definition' }),
    )

    expect(await screen.findByLabelText('Offline documentation')).toHaveAttribute('data-profile', 'hermes-legacy')
  })

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
  })

  afterEach(() => {
    contractResolverTestState.missingActiveProfile = null
    setNativeBridgeForTest(undefined)
    showActivity('explorer')
    showEditorMode('visual')
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    resetGitState()
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
    document.documentElement.removeAttribute('data-brand')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
  })

  it('offers a workspace action without requiring Hermes', async () => {
    const { container } = render(App)
    await waitForSetupReady()
    expect(screen.getByRole('heading', { name: 'LOOP24 Workflow Studio' })).toBeVisible()
    expect(container.querySelector('.brand-lockup img')).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open Folder' })).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: 'Open Folder' }).every((button) => !button.hasAttribute('disabled')),
    ).toBe(true)
    expect(screen.queryByText(/connect to hermes/i)).not.toBeInTheDocument()
  })

  it('mounts contract management from the Settings activity without a workspace', async () => {
    render(App)
    showActivity('settings')

    expect(await screen.findByRole('heading', { name: 'Workflow contracts' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import Contract File' })).toBeEnabled()
  })

  it('keeps an imported contract available when Settings is left and reopened', async () => {
    setNativeBridgeForTest({
      chooseContractFile: async () => '/selected/archon.json',
      contractReadFile: cachedArchonFixture,
    })
    render(App)
    showActivity('settings')
    await fireEvent.click(await screen.findByRole('button', { name: 'Import Contract File' }))
    expect(await screen.findByText('Cached')).toBeVisible()

    showActivity('explorer')
    await tick()
    showActivity('settings')

    expect(await screen.findByText('Cached')).toBeVisible()
  })

  it('resolves a selected cached contract when a matching paired workflow opens after Settings activation', async () => {
    class ContractAcknowledgingWorker {
      private listeners = new Set<
        (
          event: MessageEvent<{
            type: string
            requestId: string
            contractDigest: `sha256:${string}`
            profile: 'archon-2026-07'
          }>,
        ) => void
      >()
      postMessage(message: {
        type: string
        requestId: string
        contractDigest: `sha256:${string}`
        profile: 'archon-2026-07'
      }): void {
        if (message.type !== 'contract-register') return
        queueMicrotask(() => {
          for (const listener of this.listeners)
            listener({
              data: {
                type: 'contract-registered',
                requestId: message.requestId,
                contractDigest: message.contractDigest,
                profile: message.profile,
              },
            } as MessageEvent)
        })
      }
      addEventListener(
        _type: 'message',
        listener: (
          event: MessageEvent<{
            type: string
            requestId: string
            contractDigest: `sha256:${string}`
            profile: 'archon-2026-07'
          }>,
        ) => void,
      ): void {
        this.listeners.add(listener)
      }
      removeEventListener(
        _type: 'message',
        listener: (
          event: MessageEvent<{
            type: string
            requestId: string
            contractDigest: `sha256:${string}`
            profile: 'archon-2026-07'
          }>,
        ) => void,
      ): void {
        this.listeners.delete(listener)
      }
      terminate(): void {}
    }
    const originalWorker = globalThis.Worker
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ContractAcknowledgingWorker })
    const bytes = await cachedArchonFixture()
    const digest = (JSON.parse(new TextDecoder().decode(bytes)) as { contract_digest: `sha256:${string}` })
      .contract_digest
    setNativeBridgeForTest({
      chooseContractFile: async () => '/selected/archon.json',
      contractReadFile: async () => bytes,
      workspaceRead: async (path) => ({
        relativePath: path,
        text: path.endsWith('.hermes.yaml') ? 'language_compatibility: archon-2026-07\n' : 'name: cached\nnodes: []\n',
        sha256: 'a'.repeat(64),
        size: 1,
        modifiedAt: 'now',
        readOnly: false,
      }),
    })
    try {
      render(App)
      showActivity('settings')
      await fireEvent.click(await screen.findByRole('button', { name: 'Import Contract File' }))
      await fireEvent.click(screen.getByRole('button', { name: `Activate ${digest}` }))
      await waitFor(() => expect(screen.getAllByText('Active')).toHaveLength(2))

      loadWorkspaceEntries('cached-workspace', 'Cached workspace', [
        { relativePath: 'cached.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
        {
          relativePath: 'cached.hermes.yaml',
          kind: 'file',
          size: 1,
          modifiedAt: '0',
          symlink: 'none',
          readOnly: false,
        },
      ])
      showActivity('explorer')
      await tick()
      await fireEvent.click(screen.getByRole('treeitem', { name: /cached.yaml/i }))

      await waitFor(() => expect($documentSession.get().revision?.contractDigest).toBe(digest))
    } finally {
      if (originalWorker === undefined) Reflect.deleteProperty(globalThis, 'Worker')
      else Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
    }
  })

  it('enables contract-dependent creation from validated bundled production contracts', async () => {
    render(App)

    await waitFor(() => expect(screen.getByRole('button', { name: 'New Workflow' })).toBeEnabled())
    expect(screen.queryByText(/no validated production authoring contract is bundled/i)).not.toBeInTheDocument()
  })

  it('does not offer a lexical same-profile fallback in New Workflow when the App cache has no active selection', async () => {
    contractResolverTestState.missingActiveProfile = 'archon-2026-07'
    setNativeBridgeForTest({ contractCacheLoad: async () => [await cachedArchonEntry()] })
    render(App)
    await waitForSetupReady()

    const openDialog = screen.getByRole('button', { name: 'New Workflow' })
    await waitFor(() => expect(openDialog).toBeEnabled())
    await fireEvent.click(openDialog)

    const profile = await screen.findByRole('combobox', { name: 'Profile' })
    expect(within(profile).queryByRole('option', { name: 'archon-2026-07' })).not.toBeInTheDocument()
    expect(within(profile).getByRole('option', { name: 'hermes-legacy' })).toBeInTheDocument()
  })

  it('does not open Import with a lexical same-profile fallback when the App cache has no active selection', async () => {
    contractResolverTestState.missingActiveProfile = 'archon-2026-07'
    setNativeBridgeForTest({ contractCacheLoad: async () => [await cachedArchonEntry()] })
    loadWorkspaceEntries('ambiguous-contracts', 'Ambiguous contracts', [])
    render(App)
    await waitForSetupReady()

    const importButton = screen.getByRole('button', { name: 'Import' })
    await waitFor(() => expect(importButton).toBeEnabled())
    await fireEvent.click(importButton)

    expect(screen.queryByRole('dialog', { name: 'Import workflow' })).not.toBeInTheDocument()
  })

  it('blocks companion creation before reading or writing YAML when the App cache has no active selection', async () => {
    contractResolverTestState.missingActiveProfile = 'hermes-legacy'
    const workspaceRead = vi.fn(async (path: string) => ({
      relativePath: path,
      text: 'name: Existing\ndescription: Existing workflow\nnodes:\n  - id: first\n    command: echo\n',
      sha256: 'a'.repeat(64),
      size: 1,
      modifiedAt: 'now',
      readOnly: false,
    }))
    const workspaceWrite = vi.fn()
    setNativeBridgeForTest({
      contractCacheLoad: async () => [await cachedArchonEntry()],
      workspaceRead,
      workspaceWrite,
    })
    loadWorkspaceEntries('ambiguous-contracts', 'Ambiguous contracts', [
      { relativePath: 'existing.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: 'New Workflow' }).every((button) => !button.hasAttribute('disabled')),
      ).toBe(true)
    })

    await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /existing.yaml/i }))
    const createCompanion = screen.getByRole('menuitem', { name: 'Create Companion' })
    expect(createCompanion).toBeDisabled()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(workspaceRead).not.toHaveBeenCalled()
    expect(workspaceWrite).not.toHaveBeenCalled()
  })

  it('opens existing YAML against the bundled legacy production contract', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await waitForSetupReady()
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))

    await waitFor(() => expect($documentSession.get().pair?.definition.path).toBe('examples/hello.yaml'))
    expect(screen.queryByText(/workflow analysis is unavailable/i)).not.toBeInTheDocument()
  })

  it('keeps a later Explorer selection active when editable-copy creation finishes afterward', async () => {
    const releaseDemo = `name: Release demo
description: Keep the later Explorer intent active.
nodes:
  - id: release
    command: publish
`
    const backing = createBrowserBridge({ initialFiles: { 'release-demo.yaml': releaseDemo } })
    const allowCreationWrite = deferred<void>()
    let creationWriteStarted = false
    const workspaceScan = vi.fn(backing.workspaceScan)
    setNativeBridgeForTest({
      workspaceScan,
      workspaceRead: backing.workspaceRead,
      workspaceTrashPaths: backing.workspaceTrashPaths,
      workspaceWrite: async (input) => {
        creationWriteStarted = true
        await allowCreationWrite.promise
        return backing.workspaceWrite(input)
      },
    })
    const originalWorker = globalThis.Worker
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: RealDocumentWorker })
    try {
      loadWorkspaceEntries('browser-workspace', 'Workspace', await backing.workspaceScan())
      showActivity('examples')
      render(App)
      await waitForSetupReady()

      await fireEvent.click((await screen.findAllByRole('button', { name: /^Create Editable Copy:/ }))[0]!)
      await waitFor(() => expect(creationWriteStarted).toBe(true))
      await fireEvent.click(screen.getByRole('button', { name: 'Explorer' }))
      const releaseEntry = screen.getByRole('treeitem', { name: /release-demo\.yaml/i })
      await fireEvent.click(releaseEntry)
      await waitFor(() => expect($documentSession.get().pair?.definition.path).toBe('release-demo.yaml'))

      allowCreationWrite.resolve()
      await waitFor(() => expect(workspace.get().files.length).toBeGreaterThan(1))
      expect($documentSession.get().pair?.definition.path).toBe('release-demo.yaml')
      expect($documentSession.get().pair?.definition.text).toBe(releaseDemo)
      expect(workspace.get().activeEntryId).toBe('workflow:browser-workspace:release-demo.yaml')
      expect(screen.getByRole('treeitem', { name: /release-demo\.yaml/i })).toHaveAttribute('aria-current', 'page')
    } finally {
      allowCreationWrite.resolve()
      if (originalWorker === undefined) Reflect.deleteProperty(globalThis, 'Worker')
      else Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
    }
  })

  it('renders a structured blocked save outcome for the active document', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await waitForSetupReady()
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))
    await waitFor(() => expect($documentSession.get().pair).not.toBeNull())
    const activePair = $documentSession.get().pair
    expect(activePair).not.toBeNull()

    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      analysisError: null,
      missingChange: null,
      saveOutcome: {
        status: 'blocked',
        pair: activePair!,
        issues: [],
        reason: 'analysis_missing_or_stale',
      },
    })
    await tick()

    expect(screen.getByRole('alert')).toHaveTextContent('Save blocked: analysis_missing_or_stale')
  })

  it('surfaces a dirty active file removed outside the application', async () => {
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:flow.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:flow.yaml:definition',
          kind: 'definition',
          path: 'flow.yaml',
          text: 'name: dirty\n',
          revision: 1,
          savedRevision: 0,
          diskHash: 'a'.repeat(64),
        },
        companion: null,
      },
      `sha256:${'0'.repeat(64)}`,
    )
    $documentWorkspace.set({
      ...$documentWorkspace.get(),
      missingChange: { kind: 'remove', paths: ['flow.yaml'], dirty: true },
    })
    render(App)
    await waitForSetupReady()

    expect(screen.getByText(/unsaved workflow file missing after external remove: flow.yaml/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Keep Mine / Recreate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close and Recover Later' })).toBeEnabled()
  })

  it('keeps the Explorer header and import affordance visible for an opened empty workspace', async () => {
    loadWorkspaceEntries('empty', 'Empty', [])
    render(App)
    await waitForSetupReady()

    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toContainElement(
      screen.getByRole('heading', { name: 'Explorer' }),
    )
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)
  })

  it('passes the selected read-only workflow context into context-menu enablement', async () => {
    loadWorkspaceEntries('workspace', 'Workspace', [
      {
        relativePath: 'readonly.yaml',
        kind: 'file',
        size: 1,
        modifiedAt: '0',
        symlink: 'none',
        readOnly: true,
      },
    ])
    render(App)
    await waitForSetupReady()

    await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /readonly.yaml, legacy workflow, read only/i }))
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Duplicate Pair' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Create Companion' })).toBeDisabled()
  })

  it('renders the approved five-region workbench and updates the active activity accessibly', async () => {
    render(App)
    await waitForSetupReady()

    expect(screen.getByRole('navigation', { name: 'Activities' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toBeEmptyDOMElement()
    expect(screen.getByRole('region', { name: 'Workflow editor' })).toContainElement(
      screen.getByRole('region', { name: 'Open workspace drop zone' }),
    )
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toContainElement(
      screen.getByRole('region', { name: 'Workflow inspector' }),
    )
    expect(screen.getByRole('status', { name: 'Application status' })).toBeVisible()

    await fireEvent.click(screen.getByRole('button', { name: 'Nodes' }))
    await tick()

    expect(screen.getByRole('button', { name: 'Nodes' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('mounts the local Git activity view from feature-owned Git state', async () => {
    loadWorkspaceEntries('workspace', 'Workspace', [])
    const gitStatus = vi.fn(async () => ({ entries: [] }))
    let notifyGitChanged:
      | ((event: { paths: readonly string[]; kind: 'create' | 'modify' | 'remove' | 'rename' }) => void | Promise<void>)
      | undefined
    setNativeBridgeForTest({
      gitDetect: async () => ({ root: '/repo', branch: 'main', detachedHead: null }),
      gitStatus,
      onGitChanged: async (handler) => {
        notifyGitChanged = handler
        return () => undefined
      },
    })
    render(App)
    await waitForSetupReady()

    await fireEvent.click(screen.getByRole('button', { name: 'Git' }))

    expect(screen.getByRole('heading', { name: 'Git' })).toBeVisible()
    expect(await screen.findByText('Branch: main')).toBeVisible()
    await waitFor(() => expect(notifyGitChanged).toBeDefined())
    const callsBeforeMetadataChange = gitStatus.mock.calls.length
    await notifyGitChanged!({ paths: ['index', 'HEAD'], kind: 'modify' })
    await waitFor(() => expect(gitStatus.mock.calls.length).toBeGreaterThan(callsBeforeMetadataChange))
  })

  it('uses an accessible button group to select the editor mode', async () => {
    render(App)
    await waitForSetupReady()

    expect(screen.getByRole('group', { name: 'Editor mode' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.click(screen.getByRole('button', { name: 'YAML' }))
    await tick()

    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('derives editor-mode labels, disabled reasons, and handlers from its injected command registry', async () => {
    const registry = createCommandRegistry()
    const runSplit = vi.fn(() => showEditorMode('yaml'))
    for (const command of listCommands()) {
      registry.registerCommand(
        command.id === 'view.editor.split'
          ? { ...command, label: 'Registry Split', run: runSplit }
          : command.id === 'view.editor.yaml'
            ? {
                ...command,
                label: 'Registry Source',
                enabled: () => false,
                disabledReason: () => 'Source mode is locked.',
              }
            : command,
      )
    }
    render(App, { props: { commandSurface: registry } } as never)
    await waitForSetupReady()

    const split = screen.getByRole('button', { name: 'Registry Split' })
    const sourceMode = screen.getByRole('button', { name: 'Registry Source' })
    expect(sourceMode).toBeDisabled()
    expect(sourceMode).toHaveAttribute('title', 'Source mode is locked.')
    await fireEvent.click(split)

    expect(runSplit).toHaveBeenCalledOnce()
    expect(sourceMode).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps visual Find selected from an open command palette visibly open', async () => {
    render(App)
    await waitFor(() => expect(screen.getByRole('button', { name: 'New Workflow' })).toBeEnabled())
    await waitFor(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))
      expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    })
    const search = await screen.findByRole('combobox', { name: 'Search commands' })
    await fireEvent.input(search, { target: { value: 'Find' } })
    await fireEvent.keyDown(search, { key: 'Enter' })

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveFocus()
  })

  it('renders the current valid YAML projection in the visual canvas without replacing the document session', async () => {
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'flow.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:flow.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:flow.yaml:definition',
          kind: 'definition',
          path: 'flow.yaml',
          text: 'name: Flow\ndescription: Test\nnodes:\n  - id: collect\n    command: Gather\n',
          revision: 0,
          savedRevision: 0,
          diskHash: 'a'.repeat(64),
        },
        companion: null,
      },
      `sha256:${'1'.repeat(64)}`,
    )
    const revision = $documentSession.get().revision!
    receiveDocumentAnalysis({
      ...revision,
      issues: [],
      structurallyValid: true,
      projection: {
        name: 'Flow',
        description: 'Test',
        profile: 'hermes-legacy',
        nodes: [
          {
            id: 'collect',
            kind: 'command',
            value: 'Gather',
            dependsOn: [],
            options: {},
            source: { path: '/nodes/0', start: 36, end: 72 },
          },
        ],
        edges: [],
        definition: { name: 'Flow' },
        companion: null,
      },
    })
    setActiveLayout({
      schemaVersion: 1,
      workspaceId: 'workspace',
      workflowPath: 'flow.yaml',
      nodePositions: { collect: { x: 20, y: 30 } },
      viewport: { x: 0, y: 0, zoom: 1 },
      panels: { left: 280, right: 320, problems: 180 },
      editorMode: 'visual',
      updatedAt: '2026-07-25T00:00:00.000Z',
    })
    const before = $documentSession.get().pair

    render(App)
    await waitForSetupReady()

    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Arrange Graph' })).toBeEnabled()
    expect($documentSession.get().pair).toBe(before)
  })

  it('keeps the last valid graph and authoritative CodeMirror instance mounted across editor modes', async () => {
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'flow.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:flow.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:flow.yaml:definition',
          kind: 'definition',
          path: 'flow.yaml',
          text: 'name: Flow\nnodes:\n  - id: collect\n    command: Gather\n',
          revision: 0,
          savedRevision: 0,
          diskHash: 'a'.repeat(64),
        },
        companion: null,
      },
      `sha256:${'1'.repeat(64)}`,
    )
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      issues: [],
      structurallyValid: true,
      projection: {
        name: 'Flow',
        description: '',
        profile: 'hermes-legacy',
        nodes: [
          {
            id: 'collect',
            kind: 'command',
            value: 'Gather',
            dependsOn: [],
            options: {},
            source: { path: '/nodes/0', start: 20, end: 56 },
          },
        ],
        edges: [],
        definition: { name: 'Flow' },
        companion: null,
      },
    })
    setActiveLayout({
      schemaVersion: 1,
      workspaceId: 'workspace',
      workflowPath: 'flow.yaml',
      nodePositions: { collect: { x: 20, y: 30 } },
      viewport: { x: 0, y: 0, zoom: 1 },
      panels: { left: 280, right: 320, problems: 180 },
      editorMode: 'visual',
      updatedAt: '2026-07-25T00:00:00.000Z',
    })
    render(App)
    await waitForSetupReady()

    const graph = screen.getByRole('region', { name: 'Workflow graph' })
    await fireEvent.click(screen.getByRole('button', { name: 'YAML' }))
    await tick()

    expect(screen.getByRole('tabpanel', { name: 'Definition YAML' })).toBeVisible()
    const editor = screen.getByRole('textbox')
    expect(editor).toHaveTextContent(/name: Flow/)
    expect(screen.getByRole('region', { name: 'Workflow graph', hidden: true })).toBe(graph)
    expect(activeLayoutStore.get()?.editorMode).toBe('yaml')

    await fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    await tick()
    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBe(graph)
    expect(screen.getByRole('tabpanel', { name: 'Definition YAML' })).toBeVisible()
    expect(screen.getByRole('textbox')).toBe(editor)
    setCanvasSelection(['collect'])

    openDocumentSession(
      {
        workflowId: 'workflow:workspace:other.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:other.yaml:definition',
          kind: 'definition',
          path: 'other.yaml',
          text: 'name: Other\n',
          revision: 0,
          savedRevision: 0,
          diskHash: 'b'.repeat(64),
        },
        companion: null,
      },
      `sha256:${'1'.repeat(64)}`,
    )
    await tick()
    expect($canvasSelection.get()).toEqual([])
    expect(screen.getByRole('textbox')).not.toBe(editor)
    expect(screen.getByRole('textbox')).toHaveTextContent(/name: Other/)
  })

  it('routes ProblemsPanel focus through the identity-gated active YAML tab and clears the request', async () => {
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'flow.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:flow.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:flow.yaml:definition',
          kind: 'definition',
          path: 'flow.yaml',
          text: 'name: Flow\nnodes: []\n',
          revision: 0,
          savedRevision: 0,
          diskHash: 'a'.repeat(64),
        },
        companion: null,
      },
      `sha256:${'1'.repeat(64)}`,
    )
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      issues: [
        {
          code: 'nodes_required',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Add at least one node.',
          document: 'definition',
          line: 99,
          column: 99,
        },
      ],
      structurallyValid: false,
    })
    showEditorMode('visual')
    render(App)
    await waitForSetupReady()

    await fireEvent.click(screen.getByRole('button', { name: /add at least one node/i }))
    await tick()
    await tick()

    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: 'Definition YAML' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Definition YAML' })).toHaveFocus()
    expect($problemFocus.get()).toMatchObject({ issue: null, targetRevision: null, requested: false })
  })

  it('publishes each unified visual undo once through the authoritative document boundary', async () => {
    const digest = `sha256:${'1'.repeat(64)}` as const
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'flow.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:flow.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:flow.yaml:definition',
          kind: 'definition',
          path: 'flow.yaml',
          text: 'name: Flow\n',
          revision: 0,
          savedRevision: 0,
          diskHash: null,
        },
        companion: null,
      },
      digest,
    )
    showEditorMode('yaml')
    render(App)
    await waitForSetupReady()
    const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Definition YAML' }))!
    view.dispatch({ changes: { from: 6, to: 10, insert: 'Release' } })
    const release = $documentSession.get().pair!
    expect(release.definition.text).toBe('name: Release\n')

    const deploy = editDocumentText(release, 'definition', 'name: Deploy\n')
    updateDocumentSession(deploy, digest, 'visual')
    await tick()
    expect(view.state.doc.toString()).toBe('name: Deploy\n')
    expect($documentSession.get().pair).toBe(deploy)

    const published: Array<{ text: string; revision: number }> = []
    const analyzed: number[] = []
    let observedPair = $documentSession.get().pair
    let observedAnalysis = $documentSession.get().analysis
    const unsubscribe = $documentSession.subscribe((session) => {
      if (session.pair && session.pair !== observedPair) {
        published.push({ text: session.pair.definition.text, revision: session.pair.definition.revision })
        observedPair = session.pair
      }
      if (session.analysis !== observedAnalysis) {
        if (session.analysis) analyzed.push(session.analysis.definitionRevision)
        observedAnalysis = session.analysis
      }
    })

    expect(undo(view)).toBe(true)
    expect(published).toEqual([{ text: 'name: Release\n', revision: 3 }])
    expect(analyzed).toEqual([3])
    expect($documentSession.get().pair?.definition).toMatchObject({ text: 'name: Release\n', revision: 3 })
    expect($documentSyncOrigins.get().definition).toEqual({ revision: 3, origin: 'user' })

    published.length = 0
    analyzed.length = 0
    expect(undo(view)).toBe(true)
    expect(published).toEqual([{ text: 'name: Flow\n', revision: 4 }])
    expect(analyzed).toEqual([4])
    expect($documentSession.get().pair?.definition).toMatchObject({ text: 'name: Flow\n', revision: 4 })
    unsubscribe()
  })

  it('applies the selected light theme across the shell chrome', async () => {
    applyBrandTheme(loadBundledBrand(), 'light')
    render(App)
    await waitForSetupReady()

    expect(document.documentElement.style.getPropertyValue('--color-yaml-gutter')).toBe('#ECE8D7')
    expect(document.documentElement.style.getPropertyValue('--color-node-selected')).toBe('#FFF4B8')
    expect(screen.getByRole('navigation', { name: 'Activities' }).style.backgroundColor).toBe(
      'var(--color-yaml-gutter)',
    )
    expect(screen.getByRole('status', { name: 'Application status' }).style.backgroundColor).toBe(
      'var(--color-node-selected)',
    )
  })
})
