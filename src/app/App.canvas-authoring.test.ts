import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { parse } from 'yaml'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'

const nativeWindow = vi.hoisted(() => ({
  unlistenClose: vi.fn(),
  unlistenDrop: vi.fn(),
  onCloseRequested: vi.fn(async () => nativeWindow.unlistenClose),
  onDragDropEvent: vi.fn(async () => nativeWindow.unlistenDrop),
  destroy: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }))

const digest = `sha256:${'c'.repeat(64)}` as const
const nodeField = (kind: 'command' | 'prompt', name: 'id' | 'depends_on' | 'command' | 'prompt') => ({
  id: `${kind}.node.${name}`,
  label: name === 'id' ? 'Node ID' : name === 'depends_on' ? 'Depends on' : name === 'command' ? 'Command' : 'Prompt',
  description: `Edit ${name}.`,
  field_path: `nodes[].${name}`,
  applicability: { profiles: ['hermes-legacy'] as const, documents: ['definition'] as const, node_kinds: [kind] },
  widget: name === 'depends_on' ? 'array' : name === 'command' ? 'code' : name === 'prompt' ? 'textarea' : 'text',
  section: name === 'depends_on' ? 'Execution' : 'General',
  order: name === 'id' ? 1 : name === 'depends_on' ? 3 : 2,
  status: 'supported' as const,
  examples: [name === 'depends_on' ? ['collect'] : name],
})
const contract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'hermes-legacy',
  normalizer_version: 1,
  contract_digest: digest,
  definition_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        title: 'Workflow name',
        description: 'Workflow name.',
        examples: ['Flow'],
        'x-hermes-widget': 'text',
        'x-hermes-section': 'General',
        'x-hermes-order': 1,
        'x-hermes-status': 'supported',
      },
      description: {
        type: 'string',
        title: 'Workflow description',
        description: 'Workflow description.',
        examples: ['App authoring'],
        'x-hermes-widget': 'textarea',
        'x-hermes-section': 'General',
        'x-hermes-order': 2,
        'x-hermes-status': 'supported',
      },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            depends_on: { type: 'array', items: { type: 'string' } },
            command: { type: 'string' },
            prompt: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'description', 'nodes'],
    additionalProperties: false,
  },
  sidecar_schema: { type: 'object' },
  node_kinds: [
    {
      id: 'command',
      label: 'Command',
      description: 'Command node',
      field_path: 'nodes[].command',
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      widget: 'text',
      section: 'general',
      order: 1,
      status: 'supported',
      examples: [],
      fields: [nodeField('command', 'id'), nodeField('command', 'command'), nodeField('command', 'depends_on')],
    },
    {
      id: 'prompt',
      label: 'Prompt',
      description: 'Prompt node',
      field_path: 'nodes[].prompt',
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      widget: 'text',
      section: 'general',
      order: 2,
      status: 'supported',
      examples: [],
      fields: [nodeField('prompt', 'id'), nodeField('prompt', 'prompt'), nodeField('prompt', 'depends_on')],
    },
  ],
  semantic_rules: [
    {
      id: 'workflow-dag-v1',
      label: 'DAG',
      description: 'Graph fields',
      field_paths: ['nodes'],
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      status: 'supported',
      parameters: { nodes_path: 'nodes', id_field: 'id', dependencies_field: 'depends_on' },
      examples: [],
    },
  ],
  compatibility_codes: {},
  documentation: { topics: [], examples: [] },
  limits: { max_document_bytes: 2 * 1024 * 1024 },
  extensions: {},
}

vi.mock('$src/lib/contract/bundled-contracts', () => ({
  loadBundledAuthoringContracts: () => Promise.resolve([contract]),
}))

import { executeCommand } from '$src/lib/commands/registry'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
} from '$src/stores/documents'
import { $activeLayout as activeLayoutStore, clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import { clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import { createHistoryState, historyStore } from '$src/stores/history'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import App from './App.svelte'

const source = `name: Flow
description: App authoring
nodes:
  - id: collect
    command: collect
  - id: review
    prompt: review
`

function projection(text = source) {
  const definition = parse(text) as { name: string; description: string; nodes: Record<string, unknown>[] }
  const nodes = definition.nodes.map((node, index) => {
    const kind = Object.hasOwn(node, 'command') ? 'command' : 'prompt'
    return {
      id: String(node.id),
      kind,
      value: node[kind],
      dependsOn: Array.isArray(node.depends_on) ? (node.depends_on as string[]) : [],
      options: {},
      source: { path: `/nodes/${index}`, start: index * 10, end: index * 10 + 9 },
    }
  })
  return {
    name: definition.name,
    description: definition.description,
    profile: 'hermes-legacy' as const,
    nodes,
    edges: nodes.flatMap((node) =>
      node.dependsOn.map((dependency) => ({
        id: `dependency:${dependency}->${node.id}`,
        source: dependency,
        target: node.id,
      })),
    ),
    definition,
    companion: null,
  }
}

async function renderAuthoringApp() {
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
        text: source,
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    },
    digest,
  )
  const revision = $documentSession.get().revision!
  receiveDocumentAnalysis({ ...revision, structurallyValid: true, issues: [], projection: projection() })
  setActiveLayout({
    schemaVersion: 1,
    workspaceId: 'workspace',
    workflowPath: 'flow.yaml',
    nodePositions: { collect: { x: 0, y: 0 }, review: { x: 320, y: 0 } },
    viewport: { x: 0, y: 0, zoom: 1 },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-07-25T00:00:00.000Z',
  })
  const rendered = render(App)
  await screen.findByRole('region', { name: 'Workflow graph' })
  return rendered
}

