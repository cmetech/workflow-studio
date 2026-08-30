import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { parse } from 'yaml'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const nativeWindow = vi.hoisted(() => ({
  onCloseRequested: vi.fn(async () => () => undefined),
  onDragDropEvent: vi.fn(async () => () => undefined),
  destroy: vi.fn(async () => undefined),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }))

import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { clearCanvasState } from '$src/stores/canvas'
import { $documentSession, closeDocumentSession } from '$src/stores/documents'
import { clearActiveLayout } from '$src/stores/layout'
import { closeCommandPalette, closeKeyboardShortcuts, showEditorMode } from '$src/stores/shell'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import {
  createDocumentWorkerCache,
  processDocumentWorkerRequest,
  type DocumentWorkerCache,
} from '$src/workers/document-worker'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'

interface NativeHarness {
  yaml: string
  writes: string[]
}

const nativeHarness: NativeHarness = { yaml: '', writes: [] }
let App: (typeof import('$src/app/App.svelte'))['default']

class RealAnalysisWorker {
  private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()
  private readonly cache: DocumentWorkerCache = createDocumentWorkerCache()

  postMessage(message: DocumentWorkerRequest): void {
    void processDocumentWorkerRequest(message, this.cache).then((response) => {
      queueMicrotask(() => {
        for (const listener of this.listeners) listener({ data: response } as MessageEvent<DocumentWorkerResponse>)
      })
    })
  }

  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void {
    if (type === 'message') this.listeners.add(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
  }

  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void {
    if (type === 'message') this.listeners.delete(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
  }

  terminate(): void {
    this.listeners.clear()
  }
}

function nodeOverflowYaml(): string {
  return [
    'name: Node capacity boundary',
    'description: Valid workflow above the visual node limit.',
    'nodes:',
    ...Array.from({ length: 251 }, (_, index) => [
      `  - id: node-${String(index).padStart(3, '0')}`,
      `    command: preserve node ${index}`,
    ]).flat(),
    '',
  ].join('\n')
}

function edgeOverflowYaml(): string {
  const ids = Array.from({ length: 33 }, (_, index) => `node-${String(index).padStart(2, '0')}`)
  const incoming = new Map<string, string[]>()
  let edgeCount = 0
  for (let target = 1; target < ids.length && edgeCount < 501; target += 1) {
    for (let source = 0; source < target && edgeCount < 501; source += 1) {
      const dependencies = incoming.get(ids[target]!) ?? []
      dependencies.push(ids[source]!)
      incoming.set(ids[target]!, dependencies)
      edgeCount += 1
    }
  }
  return [
    'name: Edge capacity boundary',
    'description: Valid DAG above the visual edge limit.',
    'nodes:',
    ...ids.flatMap((id, index) => [
      `  - id: ${id}`,
      `    command: preserve node ${index}`,
      ...(incoming.has(id)
        ? ['    depends_on:', ...incoming.get(id)!.map((dependency) => `      - ${dependency}`)]
        : []),
    ]),
    '',
  ].join('\n')
}

async function openOversizedWorkflow(yaml: string, path: string): Promise<ReturnType<typeof render>> {
  nativeHarness.yaml = yaml
  nativeHarness.writes = []
  loadWorkspaceEntries('capacity-workspace', 'Capacity workspace', [
    { relativePath: path, kind: 'file', size: yaml.length, modifiedAt: '0', symlink: 'none', readOnly: false },
  ])
  const rendered = render(App)
  const entry = await screen.findByRole('treeitem', { name: new RegExp(`${path}.*legacy workflow`, 'i') })
  await fireEvent.keyDown(entry, { key: 'Enter' })
  await waitFor(() => {
    const session = $documentSession.get()
    expect(session.analysis?.definitionRevision).toBe(session.pair?.definition.revision)
    expect(session.analysis?.structurallyValid).toBe(true)
  })
  return rendered
}

async function expectYamlOnlySave(yaml: string, expectedNodes: number, expectedEdges: number): Promise<void> {
  expect($documentSession.get().pair?.definition.text).toBe(yaml)
  expect($documentSession.get().analysis?.issues.filter(({ blocking }) => blocking)).toEqual([])
  expect(screen.queryByRole('region', { name: 'Workflow graph' })).not.toBeInTheDocument()
  expect(screen.getByText(/visual canvas supports at most 250 nodes and 500 edges/)).toHaveAttribute('role', 'status')
  expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')

  const parsed = parse(yaml) as { nodes: { depends_on?: string[] }[] }
  expect(parsed.nodes).toHaveLength(expectedNodes)
  expect(parsed.nodes.reduce((count, node) => count + (node.depends_on?.length ?? 0), 0)).toBe(expectedEdges)

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))
  const saveOption = await screen.findByRole('option', { name: /Save Workflow Pair/i })
  expect(saveOption).toBeEnabled()
  const paletteSearch = screen.getByRole('combobox', { name: 'Search commands' })
  await fireEvent.keyDown(paletteSearch, {
    key: 's',
    ...(/mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }),
  })
  await waitFor(() => expect($documentWorkspace.get().saveOutcome?.status).toBe('saved'))
  expect($documentWorkspace.get().saveOutcome).toMatchObject({
    results: { definition: { status: 'unchanged' }, companion: null },
  })
  expect($documentSession.get().pair?.definition.text).toBe(yaml)
  expect(nativeHarness.writes).toEqual([])
}

describe('oversized workflow App boundary', () => {
  beforeAll(async () => {
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
    vi.stubGlobal('Worker', RealAnalysisWorker)
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    }
    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }),
      })
    }
    setNativeBridgeForTest({
      workspaceRead: async (relativePath) => ({
        relativePath,
        text: nativeHarness.yaml,
        sha256: 'a'.repeat(64),
        size: nativeHarness.yaml.length,
        modifiedAt: '2026-07-25T00:00:00.000Z',
        readOnly: false,
      }),
      workspaceWrite: async ({ relativePath, text }) => {
        nativeHarness.writes.push(text)
        return { relativePath, sha256: 'b'.repeat(64), size: text.length, modifiedAt: 'now' }
      },
    })
    App = (await import('$src/app/App.svelte')).default
  }, 30_000)

  afterEach(() => {
    clearCanvasState()
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    closeCommandPalette()
    closeKeyboardShortcuts()
    showEditorMode('visual')
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
  })

  afterAll(() => setNativeBridgeForTest(undefined))

  it('preserves a structurally valid 251-node workflow in saveable YAML-only mode', async () => {
    const yaml = nodeOverflowYaml()
    const rendered = await openOversizedWorkflow(yaml, 'node-overflow.yaml')
    await expectYamlOnlySave(yaml, 251, 0)
    rendered.unmount()
  }, 20_000)

  it('preserves a structurally valid 501-edge DAG in saveable YAML-only mode', async () => {
    const yaml = edgeOverflowYaml()
    const rendered = await openOversizedWorkflow(yaml, 'edge-overflow.yaml')
    await expectYamlOnlySave(yaml, 33, 501)
    rendered.unmount()
  }, 20_000)
})
