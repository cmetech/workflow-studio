import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import archonContractJson from '../../contracts/archon-2026-07-v6.json'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import * as placement from '$src/lib/layout/place-new-nodes'
import { enterLoopGroup, returnToRoot } from '$src/stores/canvas-scope'
import { updateScopeLayout } from '$src/stores/layout'
import { createEditorMetricsCollector, installEditorMetrics } from '$src/lib/metrics/editor-metrics'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { emptyScopeLayout } from '$src/lib/layout/types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { parse } from 'yaml'
import { tick } from 'svelte'
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
const promptNestedFields = [
  {
    id: 'prompt.node.retry',
    label: 'Retry',
    description: 'Retry settings.',
    field_path: 'nodes[].retry',
    applicability: {
      profiles: ['hermes-legacy'] as const,
      documents: ['definition'] as const,
      node_kinds: ['prompt'],
    },
    widget: 'object',
    section: 'Execution',
    order: 4,
    status: 'supported' as const,
    examples: [{ max_attempts: 2 }],
  },
  {
    id: 'prompt.node.retry.max_attempts',
    label: 'Max attempts',
    description: 'Retry attempts.',
    field_path: 'nodes[].retry.max_attempts',
    applicability: {
      profiles: ['hermes-legacy'] as const,
      documents: ['definition'] as const,
      node_kinds: ['prompt'],
    },
    widget: 'number',
    section: 'Execution',
    order: 5,
    status: 'supported' as const,
    examples: [2],
  },
  {
    id: 'prompt.node.agents',
    label: 'Agents',
    description: 'Agent settings.',
    field_path: 'nodes[].agents',
    applicability: {
      profiles: ['hermes-legacy'] as const,
      documents: ['definition'] as const,
      node_kinds: ['prompt'],
    },
    widget: 'object',
    section: 'Advanced',
    order: 6,
    status: 'supported' as const,
    examples: [{ reviewer: { description: 'Review.' } }],
  },
  {
    id: 'prompt.node.agents.description',
    label: 'Description',
    description: 'Agent description.',
    field_path: 'nodes[].agents.*.description',
    applicability: {
      profiles: ['hermes-legacy'] as const,
      documents: ['definition'] as const,
      node_kinds: ['prompt'],
    },
    widget: 'textarea',
    section: 'Advanced',
    order: 7,
    status: 'supported' as const,
    examples: ['Review.'],
  },
]
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
            retry: {
              type: 'object',
              properties: { max_attempts: { type: 'integer', minimum: 1, maximum: 10, title: 'Max attempts' } },
              required: ['max_attempts'],
            },
            agents: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: { description: { type: 'string', minLength: 1, title: 'Description' } },
                required: ['description'],
              },
            },
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
      fields: [
        nodeField('prompt', 'id'),
        nodeField('prompt', 'prompt'),
        nodeField('prompt', 'depends_on'),
        ...promptNestedFields,
      ],
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
  documentation: { topics: [{ field_paths: ['name', 'description', 'nodes'] } as never], examples: [] },
  limits: { max_document_bytes: 2 * 1024 * 1024 },
  extensions: {},
}

let additionalContract: AuthoringContract | undefined
vi.mock('$src/lib/contract/bundled-contracts', () => ({
  loadBundledAuthoringContracts: () =>
    Promise.resolve(additionalContract ? [contract, additionalContract] : [contract]),
}))

import { createCommandRegistry, executeCommand, listCommands, type CommandRegistry } from '$src/lib/commands/registry'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  receiveDocumentAnalysis,
  updateDocumentSession,
} from '$src/stores/documents'
import { $activeLayout as activeLayoutStore, clearActiveLayout, setActiveLayout } from '$src/stores/layout'
import { $canvasPositions, $canvasSelection, clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import { createHistoryState, historyStore } from '$src/stores/history'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import {
  closeCommandPalette,
  closeKeyboardShortcuts,
  showActivity,
  showEditorMode,
  showYamlDocument,
} from '$src/stores/shell'
import { NODE_KIND_DRAG_TYPE } from '$src/features/canvas/node-kind-options'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from '$src/workers/document-worker'
import App from './App.svelte'

class InlineDocumentWorker {
  private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()
  private readonly cache = createDocumentWorkerCache()

  postMessage(message: DocumentWorkerRequest): void {
    void processDocumentWorkerRequest(message, this.cache).then((response) => {
      for (const listener of this.listeners) listener({ data: response } as MessageEvent<DocumentWorkerResponse>)
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

const source = `name: Flow
description: App authoring
nodes:
  - id: collect
    command: collect
  - id: review
    prompt: review
    retry:
      max_attempts: 2
    agents:
      reviewer:
        description: Review the result.
`

interface AuthoringAppOptions {
  readonly text?: string
  readonly companionText?: string
  readonly scopeContract?: AuthoringContract
  readonly readOnly?: boolean
  readonly missingEntry?: boolean
  readonly commandSurface?: CommandRegistry
}

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
    graphs: [
      {
        scope: { key: 'root', kind: 'root', workflow: { name: definition.name, profile: 'hermes-legacy' as const } },
        editorNodePrefix: '',
        sourcePath: ['nodes'],
        sourceRange: { start: 0, end: text.length },
        nodes,
        edges: nodes.flatMap((node) =>
          node.dependsOn.map((dependency) => ({
            id: `dependency:${dependency}->${node.id}`,
            source: dependency,
            target: node.id,
          })),
        ),
        definitionOrder: nodes.map(({ id }) => id),
        outerInputs: [],
        issues: [],
        capacity: {
          status: 'visual' as const,
          nodeCount: nodes.length,
          edgeCount: nodes.flatMap((node) => node.dependsOn).length,
        },
      },
    ],
    definition,
  }
}

async function renderAuthoringApp(options: AuthoringAppOptions = {}) {
  const text = options.text ?? source
  loadWorkspaceEntries(
    'workspace',
    'Workspace',
    options.missingEntry
      ? []
      : [
          {
            relativePath: 'flow.yaml',
            kind: 'file',
            size: 1,
            modifiedAt: '0',
            symlink: 'none',
            readOnly: options.readOnly ?? false,
          },
        ],
  )
  openDocumentSession(
    {
      workflowId: 'workflow:workspace:flow.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'workflow:workspace:flow.yaml:definition',
        kind: 'definition',
        path: 'flow.yaml',
        text,
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: options.companionText
        ? {
            id: 'workflow:workspace:flow.yaml:companion',
            kind: 'companion',
            path: 'flow.hermes.yaml',
            text: options.companionText,
            revision: 0,
            savedRevision: 0,
            diskHash: 'b'.repeat(64),
          }
        : null,
    },
    options.scopeContract?.contract_digest ?? digest,
  )
  const revision = $documentSession.get().revision!
  const scopedPair = $documentSession.get().pair!
  const scopedAnalysis = options.scopeContract
    ? await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: 'scope-fixture',
          workflowId: scopedPair.workflowId,
          pairGeneration: scopedPair.generation,
          definition: scopedPair.definition,
          companion: scopedPair.companion,
          profile: options.scopeContract.profile,
          contractDigest: options.scopeContract.contract_digest,
          reason: 'open',
        },
        options.scopeContract,
      )
    : undefined
  if (scopedAnalysis) expect(scopedAnalysis.structurallyValid, JSON.stringify(scopedAnalysis.issues)).toBe(true)
  const currentProjection = scopedAnalysis ? (scopedAnalysis.projection as WorkflowProjection) : projection(text)
  receiveDocumentAnalysis(
    scopedAnalysis ?? { ...revision, structurallyValid: true, issues: [], projection: currentProjection },
  )
  if (options.missingEntry) {
    $documentWorkspace.set({
      ...$documentWorkspace.get(),
      missingChange: { kind: 'remove', paths: ['flow.yaml'], dirty: false },
    })
  }
  setActiveLayout({
    schemaVersion: 2,
    workspaceId: 'workspace',
    workflowPath: 'flow.yaml',
    activeScopeKey: 'root',
    scopeLayouts: {
      root: {
        ...emptyScopeLayout(),
        nodePositions: Object.fromEntries(
          currentProjection.graphs[0]!.nodes.map(({ id }, index) => [id, { x: index * 320, y: 0 }]),
        ),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-07-25T00:00:00.000Z',
  })
  const rendered = options.commandSurface
    ? render(App, { props: { commandSurface: options.commandSurface } } as never)
    : render(App)
  await screen.findByRole('region', { name: 'Workflow graph' })
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'New Workflow' }).every((button) => !button.hasAttribute('disabled')),
    ).toBe(true),
  )
  await waitFor(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })
  closeCommandPalette()
  await tick()
  return rendered
}

