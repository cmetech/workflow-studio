import { render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { parse } from 'yaml'
import { tick } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import DocumentationView from '$src/features/documentation/DocumentationView.svelte'
import { createCommandRegistry } from '$src/lib/commands/registry'
import type { DocumentationIndex, DocumentationTopic } from '$src/lib/docs/types'

const nativeWindow = vi.hoisted(() => ({
  onCloseRequested: vi.fn(async () => () => undefined),
  onDragDropEvent: vi.fn(async () => () => undefined),
  destroy: vi.fn(async () => undefined),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }))

const digest = `sha256:${'9'.repeat(64)}` as const
const nodeField = (name: 'id' | 'depends_on' | 'command') => ({
  id: `command.node.${name}`,
  label: name === 'id' ? 'Node ID' : name === 'depends_on' ? 'Depends on' : 'Command',
  description: `Edit the command node ${name}.`,
  field_path: `nodes[].${name}`,
  applicability: {
    profiles: ['hermes-legacy'] as const,
    documents: ['definition'] as const,
    node_kinds: ['command'],
  },
  widget: name === 'depends_on' ? 'array' : 'text',
  section: name === 'depends_on' ? 'Execution' : 'General',
  order: name === 'id' ? 1 : name === 'command' ? 2 : 3,
  status: 'supported' as const,
  examples: [name === 'depends_on' ? ['seed'] : name],
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
        minLength: 1,
        title: 'Workflow name',
        description: 'Workflow name.',
        examples: ['Keyboard flow'],
        'x-hermes-widget': 'text',
        'x-hermes-section': 'General',
        'x-hermes-order': 1,
        'x-hermes-status': 'supported',
      },
      description: {
        type: 'string',
        minLength: 1,
        title: 'Workflow description',
        description: 'Workflow description.',
        examples: ['Keyboard authoring'],
        'x-hermes-widget': 'textarea',
        'x-hermes-section': 'General',
        'x-hermes-order': 2,
        'x-hermes-status': 'supported',
      },
      nodes: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            depends_on: { type: 'array', items: { type: 'string' } },
            command: { type: 'string' },
          },
          required: ['id', 'command'],
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
      description: 'Run an agent command.',
      field_path: 'nodes[].command',
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      widget: 'text',
      section: 'general',
      order: 1,
      status: 'supported',
      examples: ['run'],
      fields: [nodeField('id'), nodeField('command'), nodeField('depends_on')],
    },
  ],
  semantic_rules: [
    {
      id: 'workflow-dag-v1',
      label: 'DAG',
      description: 'Graph fields.',
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

import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'
import {
  createDocumentWorkerCache,
  processDocumentWorkerRequest,
  type DocumentWorkerCache,
} from '$src/workers/document-worker'
import { $canvasSelection, clearCanvasState } from '$src/stores/canvas'
import { $documentSession, closeDocumentSession } from '$src/stores/documents'
import { createHistoryState, historyStore } from '$src/stores/history'
import { clearActiveLayout } from '$src/stores/layout'
import { resetDocumentationSession } from '$src/stores/documentation'
import { closeCommandPalette, closeKeyboardShortcuts, closeTransientPanels, showEditorMode } from '$src/stores/shell'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'

const initialYaml = `name: Keyboard flow
description: Keyboard-only authoring
nodes:
  - id: seed
    command: seed work
`

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

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
  }

  publish(target: Element, width: number): void {
    this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this)
  }
}

class TestMediaQueryList extends EventTarget implements MediaQueryList {
  static instances: TestMediaQueryList[] = []
  matches = false
  private changeHandler: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null

  constructor(readonly media: string) {
    super()
    TestMediaQueryList.instances.push(this)
  }

  get onchange(): ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null {
    return this.changeHandler
  }

  set onchange(callback: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null) {
    if (this.changeHandler) this.removeEventListener('change', this.changeHandler as EventListener)
    this.changeHandler = callback
    if (callback) this.addEventListener('change', callback as EventListener)
  }

  addListener(callback: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
    if (callback) this.addEventListener('change', callback as EventListener)
  }

