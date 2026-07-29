import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyBrandTheme, loadBundledBrand } from '$src/lib/branding/load-brand'
import { editDocumentText } from '$src/lib/documents/revisions'
import { showActivity, showEditorMode } from '$src/stores/shell'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
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
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import archonFixtureText from '../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
import { canonicalizeContractPayload, sha256Hex } from '$src/lib/contract/canonical-json'
import type { ContractCacheStoredEntry } from '$src/lib/contract/contract-cache'
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

describe('App', () => {
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

  it('offers a workspace action without requiring Hermes', () => {
    const { container } = render(App)
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

    const importButton = screen.getByRole('button', { name: 'Import' })
    await waitFor(() => expect(importButton).toBeEnabled())
    await fireEvent.click(importButton)

    expect(screen.queryByRole('dialog', { name: 'Import workflow' })).not.toBeInTheDocument()
  })

  it('blocks companion creation before reading or writing YAML when the App cache has no active selection', async () => {
    contractResolverTestState.missingActiveProfile = 'archon-2026-07'
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
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Create Companion' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The active archon-2026-07 authoring contract is unavailable.',
    )
    expect(workspaceRead).not.toHaveBeenCalled()
    expect(workspaceWrite).not.toHaveBeenCalled()
  })

  it('opens existing YAML against the bundled legacy production contract', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))

    await waitFor(() => expect($documentSession.get().pair?.definition.path).toBe('examples/hello.yaml'))
    expect(screen.queryByText(/workflow analysis is unavailable/i)).not.toBeInTheDocument()
  })

  it('renders a structured blocked save outcome for the active document', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
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

    expect(screen.getByText(/unsaved workflow file missing after external remove: flow.yaml/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Keep Mine / Recreate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close and Recover Later' })).toBeEnabled()
  })

  it('keeps the Explorer header and import affordance visible for an opened empty workspace', () => {
    loadWorkspaceEntries('empty', 'Empty', [])
    render(App)

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

    await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /readonly.yaml, legacy workflow, read only/i }))
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Duplicate Pair' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Create Companion' })).toBeDisabled()
  })

  it('renders the approved five-region workbench and updates the active activity accessibly', async () => {
    render(App)

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

  it('uses an accessible button group to select the editor mode', async () => {
    render(App)

    expect(screen.getByRole('group', { name: 'Editor mode' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.click(screen.getByRole('button', { name: 'YAML' }))
    await tick()

    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders the current valid YAML projection in the visual canvas without replacing the document session', () => {
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

    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Arrange graph' })).toBeEnabled()
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
    await tick()
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

  it('applies the selected light theme across the shell chrome', () => {
    applyBrandTheme(loadBundledBrand(), 'light')
    render(App)

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