describe('App canvas authoring composition', () => {
  beforeAll(() => {
    vi.stubGlobal('Worker', InlineDocumentWorker)
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
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    }
    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
      })
    }
  })

  afterEach(() => {
    additionalContract = undefined
    vi.restoreAllMocks()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    setNativeBridgeForTest(undefined)
    vi.clearAllMocks()
    clearCanvasState()
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    closeCommandPalette()
    closeKeyboardShortcuts()
    showEditorMode('visual')
    showActivity('explorer')
    showYamlDocument('definition')
    historyStore.set(createHistoryState())
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
  })

  it('restores a body canvas through root navigation and a Settings page without heavy scope-switch work', async () => {
    const loadedContract = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(archonContractJson)), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loadedContract.ok) throw new Error('Bundled Archon contract did not activate')
    additionalContract = loadedContract.contract
    const rendered = await renderAuthoringApp({
      scopeContract: additionalContract,
      text: 'name: Scoped\ndescription: Scope restoration\nnodes:\n  - id: repeat\n    loop_group:\n      until: "false"\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo child\n',
      companionText: 'language_compatibility: archon-2026-07\n',
    })
    updateScopeLayout('loop-group:repeat', (scope) => ({
      ...scope,
      viewport: { x: 27, y: -13, zoom: 1.4 },
      selectedNodeIds: ['child'],
      focusTarget: { kind: 'node', nodeId: 'child' },
      inspector: { tab: 'Advanced', scrollTop: 42 },
      canvasScroll: { left: 11, top: 22 },
    }))
    const body = activeLayoutStore.get()!.scopeLayouts['loop-group:repeat']
    const pair = $documentSession.get().pair
    const layoutWork = vi.spyOn(placement, 'reconcileLayout')
    const metrics = createEditorMetricsCollector()
    const restoreMetrics = installEditorMetrics(metrics)
    try {
      expect(enterLoopGroup('repeat')).toBe(true)
      await tick()
      await waitFor(() => expect(rendered.container.querySelector('.svelte-flow__node[data-id="child"]')).toBeVisible())
      expect(rendered.container.querySelector('.svelte-flow__node[data-id="repeat"]')).toBeNull()
      expect($canvasSelection.get()).toEqual(['child'])
      expect(layoutWork).not.toHaveBeenCalled()
      expect(metrics.snapshot()).toMatchObject({
        parseRequests: 0,
        validationPasses: 0,
        layouts: 0,
        yamlTransactions: 0,
        nativeCalls: 0,
        gitCalls: 0,
        layoutSaves: 0,
      })
      showActivity('settings')
      await screen.findByRole('region', { name: 'Settings' })
      await fireEvent.click(screen.getByRole('button', { name: 'Back to Workflow' }))
      expect($canvasSelection.get()).toEqual(['child'])
      expect(activeLayoutStore.get()!.scopeLayouts['loop-group:repeat']).toEqual(body)
      returnToRoot()
      await tick()
      enterLoopGroup('repeat')
      await tick()
      expect(activeLayoutStore.get()!.scopeLayouts['loop-group:repeat']).toEqual(body)
      expect($documentSession.get().pair).toBe(pair)
    } finally {
      restoreMetrics()
      rendered.unmount()
    }
  })

  it('drills into one loop-body canvas, preserves child selection for group settings, and restores root focus', async () => {
    const loadedContract = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(archonContractJson)), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loadedContract.ok) throw new Error('Bundled Archon contract did not activate')
    additionalContract = loadedContract.contract
    const rendered = await renderAuthoringApp({
      scopeContract: additionalContract,
      text: 'name: Scoped\ndescription: Drill in\nnodes:\n  - id: repeat\n    loop_group:\n      until: "false"\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo child\n',
      companionText: 'language_compatibility: archon-2026-07\n',
    })

    expect(rendered.container.querySelectorAll('.svelte-flow')).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'Open loop body' }))
    const heading = await screen.findByRole('heading', { name: 'Scoped / repeat loop body' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(rendered.container.querySelectorAll('.svelte-flow')).toHaveLength(1)
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="child"]')).toBeVisible()
    expect(rendered.container.querySelector('.svelte-flow__node[data-id="repeat"]')).toBeNull()

    setCanvasSelection(['child'])
    await tick()
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Group Settings' }))
    expect($canvasSelection.get()).toEqual(['child'])
    expect(screen.getByText('repeat', { selector: '.inspector strong' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus()

    await fireEvent.click(screen.getByRole('button', { name: 'Back to root workflow' }))
    await waitFor(() => expect(rendered.container.querySelector('.svelte-flow__node[data-id="repeat"]')).toHaveFocus())
    expect(rendered.container.querySelectorAll('.svelte-flow')).toHaveLength(1)
    rendered.unmount()
  })

  it('keeps a capacity-limited body YAML-only while the supported root remains visual', async () => {
    const rendered = await renderAuthoringApp()
    const current = projection()
    const groupNode = {
      ...current.graphs[0]!.nodes[0]!,
      id: 'repeat',
      kind: 'loop_group',
      value: { max_iterations: 2, nodes: [] },
    }
    const root = {
      ...current.graphs[0]!,
      nodes: [groupNode],
      edges: [],
      definitionOrder: ['repeat'],
      capacity: { status: 'visual' as const, nodeCount: 1, edgeCount: 0 },
    }
    const body = {
      ...current.graphs[0]!,
      scope: {
        key: 'loop-group:repeat' as const,
        kind: 'loop-group' as const,
        groupId: 'repeat',
        workflow: current.graphs[0]!.scope.workflow,
      },
      nodes: [],
      edges: [],
      definitionOrder: [],
      primarySinkId: undefined,
      sourcePath: ['nodes', 0, 'loop_group', 'nodes'],
      capacity: { status: 'yaml-only' as const, nodeCount: 251, edgeCount: 0 },
    }
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      structurallyValid: true,
      issues: [],
      projection: { ...current, graphs: [root, body] },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open loop body' })).toBeVisible())
    await fireEvent.click(screen.getByRole('button', { name: 'Open loop body' }))

    expect(await screen.findByText(/this loop body is preserved.*yaml-only.*250 nodes.*500 edges/i)).toBeVisible()
    expect(rendered.container.querySelector('.svelte-flow')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Back to root workflow' }))
    await waitFor(() => expect(rendered.container.querySelector('.svelte-flow')).toBeVisible())
    rendered.unmount()
  })

  it('lets canvas gestures and overlays consume Escape before body Back', async () => {
    const loadedContract = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(archonContractJson)), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loadedContract.ok) throw new Error('Bundled Archon contract did not activate')
    additionalContract = loadedContract.contract
    const rendered = await renderAuthoringApp({
      scopeContract: additionalContract,
      text: 'name: Scoped\ndescription: Escape order\nnodes:\n  - id: repeat\n    loop_group:\n      until: "false"\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo child\n',
      companionText: 'language_compatibility: archon-2026-07\n',
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Open loop body' }))
    const canvas = await screen.findByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['child'])
    canvas.focus()

    await fireEvent.keyDown(canvas, { key: 'e' })
    expect(screen.getByText(/create edge from child/i)).toBeVisible()
    await fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(activeLayoutStore.get()?.activeScopeKey).toBe('loop-group:repeat')
    expect(screen.queryByText(/create edge from child/i)).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Add Node' }))
    expect(screen.getByRole('dialog', { name: 'Add node' })).toBeVisible()
    await fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add node' }), { key: 'Escape' })
    expect(activeLayoutStore.get()?.activeScopeKey).toBe('loop-group:repeat')
    expect(screen.queryByRole('dialog', { name: 'Add node' })).not.toBeInTheDocument()

    await fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(activeLayoutStore.get()?.activeScopeKey).toBe('loop-group:repeat')
    expect($canvasSelection.get()).toEqual([])
    await fireEvent.keyDown(canvas, { key: 'Escape' })
    await waitFor(() => expect(activeLayoutStore.get()?.activeScopeKey).toBe('root'))
    expect(historyStore.get().undo).toHaveLength(0)
    rendered.unmount()
  })

  it('renders the exact empty-body repair UI without inventing values and keeps save blocked', async () => {
    const loadedContract = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(archonContractJson)), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loadedContract.ok) throw new Error('Bundled Archon contract did not activate')
    additionalContract = loadedContract.contract
    const rendered = await renderAuthoringApp({
      scopeContract: additionalContract,
      text: 'name: Scoped\ndescription: Empty repair\nnodes:\n  - id: repeat\n    loop_group:\n      until: "false"\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo child\n',
      companionText: 'language_compatibility: archon-2026-07\n',
    })
    const session = $documentSession.get()
    const current = session.analysis!.projection as WorkflowProjection
    const body = current.graphs.find(({ scope }) => scope.key === 'loop-group:repeat')!
    const emptyProjection: WorkflowProjection = {
      ...current,
      graphs: current.graphs.map((graph) => {
        if (graph !== body) return graph
        const { primarySinkId, ...bodyWithoutPrimarySink } = graph
        void primarySinkId
        return {
          ...bodyWithoutPrimarySink,
          nodes: [],
          edges: [],
          definitionOrder: [],
          capacity: { status: 'visual', nodeCount: 0, edgeCount: 0 },
        }
      }),
    }
    const authored = session.pair!.definition.text.replace('        - id: child\n          bash: echo child\n', '')
    updateDocumentSession(
      { ...session.pair!, definition: { ...session.pair!.definition, text: authored, revision: 1 } },
      additionalContract.contract_digest,
    )
    const referenceIndex = session.analysis?.referenceIndex
    if (!referenceIndex) throw new Error('The reader-v3 fixture did not publish a reference index')
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      structurallyValid: false,
      visuallyAuthorable: true,
      referenceIndex,
      issues: [
        {
          code: 'schema_required',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'A body node is required.',
          document: 'definition',
          scopeKey: 'loop-group:repeat',
          groupId: 'repeat',
          path: '/nodes/0/loop_group/nodes',
        },
      ],
      projection: emptyProjection,
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open loop body' })).toBeVisible())
    await fireEvent.click(screen.getByRole('button', { name: 'Open loop body' }))

    expect(await screen.findByRole('region', { name: 'Empty loop body for repeat' })).toBeVisible()
    expect(screen.getByText('nodes: []')).toBeVisible()
    expect(screen.getByText(/save and export remain blocked/i)).toBeVisible()
    expect($documentSession.get().pair?.definition.text).toBe(authored)
    expect($documentSession.get().analysis?.structurallyValid).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: 'Add First Node' }))
    expect(screen.getByRole('dialog', { name: 'Add node' })).toBeVisible()
    expect($documentSession.get().pair?.definition.text).toBe(authored)
    rendered.unmount()
  })

  it('records body and root edits in the one document undo history while navigation records none', async () => {
    const loadedContract = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(archonContractJson)), {
      kind: 'bundled',
      identifier: 'archon-2026-07-v6.json',
    })
    if (!loadedContract.ok) throw new Error('Bundled Archon contract did not activate')
    additionalContract = loadedContract.contract
    const rendered = await renderAuthoringApp({
      scopeContract: additionalContract,
      text: 'name: Scoped\ndescription: Shared history\nnodes:\n  - id: repeat\n    loop_group:\n      until: "false"\n      max_iterations: 2\n      nodes:\n        - id: child\n          bash: echo child\n        - id: publish\n          bash: echo publish\n  - id: tail\n    bash: echo tail\n',
      companionText: 'language_compatibility: archon-2026-07\n',
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Open loop body' }))
    expect(historyStore.get().undo).toHaveLength(0)
    await fireEvent(
      screen.getByRole('region', { name: 'Workflow graph' }),
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'child', target: 'publish' } }),
    )
    await waitFor(() => expect(historyStore.get().undo).toHaveLength(1))
    expect(parse($documentSession.get().pair!.definition.text)).toMatchObject({
      nodes: [{ loop_group: { nodes: [{ id: 'child' }, { id: 'publish', depends_on: ['child'] }] } }, { id: 'tail' }],
    })
    // This fixture opens the document store directly instead of through the workspace
    // controller. Republish the worker result that a real workspace session schedules
    // after the edit so the second action has the same current-analysis lease.
    const edited = $documentSession.get().pair!
    receiveDocumentAnalysis(
      await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: 'scope-after-body-edit',
          workflowId: edited.workflowId,
          pairGeneration: edited.generation,
          definition: edited.definition,
          companion: edited.companion,
          profile: additionalContract.profile,
          contractDigest: additionalContract.contract_digest,
          reason: 'edit',
        },
        additionalContract,
      ),
    )
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'bash node publish in loop group repeat' })).not.toHaveClass('stale'),
    )

    await fireEvent.click(screen.getByRole('button', { name: 'Back to root workflow' }))
    expect(historyStore.get().undo).toHaveLength(1)
    await fireEvent(
      screen.getByRole('region', { name: 'Workflow graph' }),
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'repeat', target: 'tail' } }),
    )
    await waitFor(() => expect(historyStore.get().undo).toHaveLength(2))
    expect(parse($documentSession.get().pair!.definition.text)).toMatchObject({
      nodes: [
        { id: 'repeat', loop_group: { nodes: [{ id: 'child' }, { id: 'publish', depends_on: ['child'] }] } },
        { id: 'tail', depends_on: ['repeat'] },
      ],
    })
    rendered.unmount()
  })

  it('adds, connects, and duplicates through the production YAML transaction path', async () => {
    let rendered = await renderAuthoringApp()
    await fireEvent.click(screen.getByRole('button', { name: 'Add Node' }))
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
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Selection' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: collect-2'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()
  })

  it('does not apply delayed-worker positions to a workflow activated after the YAML commit', async () => {
    class ControlledDocumentWorker {
      static pending: Array<() => Promise<void>> = []
      private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()
      private readonly cache = createDocumentWorkerCache()

      static async releaseAll(): Promise<void> {
        const pending = ControlledDocumentWorker.pending.splice(0)
        await Promise.all(pending.map((deliver) => deliver()))
      }

      postMessage(message: DocumentWorkerRequest): void {
        const deliver = async () => {
          const response = await processDocumentWorkerRequest(message, this.cache)
          for (const listener of this.listeners) {
            listener({ data: response } as MessageEvent<DocumentWorkerResponse>)
          }
        }
        if (message.type === 'analyze') ControlledDocumentWorker.pending.push(deliver)
        else void deliver()
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
    const originalWorker = globalThis.Worker
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledDocumentWorker })
    const rendered = await renderAuthoringApp()
    await ControlledDocumentWorker.releaseAll()
    const replacementPair = {
      workflowId: 'workflow:workspace:other.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'workflow:workspace:other.yaml:definition',
        kind: 'definition' as const,
        path: 'other.yaml',
        text: source,
        revision: 0,
        savedRevision: 0,
        diskHash: 'b'.repeat(64),
      },
      companion: null,
    }
    const replacementLayout = {
      schemaVersion: 2 as const,
      workspaceId: 'workspace',
      workflowPath: 'other.yaml',
      activeScopeKey: 'root' as const,
      scopeLayouts: {
        root: {
          ...emptyScopeLayout(),
          nodePositions: { collect: { x: 40, y: 40 }, review: { x: 360, y: 40 } },
          viewport: { x: 10, y: 20, zoom: 0.9 },
        },
      },
      panels: { left: 240, right: 300, problems: 160 },
      editorMode: 'visual' as const,
      updatedAt: '2026-08-30T00:00:00.000Z',
    }
    let replaced = false
    const unsubscribe = $documentSession.subscribe((session) => {
      if (replaced || !session.pair?.definition.text.includes('id: command')) return
      replaced = true
      openDocumentSession(replacementPair, digest)
      setActiveLayout(replacementLayout)
    })

    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Add Node' }))
      await fireEvent.click(screen.getByRole('option', { name: /command/i }))
      await waitFor(() => expect(ControlledDocumentWorker.pending.length).toBeGreaterThan(0))
      expect(replaced).toBe(false)
      await ControlledDocumentWorker.releaseAll()
      await waitFor(() => expect(replaced).toBe(true))
      await tick()

      expect($documentSession.get().pair).toBe(replacementPair)
      expect(activeLayoutStore.get()).toEqual(replacementLayout)
      expect(activeLayoutStore.get()?.scopeLayouts.root.nodePositions.command).toBeUndefined()
    } finally {
      unsubscribe()
      rendered.unmount()
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
    }
  })

  it('preserves newer same-workflow layout state when delayed analysis commits node positions', async () => {
    class ControlledDocumentWorker {
      static pending: Array<() => Promise<void>> = []
      private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()
      private readonly cache = createDocumentWorkerCache()

      static async releaseAll(): Promise<void> {
        const pending = ControlledDocumentWorker.pending.splice(0)
        await Promise.all(pending.map((deliver) => deliver()))
      }

      postMessage(message: DocumentWorkerRequest): void {
        const deliver = async () => {
          const response = await processDocumentWorkerRequest(message, this.cache)
          for (const listener of this.listeners) {
            listener({ data: response } as MessageEvent<DocumentWorkerResponse>)
          }
        }
        if (message.type === 'analyze') ControlledDocumentWorker.pending.push(deliver)
        else void deliver()
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
    const originalWorker = globalThis.Worker
    const bridge = createBrowserBridge()
    setNativeBridgeForTest(bridge)
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledDocumentWorker })
    const rendered = await renderAuthoringApp()
    await ControlledDocumentWorker.releaseAll()
    const concurrentLayout = {
      schemaVersion: 2 as const,
      workspaceId: 'workspace',
      workflowPath: 'flow.yaml',
      activeScopeKey: 'root' as const,
      scopeLayouts: {
        root: {
          ...emptyScopeLayout(),
          nodePositions: { collect: { x: 42, y: 84 }, review: { x: 512, y: 160 } },
          viewport: { x: 73, y: -41, zoom: 1.35 },
        },
      },
      panels: { left: 333, right: 377, problems: 211 },
      editorMode: 'split' as const,
      updatedAt: '2026-08-30T20:00:00.000Z',
    }

    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Add Node' }))
      await fireEvent.click(screen.getByRole('option', { name: /command/i }))
      await waitFor(() => expect(ControlledDocumentWorker.pending.length).toBeGreaterThan(0))
      showEditorMode('split')
      setActiveLayout(concurrentLayout)

      await ControlledDocumentWorker.releaseAll()
      await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: command'))
      await waitFor(() =>
        expect(activeLayoutStore.get()?.scopeLayouts.root.nodePositions.command).toEqual({ x: 0, y: 0 }),
      )

      const active = activeLayoutStore.get()!
      expect(active.scopeLayouts.root.nodePositions).toEqual({
        collect: { x: 42, y: 84 },
        review: { x: 512, y: 160 },
        command: { x: 0, y: 0 },
      })
      expect(active.scopeLayouts.root.viewport).toEqual({ x: 73, y: -41, zoom: 1.35 })
      expect(active.panels).toEqual({ left: 333, right: 377, problems: 211 })
      expect(active.editorMode).toBe('split')

      await waitFor(async () => expect(await bridge.layoutLoad()).not.toBeNull())
      const persisted = JSON.parse((await bridge.layoutLoad())!) as Array<{ layout: typeof active }>
      expect(persisted).toHaveLength(1)
      expect(persisted[0]?.layout).toEqual(active)
    } finally {
      rendered.unmount()
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
    }
  })

  it('keeps an incomplete projected node canvas-read-only while Inspector repairs it and valid analysis resumes authoring', async () => {
    const draftText = `${source}  - id: command\n    command: ""\n`
    const rendered = await renderAuthoringApp({ text: draftText })
    const revision = $documentSession.get().revision!
    receiveDocumentAnalysis({
      ...revision,
      structurallyValid: false,
      visuallyAuthorable: true,
      issues: [
        {
          code: 'schema_min_length',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Command must not be empty.',
          document: 'definition',
          nodeId: 'command',
        },
      ],
      projection: projection(draftText),
    })
    await tick()
    setCanvasSelection(['command'])
    await tick()

    expect(screen.getByLabelText('command node command')).toBeVisible()
    expect(screen.getByText(/current graph.*read-only/i)).toBeVisible()
    expect(screen.queryByText(/last valid graph/i)).not.toBeInTheDocument()
    const commandField = await screen.findByRole('textbox', { name: 'Command' })
    expect(commandField).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add Node' })).toBeDisabled()

    const canvas = screen.getByRole('region', { name: 'Workflow graph' })
    const layoutBeforeDrag = structuredClone(activeLayoutStore.get())
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragmove', {
        bubbles: true,
        detail: { id: 'command', position: { x: 720, y: 180 } },
      }),
    )
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'command', position: { x: 720, y: 180 } },
      }),
    )
    expect($canvasPositions.get().command).toEqual({ x: 640, y: 0 })
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(activeLayoutStore.get()).toEqual(layoutBeforeDrag)

    await fireEvent(
      canvas,
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'collect', target: 'command' } }),
    )
    expect($documentSession.get().pair?.definition.text).toBe(draftText)
    expect(historyStore.get().undo).toHaveLength(0)

    await fireEvent.input(commandField, { target: { value: '/review' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Command' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('command: "/review"'))

    const repairedText = $documentSession.get().pair!.definition.text
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      structurallyValid: true,
      issues: [],
      projection: projection(repairedText),
    })
    await waitFor(() => expect(screen.queryByText(/current graph.*read-only/i)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Node' })).toBeEnabled())

    await fireEvent(
      canvas,
      new CustomEvent('workflowconnect', { bubbles: true, detail: { source: 'collect', target: 'command' } }),
    )
    await waitFor(() =>
      expect($documentSession.get().pair?.definition.text).toContain(
        '  - id: command\n    command: "/review"\n    depends_on:\n      - collect\n',
      ),
    )
    expect(historyStore.get().undo).toHaveLength(2)
    rendered.unmount()
  })

  it('preserves Inspector state and reports worker analysis rejection without an unhandled promise', async () => {
    const rendered = await renderAuthoringApp()
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      setCanvasSelection(['collect'])
      await tick()
      const before = $documentSession.get()
      const commandField = await screen.findByRole('textbox', { name: 'Command' })
      await fireEvent.input(commandField, { target: { value: '/worker-failure' } })
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: undefined })

      await fireEvent.click(screen.getByRole('button', { name: 'Apply Command' }))
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(await screen.findByRole('alert')).toHaveTextContent('Document analysis worker is unavailable.')
      expect(unhandled).toEqual([])
      expect($documentSession.get().pair).toBe(before.pair)
      expect($documentSession.get().analysis).toBe(before.analysis)
      expect(historyStore.get().undo).toHaveLength(0)
      expect(commandField).toHaveValue('/worker-failure')
    } finally {
      process.off('unhandledRejection', onUnhandled)
      if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor)
      else Reflect.deleteProperty(globalThis, 'Worker')
      rendered.unmount()
    }
  })

  it('mounts the Nodes activity and authors one YAML transaction by click or exact-position HTML drop', async () => {
    showActivity('nodes')
    let rendered = await renderAuthoringApp()
    expect(screen.getByRole('heading', { name: 'Nodes' })).toBeVisible()
    expect(screen.getByRole('button', { name: /add command node/i })).toHaveTextContent('N C')

    await fireEvent.click(screen.getByRole('button', { name: /add command node/i }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: command'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()

    historyStore.set(createHistoryState())
    showActivity('nodes')
    rendered = await renderAuthoringApp()
    const canvasViewport = screen.getByRole('region', { name: 'Workflow canvas viewport' })
    vi.spyOn(canvasViewport, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
      toJSON: () => undefined,
    })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(drop, {
      clientX: { value: 500 },
      clientY: { value: 350 },
      dataTransfer: {
        value: { types: [NODE_KIND_DRAG_TYPE], getData: () => 'command' },
      },
    })
    await fireEvent(canvasViewport, drop)

    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: command'))
    expect(historyStore.get().undo).toHaveLength(1)
    await waitFor(() =>
      expect(activeLayoutStore.get()?.scopeLayouts.root.nodePositions.command).toEqual({ x: 400, y: 300 }),
    )
    rendered.unmount()
  })

  it('fails the Nodes activity closed for read-only, stale, unavailable-contract, and over-capacity states', async () => {
    showActivity('nodes')
    let rendered = await renderAuthoringApp({ readOnly: true })
    let palette = within(screen.getByLabelText('Workspace panel'))
    expect(palette.getByText(/read-only/)).toBeVisible()
    expect(palette.getByRole('button', { name: /command node.*read-only/i })).toBeDisabled()
    rendered.unmount()

    showActivity('nodes')
    rendered = await renderAuthoringApp()
    receiveDocumentAnalysis({ ...$documentSession.get().revision!, structurallyValid: false, issues: [] })
    palette = within(screen.getByLabelText('Workspace panel'))
    await waitFor(() => expect(palette.getByText(/projection is stale/)).toBeVisible())
    expect(palette.getByRole('button', { name: /command node.*stale/i })).toBeDisabled()

    const pair = $documentSession.get().pair!
    updateDocumentSession(pair, `sha256:${'d'.repeat(64)}`)
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      structurallyValid: true,
      issues: [],
      projection: projection(),
    })
    await waitFor(() => expect(palette.getByText(/authoring contract is unavailable/)).toBeVisible())
    expect(palette.queryByRole('button', { name: /add command node/i })).not.toBeInTheDocument()

    updateDocumentSession(pair, digest)
    const crowded = projection()
    receiveDocumentAnalysis({
      ...$documentSession.get().revision!,
      structurallyValid: true,
      issues: [],
      projection: {
        ...crowded,
        graphs: [
          {
            ...crowded.graphs[0]!,
            nodes: Array.from({ length: 251 }, (_, index) => ({
              ...crowded.graphs[0]!.nodes[0]!,
              id: `node-${index}`,
              source: { path: `/nodes/${index}`, start: index, end: index + 1 },
            })),
            edges: [],
            definitionOrder: Array.from({ length: 251 }, (_, index) => `node-${index}`),
            capacity: { status: 'yaml-only', nodeCount: 251, edgeCount: 0 },
          },
        ],
      },
    })
    await waitFor(() => expect(palette.getByText(/at most 250 nodes/)).toBeVisible())
    expect(palette.getByRole('button', { name: /command node.*250 nodes/i })).toBeDisabled()
    rendered.unmount()
  })

  it('duplicates from a canvas keydown and exposes command collisions without changing YAML', async () => {
    let rendered = await renderAuthoringApp()
    const canvas = screen.getByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['collect'])
    canvas.focus()
    await fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true })
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('id: collect-2'))
    rendered.unmount()

    historyStore.set(createHistoryState())
    const registry = createCommandRegistry()
    for (const command of listCommands()) registry.registerCommand(command)
    registry.registerCommand({
      id: 'canvas.shadow-duplicate',
      label: 'Shadow Duplicate',
      category: 'Canvas',
      defaultBindings: ['Mod+D'],
      enabled: (context) => context.surface === 'canvas' && context.canMutate && context.hasSelection,
      run: () => undefined,
    })
    rendered = await renderAuthoringApp({ commandSurface: registry })
    const collidingCanvas = screen.getByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['collect'])
    collidingCanvas.focus()
    const before = $documentSession.get().pair?.definition.text
    await fireEvent.keyDown(collidingCanvas, { key: 'd', ctrlKey: true })

    expect(await screen.findByText(/shortcut collision.*duplicate selection.*shadow duplicate/i)).toHaveAttribute(
      'role',
      'alert',
    )
    expect($documentSession.get().pair?.definition.text).toBe(before)
    expect(historyStore.get().undo).toHaveLength(0)
    rendered.unmount()
  })

  it('cancels a pending node chord when focus moves to an actual in-app control', async () => {
    const rendered = await renderAuthoringApp()
    const canvas = screen.getByRole('region', { name: 'Workflow graph' })
    canvas.focus()
    await fireEvent.keyDown(canvas, { key: 'n' })
    expect(screen.getByText(/choose kind within 1.5 seconds/i)).toBeVisible()

    screen.getByRole('button', { name: 'YAML' }).focus()
    await tick()

    expect(screen.queryByText(/choose kind within 1.5 seconds/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /add node/i })).not.toBeInTheDocument()
    rendered.unmount()
  })

  it('opens Find in the active definition and companion CodeMirror editors with visual palette fallback', async () => {
    const rendered = await renderAuthoringApp({
      companionText: 'language_compatibility: hermes-legacy\n',
    })
    const yamlMode = screen.getByRole('button', { name: 'YAML' })
    await fireEvent.click(yamlMode)
    await fireEvent.keyDown(yamlMode, { key: 'f', ctrlKey: true })
    const definitionPanel = screen.getByRole('tabpanel', { name: 'Definition YAML' })
    await waitFor(() => expect(definitionPanel.querySelector('.cm-search')).not.toBeNull())

    await fireEvent.click(screen.getByRole('tab', { name: 'Companion YAML' }))
    await fireEvent.keyDown(yamlMode, { key: 'f', ctrlKey: true })
    const companionPanel = screen.getByRole('tabpanel', { name: 'Companion YAML' })
    await waitFor(() => expect(companionPanel.querySelector('.cm-search')).not.toBeNull())

    await fireEvent.click(screen.getByRole('button', { name: 'Visual' }))
    const canvas = screen.getByRole('region', { name: 'Workflow graph' })
    canvas.focus()
    await fireEvent.keyDown(canvas, { key: 'f', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeVisible()
    rendered.unmount()
  })

  it('applies canonical fit, actual-size, nudge, and larger nudge keyboard effects', async () => {
    const rendered = await renderAuthoringApp()
    const canvas = screen.getByRole('region', { name: 'Workflow graph' })
    const canvasViewport = screen.getByRole('region', { name: 'Workflow canvas viewport' })
    const viewport = canvas.querySelector<HTMLElement>('.svelte-flow__viewport')!
    Object.defineProperties(canvasViewport, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 800 },
    })
    canvas.focus()

    await fireEvent.keyDown(canvas, { key: 'f' })
    await waitFor(() => expect(viewport.style.transform).toContain('scale(1.36986301369863)'))
    await fireEvent.keyDown(canvas, { key: '0' })
    await waitFor(() => expect(viewport.style.transform).toContain('scale(1)'))

    const collectNode = canvas.querySelector<HTMLElement>('.svelte-flow__node[data-id="collect"]')!
    const reviewNode = canvas.querySelector<HTMLElement>('.svelte-flow__node[data-id="review"]')!
    setCanvasSelection(['collect'])
    await tick()
    await fireEvent.keyDown(canvas, { key: 'f', shiftKey: true })
    await waitFor(() => expect(viewport.style.transform).toContain('scale(3.0303030303030303)'))
    await fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect($canvasPositions.get().collect).toEqual({ x: 5, y: 0 })
    expect($canvasPositions.get().review).toEqual({ x: 320, y: 0 })
    expect(collectNode.style.transform).toContain('translate(5px, 0px)')
    expect(reviewNode.style.transform).toContain('translate(320px, 0px)')
    expect(canvas.querySelector('.svelte-flow__node[data-id="review"]')).toBe(reviewNode)
    expect($canvasSelection.get()).toEqual(['collect'])
    setCanvasSelection(['collect', 'review'])
    await tick()
    await fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true })
    expect($canvasPositions.get().collect).toEqual({ x: 5, y: 20 })
    expect($canvasPositions.get().review).toEqual({ x: 320, y: 20 })
    await waitFor(() =>
      expect(activeLayoutStore.get()?.scopeLayouts.root.nodePositions.collect).toEqual({ x: 5, y: 20 }),
    )
    expect(canvas.querySelector('.svelte-flow__node[data-id="collect"]')).toBe(collectNode)
    expect(canvas.querySelector('.svelte-flow__node[data-id="review"]')).toBe(reviewNode)
    expect(collectNode.style.transform).toContain('translate(5px, 20px)')
    expect(reviewNode.style.transform).toContain('translate(320px, 20px)')
    expect($canvasSelection.get()).toEqual(['collect', 'review'])
    rendered.unmount()
  })

  it('focuses the inspector from the canvas keyboard command', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['collect'])
    const canvas = screen.getByRole('region', { name: 'Workflow graph' })
    canvas.focus()
    await fireEvent.keyDown(canvas, { key: 'Enter' })

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus())
    rendered.unmount()
  })

  it('traverses keyboard edge targets, commits through YAML, cancels, and announces invalid targets', async () => {
    const threeNodes = `${source}  - id: publish\n    command: publish\n`
    let rendered = await renderAuthoringApp({ text: threeNodes })
    let canvas = screen.getByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['collect'])
    canvas.focus()
    await fireEvent.keyDown(canvas, { key: 'e' })
    const targets = await screen.findByRole('listbox', { name: 'Valid edge targets' })
    expect(targets).toBeVisible()
    expect(screen.getByRole('option', { name: 'review' })).toHaveAttribute('aria-selected', 'true')
    await fireEvent.keyDown(canvas, { key: 'Tab' })
    expect(screen.getByRole('option', { name: 'publish' })).toHaveAttribute('aria-selected', 'true')
    await fireEvent.keyDown(canvas, { key: 'Enter' })
    await waitFor(() => {
      const yaml = parse($documentSession.get().pair!.definition.text) as { nodes: Record<string, unknown>[] }
      expect(yaml.nodes.find(({ id }) => id === 'publish')?.depends_on).toEqual(['collect'])
    })
    rendered.unmount()

    historyStore.set(createHistoryState())
    const noTargets = `name: Flow\ndescription: App authoring\nnodes:\n  - id: collect\n    command: collect\n  - id: review\n    prompt: review\n    depends_on:\n      - collect\n`
    rendered = await renderAuthoringApp({ text: noTargets })
    canvas = screen.getByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['review'])
    canvas.focus()
    const before = $documentSession.get().pair!.definition.text
    await fireEvent.keyDown(canvas, { key: 'e' })
    expect(screen.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveTextContent(
      /No valid dependency targets are available.*cycle/,
    )
    await fireEvent.keyDown(canvas, { key: 'Enter' })
    expect($documentSession.get().pair!.definition.text).toBe(before)
    await fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(screen.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveTextContent(
      'Edge creation cancelled.',
    )
    expect(screen.queryByRole('listbox', { name: 'Valid edge targets' })).not.toBeInTheDocument()
    rendered.unmount()
  })

  it('fails canvas mutations closed for read-only, missing-entry, and editable-target contexts', async () => {
    let rendered = await renderAuthoringApp({ readOnly: true })
    let canvas = screen.getByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['collect'])
    canvas.focus()
    const readOnlyText = $documentSession.get().pair!.definition.text
    await fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true })
    expect(await screen.findByText(/duplicate selection is unavailable/i)).toHaveAttribute('role', 'alert')
    expect($documentSession.get().pair!.definition.text).toBe(readOnlyText)
    rendered.unmount()

    rendered = await renderAuthoringApp({ missingEntry: true })
    canvas = screen.getByRole('region', { name: 'Workflow graph' })
    setCanvasSelection(['collect'])
    canvas.focus()
    const missingText = $documentSession.get().pair!.definition.text
    await fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true })
    expect(await screen.findByText(/duplicate selection is unavailable/i)).toHaveAttribute('role', 'alert')
    expect($documentSession.get().pair!.definition.text).toBe(missingText)
    rendered.unmount()

    rendered = await renderAuthoringApp()
    setCanvasSelection(['review'])
    const prompt = await screen.findByRole('textbox', { name: 'Prompt' })
    prompt.focus()
    const editableText = $documentSession.get().pair!.definition.text
    await fireEvent.keyDown(prompt, { key: 'n' })
    await fireEvent.keyDown(prompt, { key: 'd', ctrlKey: true })
    expect(screen.queryByText(/choose kind within 1.5 seconds/i)).not.toBeInTheDocument()
    expect($documentSession.get().pair!.definition.text).toBe(editableText)
    rendered.unmount()
  })

  it('schedules explicit validation for the current read-only revision without a text transaction', async () => {
    const workers: CapturingWorker[] = []
    class CapturingWorker {
      readonly messages: DocumentWorkerRequest[] = []
      private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()
      constructor() {
        workers.push(this)
      }
      postMessage(message: DocumentWorkerRequest): void {
        this.messages.push(structuredClone(message))
        if (message.type !== 'contract-register') return
        queueMicrotask(() => {
          for (const listener of this.listeners) {
            listener({
              data: {
                type: 'contract-registered',
                requestId: message.requestId,
                contractDigest: message.contractDigest,
                profile: message.profile,
              },
            } as MessageEvent<DocumentWorkerResponse>)
          }
        })
      }
      addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void {
        if (type === 'message') this.listeners.add(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
      }
      removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void {
        if (type === 'message') this.listeners.delete(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
      }
      terminate(): void {}
    }
    const originalWorker = globalThis.Worker
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: CapturingWorker })
    setNativeBridgeForTest({
      workspaceRead: async (path) => ({
        relativePath: path,
        text: source,
        sha256: 'a'.repeat(64),
        size: source.length,
        modifiedAt: 'now',
        readOnly: true,
      }),
    })
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'flow.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: true },
    ])
    try {
      const rendered = render(App)
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })).not.toBeInTheDocument(),
      )
      await fireEvent.click(screen.getByRole('treeitem', { name: /flow.yaml/i }))
      await waitFor(() => expect($documentSession.get().pair?.definition.path).toBe('flow.yaml'))
      const pair = $documentSession.get().pair!
      const before = pair.definition.text
      await fireEvent.keyDown(window, { key: 'F1' })
      const search = await screen.findByRole('combobox', { name: 'Search commands' })
      await fireEvent.input(search, { target: { value: 'Validate Workflow' } })
      await fireEvent.keyDown(search, { key: 'Enter' })

      await waitFor(() =>
        expect(
          workers
            .flatMap(({ messages }) => messages)
            .find((message) => message.type === 'analyze' && message.reason === 'explicit-validate'),
        ).toMatchObject({
          type: 'analyze',
          workflowId: pair.workflowId,
          definition: { path: pair.definition.path, text: before, revision: pair.definition.revision },
          reason: 'explicit-validate',
        }),
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Validation scheduled for the current workflow.')
      expect($documentSession.get().pair!.definition.text).toBe(before)
      expect(historyStore.get().undo).toHaveLength(0)
      rendered.unmount()
    } finally {
      if (originalWorker === undefined) Reflect.deleteProperty(globalThis, 'Worker')
      else Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
    }
  })

  it('keeps deletion side-effect free on cancel and commits only after confirmation', async () => {
    const rendered = await renderAuthoringApp({ companionText: '# exact companion\npolicy: preserved\n' })
    setCanvasSelection(['collect'])
    const beforePair = structuredClone($documentSession.get().pair)
    const beforeLayout = structuredClone(activeLayoutStore.get())
    const beforeSelection = [...$canvasSelection.get()]
    const before = $documentSession.get().pair?.definition.text
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Selection' }))
    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect($documentSession.get().pair?.definition.text).toBe(before)
    expect($documentSession.get().pair).toEqual(beforePair)
    expect($canvasSelection.get()).toEqual(beforeSelection)
    expect(activeLayoutStore.get()).toEqual(beforeLayout)
    expect(historyStore.get().undo).toHaveLength(0)

    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Selection' }))
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete nodes' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).not.toContain('id: collect'))
    expect(historyStore.get().undo).toHaveLength(1)
    rendered.unmount()
  })

  it('rejects a delete dialog after the saved pair lease changes while analysis remains current', async () => {
    const rendered = await renderAuthoringApp({ companionText: '# companion\npolicy: exact\n' })
    setCanvasSelection(['collect'])
    await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Selection' }))
    await screen.findByRole('dialog', { name: 'Delete selected nodes' })
    const state = $documentSession.get()
    const pair = { ...state.pair!, definition: { ...state.pair!.definition, diskHash: 'sha256:new-save' } }
    $documentSession.set({ ...state, pair })
    const layout = structuredClone(activeLayoutStore.get())
    await fireEvent.click(screen.getByRole('button', { name: 'Delete nodes' }))
    expect(await screen.findByText(/workflow changed after the delete preview/i)).toBeVisible()
    expect($documentSession.get().pair).toEqual(pair)
    expect($canvasSelection.get()).toEqual(['collect'])
    expect(historyStore.get().undo).toHaveLength(0)
    expect(activeLayoutStore.get()).toEqual(layout)
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

  it('keeps an inspector draft mounted through a same-workflow projection diagnostics refresh', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['collect'])
    const command = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Command' })
    await fireEvent.input(command, { target: { value: '/review' } })

    const publishedSelections: string[][] = []
    const unsubscribe = $canvasSelection.subscribe((ids) => publishedSelections.push([...ids]))
    const revision = $documentSession.get().revision!
    const refreshedProjection = projection()
    receiveDocumentAnalysis({
      ...revision,
      structurallyValid: true,
      issues: [
        {
          code: 'runtime_advisory',
          layer: 'operational',
          severity: 'warning',
          blocking: false,
          message: 'The runtime is unavailable.',
          document: 'definition',
          nodeId: 'collect',
        },
      ],
      projection: {
        ...refreshedProjection,
        graphs: refreshedProjection.graphs.map((graph, index) =>
          index === 0 ? { ...graph, nodes: graph.nodes.map((node) => ({ ...node })) } : graph,
        ),
      },
    })
    await tick()
    await tick()

    expect(command.isConnected).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Command' })).toBe(command)
    expect(command).toHaveValue('/review')
    expect(publishedSelections.length).toBeGreaterThan(0)
    expect(publishedSelections.every((ids) => ids.length === 1 && ids[0] === 'collect')).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: 'Apply Command' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('command: /review'))
    expect(historyStore.get().undo).toHaveLength(1)

    unsubscribe()
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
    await waitFor(() =>
      expect(activeLayoutStore.get()?.scopeLayouts.root.nodePositions.reviewed).toEqual({ x: 320, y: 0 }),
    )
    expect(activeLayoutStore.get()?.scopeLayouts.root.nodePositions.review).toBeUndefined()
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

  it('reaches nested and wildcard descriptors with contextual paths and resets drafts without YAML mutation', async () => {
    const rendered = await renderAuthoringApp()
    setCanvasSelection(['review'])

    await fireEvent.click(screen.getByRole('tab', { name: 'Execution' }))
    await waitFor(() => expect(screen.queryAllByText('Retry attempts.')).toHaveLength(1))
    const retryAttempts = await screen.findByRole('spinbutton', { name: /retry max attempts.*required/i })
    expect(retryAttempts).toHaveValue(2)
    await fireEvent.input(retryAttempts, { target: { value: '4' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Retry Max attempts draft' }))
    expect(screen.getByRole('spinbutton', { name: /retry max attempts.*required/i })).toHaveValue(2)
    expect($documentSession.get().pair?.definition.text).toBe(source)
    expect(historyStore.get().undo).toHaveLength(0)

    await fireEvent.input(screen.getByRole('spinbutton', { name: /retry max attempts.*required/i }), {
      target: { value: '4' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Retry Max attempts' }))
    await waitFor(() => expect($documentSession.get().pair?.definition.text).toContain('max_attempts: 4'))
    expect(historyStore.get().undo).toHaveLength(1)

    await fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
    expect(await screen.findByRole('textbox', { name: /agents reviewer description.*required/i })).toHaveValue(
      'Review the result.',
    )
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