  removeListener(callback: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
    if (callback) this.removeEventListener('change', callback as EventListener)
  }

  publish(matches: boolean): void {
    this.matches = matches
    const event = new Event('change') as MediaQueryListEvent
    Object.defineProperties(event, {
      matches: { value: matches },
      media: { value: this.media },
    })
    this.dispatchEvent(event)
  }
}

async function publishResize(target: Element, width: number): Promise<void> {
  const observer = TestResizeObserver.instances.find((candidate) => candidate.targets.has(target))
  if (!observer) throw new Error('Expected the workbench boundary to be observed.')
  observer.publish(target, width)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

async function publishMediaQuery(media: string, matches: boolean): Promise<void> {
  const query = TestMediaQueryList.instances.find((candidate) => candidate.media === media)
  if (!query) throw new Error(`Expected ${media} to be observed.`)
  query.publish(matches)
  await tick()
}

function modifierChord(key: string): string {
  return /mac/i.test(navigator.platform) ? `{Meta>}${key}{/Meta}` : `{Control>}${key}{/Control}`
}

function projection(text: string) {
  const definition = parse(text) as {
    name: string
    description: string
    nodes: readonly { id: string; command: string; depends_on?: readonly string[] }[]
  }
  const nodes = definition.nodes.map((node, index) => ({
    id: node.id,
    kind: 'command',
    value: node.command,
    dependsOn: [...(node.depends_on ?? [])],
    options: {},
    source: { path: `/nodes/${index}`, start: index * 10, end: index * 10 + 9 },
  }))
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

function expectVisibleKeyboardFocus(element: HTMLElement): void {
  expect(element).toHaveFocus()
  const outline = getComputedStyle(element).outlineWidth
  expect(element.matches(':focus-visible') || (outline !== '' && outline !== '0px')).toBe(true)
}

async function openAddNodeWithKeyboard(user: UserEvent): Promise<HTMLInputElement> {
  await user.keyboard('{F1}')
  const commands = await screen.findByRole('combobox', { name: 'Search commands' })
  expectVisibleKeyboardFocus(commands)
  await user.keyboard('Add Node{Enter}')
  const nodeKinds = await screen.findByRole('combobox', { name: 'Search node kinds' })
  await waitFor(() => expectVisibleKeyboardFocus(nodeKinds))
  return nodeKinds
}

async function waitForCurrentAnalysis(): Promise<void> {
  await waitFor(() => {
    const session = $documentSession.get()
    expect(session.analysis?.definitionRevision).toBe(session.pair?.definition.revision)
    expect(session.analysis?.structurallyValid).toBe(true)
  })
  await tick()
}

async function tabTo(user: UserEvent, target: HTMLElement, limit = 80): Promise<void> {
  for (let index = 0; index < limit && document.activeElement !== target; index += 1) await user.tab()
  expectVisibleKeyboardFocus(target)
}

async function selectNodeWithKeyboard(user: UserEvent, id: string): Promise<HTMLElement> {
  const node = (await screen.findAllByLabelText(`command node ${id}`)).find((element) =>
    element.classList.contains('svelte-flow__node'),
  ) as HTMLElement | undefined
  expect(node).toBeDefined()
  await tabTo(user, node!)
  await user.keyboard(' ')
  await waitFor(() => expect($canvasSelection.get()).toEqual([id]))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
  expect($canvasSelection.get()).toEqual([id])
  return node!
}

describe('keyboard-only workflow authoring', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => new TestMediaQueryList(query)),
    })
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
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
  })

  beforeEach(() => {
    resetDocumentationSession()
  })

  afterEach(() => {
    setNativeBridgeForTest(undefined)
    clearCanvasState()
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    closeCommandPalette()
    closeKeyboardShortcuts()
    closeTransientPanels()
    showEditorMode('visual')
    resetDocumentationSession()
    TestMediaQueryList.instances = []
    TestResizeObserver.instances = []
    historyStore.set(createHistoryState())
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
  })

  it('adds two nodes, connects and edits them, saves, and rejects a cycle with visible focus throughout', async () => {
    const user = userEvent.setup()
    const writes: string[] = []
    setNativeBridgeForTest({
      workspaceRead: async (relativePath) => ({
        relativePath,
        text: initialYaml,
        sha256: 'a'.repeat(64),
        size: initialYaml.length,
        modifiedAt: '2026-07-25T00:00:00.000Z',
        readOnly: false,
      }),
      workspaceWrite: async ({ relativePath, text }) => {
        writes.push(text)
        return { relativePath, sha256: 'b'.repeat(64), size: text.length, modifiedAt: 'now' }
      },
    })
    loadWorkspaceEntries('workspace', 'Workspace', [
      { relativePath: 'keyboard.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    const App = (await import('$src/app/App.svelte')).default
    const rendered = render(App)
    const workflowEntry = await screen.findByRole('treeitem', { name: /keyboard\.yaml, legacy workflow/i })
    // jsdom does not seed focus into a newly mounted application. This is the
    // single initial entry point; every subsequent move uses keyboard actions.
    workflowEntry.focus()
    expectVisibleKeyboardFocus(workflowEntry)
    await user.keyboard('{Enter}')
    const canvas = await screen.findByRole('region', { name: 'Workflow graph' })
    const ports = rendered.container.querySelectorAll('[data-port]')
    expect(ports.length).toBeGreaterThan(0)
    for (const port of ports) {
      expect(port).toHaveAccessibleName()
      expect(port).toHaveAttribute('title')
      expect(port).not.toHaveAttribute('role', 'button')
      expect(port).not.toHaveAttribute('tabindex', '0')
    }
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'New Workflow' }).every((button) => !button.hasAttribute('disabled')),
      ).toBe(true),
    )

    const workbench = rendered.container.querySelector<HTMLElement>('.workbench')!
    const editorWorkspace = screen.getByRole('region', { name: 'Workflow workspace' })
    await publishMediaQuery('(max-width: 1279px)', true)
    await publishResize(workbench, 1024)
    await publishResize(editorWorkspace, 976)
    await tick()
    const explorerDrawer = rendered.container.querySelector<HTMLElement>('aside[aria-label="Workspace panel"]')!
    expect(explorerDrawer).toHaveAttribute('inert')

    await tabTo(user, canvas)
    await user.keyboard(modifierChord('b'))
    const closeExplorer = screen.getByRole('button', { name: 'Close workspace panel' })
    await waitFor(() => expectVisibleKeyboardFocus(closeExplorer))
    expect(explorerDrawer).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    await waitFor(() => expectVisibleKeyboardFocus(canvas))
    expect(explorerDrawer).toHaveAttribute('inert')

    await user.keyboard(modifierChord('/'))
    const shortcutsDialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    const closeShortcuts = within(shortcutsDialog).getByRole('button', { name: 'Close keyboard shortcuts' })
    await waitFor(() => expectVisibleKeyboardFocus(closeShortcuts))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(shortcutsDialog).not.toBeInTheDocument())
    expectVisibleKeyboardFocus(canvas)

    let picker = await openAddNodeWithKeyboard(user)
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    await waitFor(() => expect(projection($documentSession.get().pair!.definition.text).nodes).toHaveLength(2))
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    await waitFor(() => expectVisibleKeyboardFocus(canvas))

    const pairAfterAdd = $documentSession.get().pair!
    await waitFor(() => {
      expect($documentSession.get().analysis?.issues).toEqual([])
      expect($documentSession.get().analysis).toMatchObject({
        structurallyValid: true,
        definitionRevision: pairAfterAdd.definition.revision,
      })
    })
    expect(screen.queryByText(/last valid graph shown read-only/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More canvas actions' }))
    expect(screen.getByRole('menuitem', { name: 'Arrange Graph' })).toBeEnabled()
    await selectNodeWithKeyboard(user, 'seed')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Edge' })).toBeEnabled())
    await user.keyboard('e')
    expect(await screen.findByRole('option', { name: 'command' })).toHaveAttribute('aria-selected', 'true')
    expectVisibleKeyboardFocus(canvas)
    await user.keyboard('{Enter}')
    await waitFor(() => {
      const nodes = projection($documentSession.get().pair!.definition.text).nodes
      expect(nodes.find(({ id }) => id === 'command')?.dependsOn).toEqual(['seed'])
    })
    await waitForCurrentAnalysis()

    await selectNodeWithKeyboard(user, 'command')
    await user.keyboard('{Shift>}n{/Shift}')
    picker = await screen.findByRole('combobox', { name: 'Search node kinds' })
    await waitFor(() => expectVisibleKeyboardFocus(picker))
    await user.keyboard('{Enter}')
    await waitFor(() => {
      const nodes = projection($documentSession.get().pair!.definition.text).nodes
      expect(nodes.find(({ id }) => id === 'command-2')?.dependsOn).toEqual(['command'])
    })
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    await waitFor(() => expectVisibleKeyboardFocus(canvas))
    await waitForCurrentAnalysis()

    await selectNodeWithKeyboard(user, 'command-2')
    const beforeCycleAttempt = $documentSession.get().pair!.definition.text
    await user.keyboard('e')
    const liveFeedback = screen.getByRole('status', { name: 'Canvas authoring feedback' })
    expect(liveFeedback).toHaveTextContent(/cycle/i)
    expect($documentSession.get().pair!.definition.text).toBe(beforeCycleAttempt)
    expectVisibleKeyboardFocus(canvas)

    await user.keyboard('{Enter}')
    const generalTab = await screen.findByRole('tab', { name: 'General' })
    expectVisibleKeyboardFocus(generalTab)
    const requiredId = await screen.findByRole('textbox', { name: /node id/i })
    expect(requiredId).toHaveAttribute('aria-required', 'true')
    await tabTo(user, requiredId)
    await user.keyboard(
      `${/mac/i.test(navigator.platform) ? '{Meta>}' : '{Control>}'}a${/mac/i.test(navigator.platform) ? '{/Meta}' : '{/Control}'}final-command{Enter}`,
    )
    await waitFor(() => expect($documentSession.get().pair!.definition.text).toContain('id: final-command'))
    await waitFor(() => {
      const pair = $documentSession.get().pair!
      expect($documentSession.get().analysis?.definitionRevision).toBe(pair.definition.revision)
    })

    const saveTarget = await screen.findByRole('tab', { name: 'General' })
    await waitFor(() => expectVisibleKeyboardFocus(saveTarget))
    await user.keyboard(/mac/i.test(navigator.platform) ? '{Meta>}s{/Meta}' : '{Control>}s{/Control}')
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toContain('id: final-command')
    expectVisibleKeyboardFocus(saveTarget)

    await user.keyboard('{Escape}')
    await waitFor(() => expectVisibleKeyboardFocus(canvas))
    expect(rendered.container.querySelector<HTMLElement>('aside[aria-label="Inspector"]')).toHaveAttribute('inert')

    await publishResize(editorWorkspace, 719)
    await user.keyboard(modifierChord('2'))
    const splitPane = await screen.findByRole('group', { name: 'Split pane' })
    const canvasSubtab = within(splitPane).getByRole('button', { name: 'Canvas' })
    const yamlSubtab = within(splitPane).getByRole('button', { name: 'YAML' })
    expect(canvasSubtab).toHaveAttribute('aria-pressed', 'true')
    expect(yamlSubtab).toHaveAttribute('aria-pressed', 'false')
    canvasSubtab.focus()
    expectVisibleKeyboardFocus(canvasSubtab)
    await user.tab()
    expectVisibleKeyboardFocus(yamlSubtab)
    await user.keyboard(' ')
    expect(canvasSubtab).toHaveAttribute('aria-pressed', 'false')
    expect(yamlSubtab).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true')
    rendered.unmount()
  }, 20_000)

  it('traverses documentation modes, repeated fields, articles, and shortcut search with keyboard events', async () => {
    const topic = (id: string, qualifier: string, nodeKind?: 'bash' | 'prompt'): DocumentationTopic => ({
      id,
      kind: id.startsWith('guide:') ? 'guide' : 'field',
      title: id === 'guide:keyboard-shortcuts' ? 'Keyboard shortcuts' : 'Context',
      description: `${qualifier} documentation.`,
      body: id === 'guide:keyboard-shortcuts' ? 'Use the live shortcut table.' : `${qualifier} context.`,
      qualifier,
      useWhen: `Use this when ${qualifier.toLowerCase()} help is needed.`,
      breadcrumb: id.startsWith('guide:') ? ['Guides', 'Use the application'] : ['Reference', 'Common node settings'],
      renderer: id === 'guide:keyboard-shortcuts' ? 'keyboard-shortcuts' : 'markdown',
      examples: [],
      status: 'supported',
      profile: 'hermes-legacy',
      fieldPaths: nodeKind ? ['nodes[].context'] : [],
      ...(nodeKind ? { nodeKinds: [nodeKind], referenceGroup: 'common-node-settings' as const } : {}),
      ...(id.startsWith('guide:') ? { guideGroup: 'use-application' as const } : {}),
    })
    const topics = [
      topic('field:bash.node.context', 'Bash node', 'bash'),
      topic('field:prompt.node.context', 'Prompt node', 'prompt'),
      topic('guide:keyboard-shortcuts', 'Guide'),
    ]
    const index: DocumentationIndex = {
      topics,
      byId: new Map(topics.map((entry) => [entry.id, entry])),
      searchText: new Map(
        topics.map((entry) => [entry.id, `${entry.title} ${entry.qualifier} ${entry.description}`.toLowerCase()]),
      ),
      tokenIndex: new Map(),
      guideGroups: new Map([['use-application', [topics[2]!]]]),
      referenceGroups: new Map([['common-node-settings', topics.slice(0, 2)]]),
      duplicateTitleGroups: new Map([['context', topics.slice(0, 2)]]),
    }
    for (const entry of topics) {
      const text = index.searchText.get(entry.id)!
      for (const token of text.split(/[^a-z0-9]+/).filter(Boolean)) {
        const ids = index.tokenIndex.get(token) ?? new Set<string>()
        ids.add(entry.id)
        index.tokenIndex.set(token, ids)
      }
    }
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'document.save',
      label: 'Save Workflow Pair',
      category: 'File',
      defaultBindings: ['Mod+S'],
      enabled: () => true,
      run: () => undefined,
    })
    const user = userEvent.setup()
    const rendered = render(DocumentationView, { index, commandSurface: registry })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    expectVisibleKeyboardFocus(overview)

    await user.tab()
    expectVisibleKeyboardFocus(screen.getByRole('tab', { name: 'Guides' }))
    await user.tab()
    const reference = screen.getByRole('tab', { name: 'Reference' })
    expectVisibleKeyboardFocus(reference)
    await user.keyboard('{Enter}')

    const referenceGroup = screen.getByRole('button', { name: 'Common node settings, reference group' })
    await tabTo(user, referenceGroup)
    expect(referenceGroup).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(referenceGroup).toHaveAttribute('aria-expanded', 'false'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(referenceGroup).toHaveAttribute('aria-expanded', 'true'))
    const repeatedContext = screen.getByRole('button', { name: 'Context, used by 2 node types' })
    await tabTo(user, repeatedContext)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(repeatedContext).toHaveAttribute('aria-expanded', 'true'))
    const promptContext = screen.getByRole('button', { name: 'Context, Prompt node' })
    await tabTo(user, promptContext)
    await user.keyboard('{Enter}')

    const back = screen.getByRole('button', { name: 'Back to Results' })
    await tabTo(user, back)
    await user.keyboard('{Enter}')
    await waitFor(() => expectVisibleKeyboardFocus(promptContext))

    await tabTo(user, overview)
    await user.keyboard('{Enter}')
    const shortcutsTask = screen.getByRole('button', { name: /Work faster with keyboard shortcuts/i })
    await tabTo(user, shortcutsTask)
    await user.keyboard('{Enter}')
    const shortcutSearch = screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' })
    await tabTo(user, shortcutSearch)
    await user.keyboard('canvas space')
    expect(screen.getByText('Pan canvas', { exact: true })).toBeVisible()
    expectVisibleKeyboardFocus(shortcutSearch)
    rendered.unmount()
  })
})