describe('App canvas authoring composition', () => {
  beforeAll(() => {
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
  })

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    setNativeBridgeForTest(undefined)
    vi.clearAllMocks()
    clearCanvasState()
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    historyStore.set(createHistoryState())
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
  })

  it('adds, connects, and duplicates through the production YAML transaction path', async () => {
    let rendered = await renderAuthoringApp()
    await fireEvent.click(screen.getByRole('button', { name: 'Add node' }))
    await fireEvent.click(screen.getByRole('option', { name: /command/i }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: command'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()

    historyStore.set(createHistoryState())
    rendered = await renderAuthoringApp()
    await fireEvent(
      screen.getByRole('region', { name: 'Workflow graph' }),
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'collect', target: 'review' } }),
    )
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('depends_on:\n      - collect'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()

    historyStore.set(createHistoryState())
    rendered = await renderAuthoringApp()
    setCanvasSelection(['collect'])
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: collect-2'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()
  })

  it('keeps deletion side-effect free on cancel and commits only after confirmation', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['collect'])
    const before = $documentSession.get().pair?.definition.text
    await fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect($documentSession.get().pair?.definition.text).toBe(before)
    expect(historyStore.get().undo).toHaveLength(0)

    await fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete nodes' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).not.toContain('id: collect'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()
  })

  it('unbinds canvas command handlers when the application unmounts', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['collect'])
    const before = $documentSession.get().pair?.definition.text
    rendered.unmount()

    await executeCommand('canvas.duplicate-selection', { surface: 'canvas', canMutate: true, hasSelection: true })
    expect($documentSession.get().pair?.definition.text).toBe(before)
    expect(historyStore.get().undo).toHaveLength(0)
  })

  it('surfaces one polite canvas rejection without a duplicate assertive alert', async () => {
    const rendered = await renderAuthoringApp()

    await fireEvent(
      screen.getByRole('region', { name: 'Workflow graph' }),
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'collect', target: 'collect' } }),
    )

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveTextContent(
        'A node cannot depend on itself.',
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByText('A node cannot depend on itself.')).toHaveLength(1)
    rendered.unmount()
  })

  it('commits an explicit inspector edit as one form history transaction and never commits selection drafts', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['review'])
    const prompt = await screen.findByRole('textbox', { name: 'Prompt' })

    await fireEvent.input(prompt, { target: { value: 'edited in inspector' } })
    setCanvasSelection(['collect'])
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Command' })).toHaveValue('collect'))
    expect($documentSession.get().pair?.definition.text).toBe(source)
    expect(historyStore.get().undo).toHaveLength(0)

    setCanvasSelection(['review'])
    const currentPrompt = await screen.findByRole('textbox', { name: 'Prompt' })
    await fireEvent.input(currentPrompt, { target: { value: 'edited in inspector' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Prompt' }))

    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('prompt: edited in inspector'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()
  })

  it('edits workflow fields with no node selection and migrates layout on an inspector ID rename', async () => {
    let rendered = await renderAuthoringApp()
    const workflowName = await screen.findByRole('textbox', { name: /workflow name.*required/i })
    expect(workflowName).toHaveValue('Flow')
    await fireEvent.input(workflowName, { target: { value: 'Renamed Flow' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Workflow name' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('name: Renamed Flow'))
    rendered.unmount()

    historyStore.set(createHistoryState())
    rendered = await renderAuthoringApp()
    setCanvasSelection(['review'])
    const id = await screen.findByRole('textbox', { name: /node id.*required/i })
    await fireEvent.input(id, { target: { value: 'reviewed' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Node ID' }))

    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: reviewed'))
    await waitFor(() => expect(activeLayoutStore.get()?.nodePositions.reviewed).toEqual({ x: 320, y: 0 }))
    expect(activeLayoutStore.get()?.nodePositions.review).toBeUndefined()
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()
  })

  it('disables inspector mutation for stale projections and read-only workflow entries', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['review'])
    expect(await screen.findByRole('textbox', { name: 'Prompt' })).toBeEnabled()

    receiveDocumentAnalysis({ ...$documentSession.get().revision!, structurallyValid: false, issues: [] })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeDisabled())
    expect(screen.getByText('The YAML projection is stale.')).toBeVisible()

    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      structurallyValid: true,
      issues: [],
      projection: projection(),
    })
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'flow.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: true },
    ])
    setCanvasSelection(['review'])
    await waitFor(() => expect(screen.getByText('This workflow is read-only.')).toBeVisible())
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeDisabled()
    rendered.unmount()
  })

  it('composes native lifecycle cleanup with canvas command cleanup exactly once', async () => {
    setNativeBridgeForTest(createBrowserBridge())
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const rendered = await renderAuthoringApp()
    await waitFor(() => expect(nativeWindow.onDragDropEvent).toHaveBeenCalledOnce())
    setCanvasSelection(['collect'])
    const before = $documentSession.get().pair?.definition.text

    rendered.unmount()
    await executeCommand('canvas.duplicate-selection', { surface: 'canvas', canMutate: true, hasSelection: true })

    expect($documentSession.get().pair?.definition.text).toBe(before)
    expect(nativeWindow.unlistenClose).toHaveBeenCalledOnce()
    expect(nativeWindow.unlistenDrop).toHaveBeenCalledOnce()
  })
})
