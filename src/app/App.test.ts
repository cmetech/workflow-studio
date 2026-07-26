import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyBrandTheme, loadBundledBrand } from '$src/lib/branding/load-brand'
import { showActivity, showEditorMode } from '$src/stores/shell'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
} from '$src/stores/documents'
import { $activeLayout as activeLayoutStore, clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import App from './App.svelte'

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

  it('visibly disables contract-dependent creation when no validated production contract is bundled', async () => {
    render(App)

    expect(await screen.findByText(/no validated production authoring contract is bundled/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Workflow' })).toBeDisabled()
  })

  it('opens existing YAML without a production contract and reports analysis as blocking', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))

    expect(await screen.findByText(/workflow analysis is unavailable/i)).toBeVisible()
    expect(screen.getByText(/1 blocking/i)).toBeVisible()
  })

  it('renders a structured blocked save outcome for the active document', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))
    await screen.findByText(/workflow analysis is unavailable/i)
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
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeEmptyDOMElement()
    expect(screen.getByRole('status')).toBeVisible()

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
    expect(screen.getByRole('textbox')).not.toBe(editor)
    expect(screen.getByRole('textbox')).toHaveTextContent(/name: Other/)
  })

  it('applies the selected light theme across the shell chrome', () => {
    applyBrandTheme(loadBundledBrand(), 'light')
    render(App)

    expect(document.documentElement.style.getPropertyValue('--color-yaml-gutter')).toBe('#ECE8D7')
    expect(document.documentElement.style.getPropertyValue('--color-node-selected')).toBe('#FFF4B8')
    expect(screen.getByRole('navigation', { name: 'Activities' }).style.backgroundColor).toBe(
      'var(--color-yaml-gutter)',
    )
    expect(screen.getByRole('status').style.backgroundColor).toBe('var(--color-node-selected)')
  })
})
