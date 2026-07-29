import { fireEvent, render, screen } from '@testing-library/svelte'
import { parse } from 'yaml'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { ContractCacheStoredEntry } from '$src/lib/contract/contract-cache'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
} from '$src/stores/documents'
import { clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import { clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import { createHistoryState, historyStore } from '$src/stores/history'

type AppComponent = (typeof import('./App.svelte'))['default']

const source = `name: Cache boundary
description: Existing authoring session
nodes:
  - id: collect
    command: /collect
  - id: review
    command: /review
`

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

function projection() {
  const definition = parse(source) as { name: string; description: string; nodes: Record<string, unknown>[] }
  return {
    name: definition.name,
    description: definition.description,
    profile: 'hermes-legacy' as const,
    nodes: definition.nodes.map((node, index) => ({
      id: String(node.id),
      kind: 'command',
      value: node.command,
      dependsOn: [],
      options: {},
      source: { path: `/nodes/${index}`, start: index * 10, end: index * 10 + 9 },
    })),
    edges: [],
    definition,
    companion: null,
  }
}

function openExistingSession(contract: AuthoringContract): void {
  loadWorkspaceEntries('workspace', 'Workspace', [
    { relativePath: 'cache-boundary.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
  ])
  openDocumentSession(
    {
      workflowId: 'workflow:workspace:cache-boundary.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'workflow:workspace:cache-boundary.yaml:definition',
        kind: 'definition',
        path: 'cache-boundary.yaml',
        text: source,
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    },
    contract.contract_digest,
  )
  receiveDocumentAnalysis({
    ...$documentSession.get().revision!,
    structurallyValid: true,
    issues: [],
    projection: projection(),
  })
  setActiveLayout({
    schemaVersion: 1,
    workspaceId: 'workspace',
    workflowPath: 'cache-boundary.yaml',
    nodePositions: { collect: { x: 0, y: 0 }, review: { x: 320, y: 0 } },
    viewport: { x: 0, y: 0, zoom: 1 },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-07-25T00:00:00.000Z',
  })
}

describe.sequential('App cached contract boundary', () => {
  let App: AppComponent
  let legacyContract: AuthoringContract
  const hydration = deferred<readonly ContractCacheStoredEntry[]>()

  beforeAll(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
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
    const contracts = await loadBundledAuthoringContracts()
    legacyContract = contracts.find(({ profile }) => profile === 'hermes-legacy')!
    setNativeBridgeForTest({ ...createBrowserBridge(), contractCacheLoad: () => hydration.promise })
    App = (await import('./App.svelte')).default
  })

  afterEach(() => {
    clearCanvasState()
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    historyStore.set(createHistoryState())
  })

  afterAll(() => {
    hydration.resolve([])
    setNativeBridgeForTest(undefined)
  })

  it('keeps bundled authoring available while native cached-contract hydration is pending', async () => {
    openExistingSession(legacyContract)
    setCanvasSelection(['collect', 'review'])
    const rendered = render(App)

    try {
      await screen.findByRole('region', { name: 'Workflow graph' })
      await fireEvent.click(screen.getByRole('button', { name: 'Add node' }))
      expect(await screen.findByRole('option', { name: /command/i })).toBeVisible()
    } finally {
      rendered.unmount()
      hydration.resolve([])
    }
  })

  it('materializes an array schema default without changing it or the authoritative YAML', async () => {
    hydration.resolve([])
    openExistingSession(legacyContract)
    const rendered = render(App)
    const before = $documentSession.get().pair?.definition.text

    try {
      await screen.findByRole('region', { name: 'Workflow graph' })
      setCanvasSelection(['collect'])
      await fireEvent.click(screen.getByRole('tab', { name: 'Execution' }))
      expect(await screen.findByRole('group', { name: 'Depends on' })).toBeVisible()
      expect(screen.getAllByText(/^inherited default:/).length).toBeGreaterThan(0)

      await fireEvent.click(screen.getByRole('button', { name: 'Add Depends on item' }))
      const dependency = screen.getByRole('textbox', { name: 'Depends on item 1' })
      await fireEvent.input(dependency, { target: { value: 'review' } })
      expect(dependency).toHaveValue('review')

      await fireEvent.click(screen.getByRole('button', { name: 'Reset Depends on draft' }))
      expect(screen.queryByRole('textbox', { name: 'Depends on item 1' })).not.toBeInTheDocument()
      expect($documentSession.get().pair?.definition.text).toBe(before)
    } finally {
      rendered.unmount()
    }
  })
})
