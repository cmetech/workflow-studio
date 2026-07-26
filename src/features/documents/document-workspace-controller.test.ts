import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { DocumentAnalysis } from '$src/lib/documents/types'
import type { WorkspaceReadResult, WorkspaceWriteResult } from '$src/lib/native/types'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import {
  $documentSession,
  closeDocumentSession,
  openDocumentSession,
  updateDocumentSession,
} from '$src/stores/documents'
import {
  $documentWorkspace,
  DocumentWorkspaceController,
  type DocumentAnalysisClient,
  type DocumentWorkspaceControllerDependencies,
} from './document-workspace-controller'

const digest = `sha256:${'a'.repeat(64)}` as const
const contract = {
  profile: 'hermes-legacy',
  contract_digest: digest,
  limits: { max_document_bytes: 2 * 1024 * 1024 },
} as AuthoringContract

function entry(path: string): WorkflowPairEntry {
  return {
    kind: 'workflow',
    id: `workflow:workspace:${path}`,
    name: path,
    relativePath: path,
    definitionPath: path,
    companionPath: null,
    state: 'legacy',
    readOnly: false,
  }
}

function read(path: string, text = `name: ${path}\n`): WorkspaceReadResult {
  return {
    relativePath: path,
    text,
    sha256: path.padEnd(64, 'a').slice(0, 64),
    size: text.length,
    modifiedAt: 'now',
    readOnly: false,
  }
}

function dependencies(overrides: Partial<DocumentWorkspaceControllerDependencies> = {}) {
  let watcher:
    | ((change: {
        event: { paths: readonly string[]; kind: 'modify' }
        files: readonly WorkspaceReadResult[]
      }) => Promise<void>)
    | undefined
  const client: DocumentAnalysisClient = { schedule: vi.fn(), dispose: vi.fn() }
  const deps: DocumentWorkspaceControllerDependencies = {
    read: vi.fn(async (path) => read(path)),
    write: vi.fn(),
    trash: vi.fn(),
    createAnalysisClient: vi.fn(() => client),
    watch: vi.fn(async (handler) => {
      watcher = handler
      return vi.fn()
    }),
    recovery: { save: vi.fn(), list: vi.fn(async () => []), discard: vi.fn() },
    recoveryDrafts: { changed: vi.fn(), close: vi.fn(async () => undefined) },
    layout: { loadLayout: vi.fn(async () => null), saveLayout: vi.fn(), renameWorkflowPath: vi.fn() },
    createLayoutPersistence: vi.fn(() => ({ close: vi.fn(async () => undefined) })),
    ...overrides,
  }
  return { deps, client, watcher: () => watcher }
}

afterEach(() => closeDocumentSession())

describe('DocumentWorkspaceController', () => {
  it('lets only the newest activation publish a session or schedule worker analysis', async () => {
    let releaseA: ((value: WorkspaceReadResult) => void) | undefined
    const { deps, client } = dependencies({
      read: vi.fn((path: string): Promise<WorkspaceReadResult> =>
        path === 'a.yaml'
          ? new Promise<WorkspaceReadResult>((resolve) => {
              releaseA = resolve
            })
          : Promise.resolve(read(path)),
      ),
    })
    const controller = new DocumentWorkspaceController(deps)

    const openingA = controller.activate('workspace', entry('a.yaml'), contract)
    const openingB = controller.activate('workspace', entry('b.yaml'), contract)
    await openingB
    releaseA?.(read('a.yaml'))
    await openingA

    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
    expect(client.schedule).toHaveBeenCalledTimes(1)
    expect(client.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ definition: expect.objectContaining({ path: 'b.yaml' }) }),
      contract,
      'open',
    )
  })

  it('auto-reloads a clean watcher edit but exposes a conflict for dirty text', async () => {
    const { deps, client, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    await controller.activate('workspace', entry('flow.yaml'), contract)

    await watcher()?.({ event: { paths: ['flow.yaml'], kind: 'modify' }, files: [read('flow.yaml', 'name: disk\n')] })
    expect($documentSession.get().pair?.definition.text).toBe('name: disk\n')
    expect(client.schedule).toHaveBeenLastCalledWith(expect.anything(), contract, 'open')

    const clean = $documentSession.get().pair!
    updateDocumentSession(
      { ...clean, definition: { ...clean.definition, text: 'name: mine\n', revision: clean.definition.revision + 1 } },
      digest,
    )
    await watcher()?.({
      event: { paths: ['flow.yaml'], kind: 'modify' },
      files: [read('flow.yaml', 'name: newer disk\n')],
    })
    expect($documentSession.get().pair?.definition.text).toBe('name: mine\n')
    expect($documentWorkspace.get().conflict?.disk.text).toBe('name: newer disk\n')
  })

  it('debounces recovery through the controller, loads layout, and flushes every resource on teardown', async () => {
    const layoutCloser = { close: vi.fn(async () => undefined) }
    const unlisten = vi.fn()
    const { deps, client } = dependencies({
      watch: vi.fn(async () => unlisten),
      createLayoutPersistence: vi.fn(() => layoutCloser),
    })
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    const pair = await controller.activate('workspace', entry('flow.yaml'), contract)
    controller.changed({ ...pair!, definition: { ...pair!.definition, text: 'dirty', revision: 1 } })
    await controller.dispose()

    expect(deps.recoveryDrafts.changed).toHaveBeenCalled()
    expect(deps.recoveryDrafts.close).toHaveBeenCalled()
    expect(deps.layout.loadLayout).toHaveBeenCalledWith(expect.objectContaining({ workflowPath: 'flow.yaml' }))
    expect(layoutCloser.close).toHaveBeenCalled()
    expect(unlisten).toHaveBeenCalled()
    expect(client.dispose).toHaveBeenCalled()
  })

  it('publishes analysis only when it still matches the active path identity', async () => {
    let publish: ((analysis: DocumentAnalysis) => void) | undefined
    const { deps } = dependencies({
      createAnalysisClient: vi.fn((onAnalysis) => {
        publish = onAnalysis
        return { schedule: vi.fn(), dispose: vi.fn() }
      }),
    })
    const controller = new DocumentWorkspaceController(deps)
    const pair = await controller.activate('workspace', entry('flow.yaml'), contract)
    publish?.({
      workflowId: pair!.workflowId,
      pairGeneration: 0,
      definitionPath: 'old.yaml',
      companionPath: null,
      definitionRevision: 0,
      companionRevision: null,
      contractDigest: digest,
      issues: [],
      structurallyValid: true,
    })
    expect($documentSession.get().analysis).toBeNull()
  })

  it('reconciles and persists active layout only from current worker projection', async () => {
    let publish: ((analysis: DocumentAnalysis) => void) | undefined
    const { deps } = dependencies({
      createAnalysisClient: vi.fn((onAnalysis) => {
        publish = onAnalysis
        return { schedule: vi.fn(), dispose: vi.fn() }
      }),
    })
    const controller = new DocumentWorkspaceController(deps)
    const pair = await controller.activate('workspace', entry('flow.yaml'), contract)
    publish?.({
      workflowId: pair!.workflowId,
      pairGeneration: 0,
      definitionPath: 'flow.yaml',
      companionPath: null,
      definitionRevision: 0,
      companionRevision: null,
      contractDigest: digest,
      issues: [],
      structurallyValid: true,
      projection: { nodes: [{ id: 'build', kind: 'command', value: 'make', dependsOn: [], options: {} }] },
    })
    await vi.waitFor(() =>
      expect(deps.layout.saveLayout).toHaveBeenCalledWith(
        expect.objectContaining({ workflowPath: 'flow.yaml', nodePositions: { build: { x: 0, y: 0 } } }),
        expect.objectContaining({ definition: pair!.definition.diskHash }),
      ),
    )
  })

  it('migrates the complete active identity once and reschedules analysis after rename', async () => {
    const { deps, client } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', entry('flow.yaml'), contract)

    await controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)

    expect($documentSession.get()).toMatchObject({
      pair: {
        workflowId: 'workflow:workspace:renamed.yaml',
        definition: { id: 'workflow:workspace:renamed.yaml:definition', path: 'renamed.yaml' },
      },
      analysis: null,
      revision: { definitionPath: 'renamed.yaml' },
    })
    expect(deps.layout.renameWorkflowPath).toHaveBeenCalledWith('workspace', 'flow.yaml', 'renamed.yaml')
    expect(deps.recovery.discard).toHaveBeenCalledWith('workflow:workspace:flow.yaml')
    expect(client.schedule).toHaveBeenLastCalledWith(expect.anything(), contract, 'contract-change')
  })

  it('updates companion structure on disk actions and invalidates analysis by generation', async () => {
    const { deps, client } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)

    await controller.companionCreated('flow.yaml', 'flow.hermes.yaml')
    expect($documentSession.get().pair).toMatchObject({
      generation: opened!.generation + 1,
      companion: { path: 'flow.hermes.yaml' },
    })
    expect($documentSession.get().analysis).toBeNull()
    await controller.companionRemoved('flow.hermes.yaml')
    expect($documentSession.get().pair).toMatchObject({ generation: opened!.generation + 2, companion: null })
    expect(client.schedule).toHaveBeenLastCalledWith(expect.anything(), contract, 'contract-change')
  })

  it('adopts recovery-backed drafts into the same lifecycle instead of bypassing it', async () => {
    const { deps, client } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    const draft = {
      workflowId: 'import.yaml',
      generation: 1,
      savedGeneration: 0,
      definition: {
        id: 'import.yaml:definition',
        kind: 'definition' as const,
        path: 'import.yaml',
        text: 'invalid: [',
        revision: 1,
        savedRevision: 0,
        diskHash: null,
      },
      companion: null,
    }
    await controller.openDraft('workspace', draft, contract)

    expect($documentSession.get().pair).toEqual(draft)
    expect(deps.recoveryDrafts.changed).toHaveBeenCalledWith(draft)
    expect(client.schedule).toHaveBeenCalledWith(draft, contract, 'open')
  })

  it('does not clear a newer activation that wins while close is flushing layout', async () => {
    let release: (() => void) | undefined
    const closer = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      ),
    }
    const { deps } = dependencies({ createLayoutPersistence: vi.fn(() => closer) })
    const controller = new DocumentWorkspaceController(deps)
    const first = await controller.activate('workspace', entry('a.yaml'), contract)
    const closing = controller.close(first!.workflowId)
    const second = {
      ...first!,
      workflowId: 'workflow:workspace:b.yaml',
      definition: { ...first!.definition, path: 'b.yaml' },
    }
    openDocumentSession(second, digest)
    release?.()
    await closing

    expect($documentSession.get().pair?.workflowId).toBe(second.workflowId)
  })

  it('does not clear a document activated while an initially empty workspace is closing', async () => {
    let release: (() => void) | undefined
    const { deps } = dependencies({
      recoveryDrafts: {
        changed: vi.fn(),
        close: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              release = resolve
            }),
        ),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    const closing = controller.closeWorkspace()
    await vi.waitFor(() => expect(release).toBeDefined())
    const activated = {
      workflowId: 'workflow:workspace:b.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'workflow:workspace:b.yaml:definition',
        kind: 'definition' as const,
        path: 'b.yaml',
        text: 'name: b\n',
        revision: 0,
        savedRevision: 0,
        diskHash: 'b'.repeat(64),
      },
      companion: null,
    }
    openDocumentSession(activated, digest)
    release?.()

    await expect(closing).rejects.toThrow('active document changed')
    expect($documentSession.get().pair?.workflowId).toBe(activated.workflowId)
  })

  it('does not let an older draft activation overwrite a newer file activation', async () => {
    let releaseDraftClose: (() => void) | undefined
    let closeCalls = 0
    const { deps } = dependencies({
      recoveryDrafts: {
        changed: vi.fn(),
        close: vi.fn(() => {
          closeCalls += 1
          return closeCalls === 1
            ? new Promise<void>((resolve) => {
                releaseDraftClose = resolve
              })
            : Promise.resolve()
        }),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', entry('initial.yaml'), contract)
    const draft = {
      workflowId: 'draft-a',
      generation: 1,
      savedGeneration: 0,
      definition: {
        id: 'draft-a:definition',
        kind: 'definition' as const,
        path: 'draft-a.yaml',
        text: 'name: draft\n',
        revision: 1,
        savedRevision: 0,
        diskHash: null,
      },
      companion: null,
    }
    const openingDraft = controller.openDraft('workspace', draft, contract)
    await vi.waitFor(() => expect(releaseDraftClose).toBeDefined())
    await controller.activate('workspace', entry('b.yaml'), contract)
    releaseDraftClose?.()
    await openingDraft

    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
  })

  it('retries the same layout persistence after a failed flush', async () => {
    const closer = {
      close: vi.fn().mockRejectedValueOnce(new Error('layout flush failed')).mockResolvedValue(undefined),
    }
    const { deps } = dependencies({ createLayoutPersistence: vi.fn(() => closer) })
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', entry('flow.yaml'), contract)

    await expect(controller.closeWorkspace()).rejects.toThrow('layout flush failed')
    await expect(controller.closeWorkspace()).resolves.toBeUndefined()

    expect(closer.close).toHaveBeenCalledTimes(2)
    expect($documentSession.get().pair).toBeNull()
  })

  it('migrates active document identity before a post-rename layout flush can fail', async () => {
    const closer = { close: vi.fn().mockRejectedValue(new Error('layout flush failed')) }
    const { deps } = dependencies({ createLayoutPersistence: vi.fn(() => closer) })
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', entry('flow.yaml'), contract)

    await expect(controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)).rejects.toThrow(
      'layout flush failed',
    )

    expect($documentSession.get().pair).toMatchObject({
      workflowId: 'workflow:workspace:renamed.yaml',
      definition: { path: 'renamed.yaml' },
    })
  })

  it('cleans up a watcher that registers after disposal starts', async () => {
    let register: ((unlisten: () => void) => void) | undefined
    const unlisten = vi.fn()
    const { deps } = dependencies({
      watch: vi.fn(
        () =>
          new Promise<() => void>((resolve) => {
            register = resolve
          }),
      ),
    })
    const controller = new DocumentWorkspaceController(deps)
    const starting = controller.start()
    const disposing = controller.dispose()
    register?.(unlisten)
    await Promise.all([starting, disposing])
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('migrates active identity without a contract and preserves edits while layout migration finishes', async () => {
    let release: (() => void) | undefined
    const { deps } = dependencies({
      layout: {
        loadLayout: vi.fn(async () => null),
        saveLayout: vi.fn(),
        renameWorkflowPath: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              release = resolve
            }),
        ),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', entry('flow.yaml'), null)
    const renaming = controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)
    await vi.waitFor(() => expect(release).toBeDefined())
    const active = $documentSession.get().pair!
    updateDocumentSession(
      { ...active, definition: { ...active.definition, text: 'newest', revision: 1 } },
      $documentSession.get().revision!.contractDigest,
    )
    release?.()
    await renaming

    expect($documentSession.get().pair).toMatchObject({
      workflowId: 'workflow:workspace:renamed.yaml',
      definition: { path: 'renamed.yaml', text: 'newest', revision: 1 },
    })
  })

  it('does not publish an old save outcome into a newer activation', async () => {
    let publish: ((analysis: DocumentAnalysis) => void) | undefined
    let finishWrite: ((value: WorkspaceWriteResult) => void) | undefined
    const { deps } = dependencies({
      createAnalysisClient: vi.fn((onAnalysis) => {
        publish = onAnalysis
        return { schedule: vi.fn(), dispose: vi.fn() }
      }),
      write: vi.fn(
        () =>
          new Promise<WorkspaceWriteResult>((resolve) => {
            finishWrite = resolve
          }),
      ),
    })
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('a.yaml'), contract)
    const dirty = { ...opened!, definition: { ...opened!.definition, text: 'dirty', revision: 1 } }
    controller.changed(dirty)
    publish?.({
      workflowId: dirty.workflowId,
      pairGeneration: 0,
      definitionPath: 'a.yaml',
      companionPath: null,
      definitionRevision: 1,
      companionRevision: null,
      contractDigest: digest,
      issues: [],
      structurallyValid: true,
    })
    const saving = controller.save()
    await vi.waitFor(() => expect(finishWrite).toBeDefined())
    await controller.activate('workspace', entry('b.yaml'), contract)
    vi.mocked(deps.recoveryDrafts.changed).mockClear()
    finishWrite?.({ relativePath: 'a.yaml', sha256: 'b'.repeat(64), size: 5, modifiedAt: 'now' })
    await saving

    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
    expect($documentWorkspace.get().saveOutcome).toBeNull()
    expect(deps.recoveryDrafts.changed).not.toHaveBeenCalled()
  })

  it('does not attach a companion read that completes after another document activates', async () => {
    let finishRead: ((value: WorkspaceReadResult) => void) | undefined
    const { deps } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    const first = await controller.activate('workspace', entry('a.yaml'), contract)
    vi.mocked(deps.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve
        }),
    )
    const creating = controller.companionCreated('a.yaml', 'a.hermes.yaml')
    const second = {
      ...first!,
      workflowId: 'workflow:workspace:b.yaml',
      definition: { ...first!.definition, path: 'b.yaml' },
    }
    openDocumentSession(second, digest)
    finishRead?.(read('a.hermes.yaml', 'language_compatibility: hermes-legacy\n'))
    await creating

    expect($documentSession.get().pair).toMatchObject({ workflowId: second.workflowId, companion: null })
  })
})
