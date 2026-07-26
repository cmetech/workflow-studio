import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { DocumentAnalysis } from '$src/lib/documents/types'
import type { WorkspaceReadResult, WorkspaceWriteResult } from '$src/lib/native/types'
import type { RereadWorkspaceChange } from '$src/lib/native/workspace-api'
import { createDocumentRevision } from '$src/lib/documents/revisions'
import { editDocumentText } from '$src/lib/documents/revisions'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import { createHistoryState, historyStore, recordTransaction, undoTransaction } from '$src/stores/history'
import {
  $documentSession,
  closeDocumentSession,
  isDocumentPairDirty,
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

function pairedEntry(path: string): WorkflowPairEntry {
  return {
    ...entry(path),
    companionPath: path.replace(/\.(?:yaml|yml)$/, '.hermes.yaml'),
    state: 'paired',
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
  let watcher: ((change: RereadWorkspaceChange) => Promise<void>) | undefined
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
    onWorkspaceChanged: vi.fn(async () => undefined),
    ...overrides,
  }
  return { deps, client, watcher: () => watcher }
}

afterEach(() => {
  closeDocumentSession()
  historyStore.set(createHistoryState())
})

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

  it('honors an activation request token allocated before delayed contract selection', async () => {
    const { deps } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    const requestA = controller.beginActivation()
    const requestB = controller.beginActivation()

    await controller.activate('workspace', entry('b.yaml'), contract, requestB)
    await controller.activate('workspace', entry('a.yaml'), contract, requestA)

    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
    expect(deps.read).not.toHaveBeenCalledWith('a.yaml')
  })

  it('does not let a slow companion read from request A overwrite request B', async () => {
    let releaseCompanion: ((value: WorkspaceReadResult) => void) | undefined
    const { deps } = dependencies({
      read: vi.fn((path: string) =>
        path === 'a.hermes.yaml'
          ? new Promise<WorkspaceReadResult>((resolve) => {
              releaseCompanion = resolve
            })
          : Promise.resolve(read(path)),
      ),
    })
    const controller = new DocumentWorkspaceController(deps)
    const requestA = controller.beginActivation()
    const openingA = controller.activate('workspace', pairedEntry('a.yaml'), contract, requestA)
    await vi.waitFor(() => expect(releaseCompanion).toBeDefined())
    const requestB = controller.beginActivation()
    await controller.activate('workspace', entry('b.yaml'), contract, requestB)
    releaseCompanion?.(read('a.hermes.yaml'))
    await openingA

    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
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

  it('rescans Explorer and surfaces a clean active definition deleted externally', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    await controller.activate('workspace', entry('flow.yaml'), contract)

    await watcher()?.({ event: { paths: ['flow.yaml'], kind: 'remove' }, files: [] })

    expect(deps.onWorkspaceChanged).toHaveBeenCalledOnce()
    expect($documentWorkspace.get().missingChange).toEqual({
      kind: 'remove',
      paths: ['flow.yaml'],
      dirty: false,
    })
  })

  it('surfaces dirty active content when its backing definition is deleted externally', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    controller.changed(editDocumentText(opened!, 'definition', 'name: mine\n'))

    await watcher()?.({ event: { paths: ['flow.yaml'], kind: 'remove' }, files: [] })

    expect($documentWorkspace.get().missingChange).toEqual({
      kind: 'remove',
      paths: ['flow.yaml'],
      dirty: true,
    })
    expect($documentSession.get().pair?.definition.text).toBe('name: mine\n')
  })

  it('clears missing-file state when the active file becomes readable again', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    await controller.activate('workspace', entry('flow.yaml'), contract)
    await watcher()?.({ event: { paths: ['flow.yaml'], kind: 'remove' }, files: [] })

    await watcher()?.({ event: { paths: ['flow.yaml'], kind: 'create' }, files: [read('flow.yaml')] })

    expect($documentWorkspace.get().missingChange).toBeNull()
  })

  it('clears a watcher missing warning after intentional companion removal is confirmed', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    await controller.activate('workspace', pairedEntry('flow.yaml'), contract)
    await watcher()?.({ event: { paths: ['flow.hermes.yaml'], kind: 'remove' }, files: [] })

    await controller.companionRemoved('flow.hermes.yaml')

    expect($documentWorkspace.get().missingChange).toBeNull()
  })

  it('migrates an externally renamed active workflow and layout only for a unique saved hash match', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    vi.mocked(deps.layout.loadLayout).mockClear()
    const moved = {
      ...read('archive/renamed.yaml', opened!.definition.text),
      sha256: opened!.definition.diskHash!,
    }

    await watcher()?.({
      event: { paths: ['flow.yaml', 'archive/renamed.yaml'], kind: 'rename' },
      files: [moved],
    })

    expect(deps.onWorkspaceChanged).toHaveBeenCalledOnce()
    expect($documentSession.get().pair).toMatchObject({
      workflowId: 'workflow:workspace:archive/renamed.yaml',
      definition: { path: 'archive/renamed.yaml', diskHash: opened!.definition.diskHash },
    })
    expect(deps.layout.loadLayout).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      workflowPath: 'archive/renamed.yaml',
      savedHashes: { definition: opened!.definition.diskHash, companion: null },
      missingWorkflowPaths: ['flow.yaml'],
    })
  })

  it('does not guess an external rename when multiple new files share the saved hash', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    const candidates = ['copy-a.yaml', 'copy-b.yaml'].map((path) => ({
      ...read(path, opened!.definition.text),
      sha256: opened!.definition.diskHash!,
    }))

    await watcher()?.({
      event: { paths: ['flow.yaml', ...candidates.map(({ relativePath }) => relativePath)], kind: 'rename' },
      files: candidates,
    })

    expect($documentSession.get().pair?.definition.path).toBe('flow.yaml')
    expect($documentWorkspace.get().missingChange).toMatchObject({ kind: 'rename', paths: ['flow.yaml'] })
    expect(deps.layout.loadLayout).toHaveBeenCalledTimes(1)
  })

  it('declines definition-only external rename migration for an active canonical pair', async () => {
    const { deps, watcher } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    const opened = await controller.activate('workspace', pairedEntry('flow.yaml'), contract)
    const moved = {
      ...read('renamed.yaml', opened!.definition.text),
      sha256: opened!.definition.diskHash!,
    }

    await watcher()?.({
      event: { paths: ['flow.yaml', 'renamed.yaml'], kind: 'rename' },
      files: [moved],
    })

    expect($documentSession.get().pair).toMatchObject({
      definition: { path: 'flow.yaml' },
      companion: { path: 'flow.hermes.yaml' },
    })
    expect($documentWorkspace.get().missingChange).toMatchObject({ kind: 'rename', paths: ['flow.yaml'] })
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

  it('neutralizes worker callbacks before awaiting asynchronous teardown flushes', async () => {
    let publish: ((analysis: DocumentAnalysis) => void) | undefined
    let fail: ((message: string) => void) | undefined
    let releaseFlush: (() => void) | undefined
    const client = { schedule: vi.fn(), dispose: vi.fn() }
    const { deps } = dependencies({
      createAnalysisClient: vi.fn((onAnalysis, onError) => {
        publish = onAnalysis
        fail = onError
        return client
      }),
      recoveryDrafts: {
        changed: vi.fn(),
        close: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseFlush = resolve
            }),
        ),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    const disposing = controller.dispose()
    await vi.waitFor(() => expect(releaseFlush).toBeDefined())

    expect(client.dispose).toHaveBeenCalledOnce()
    publish?.({ ...createDocumentRevision(opened!, digest), issues: [], structurallyValid: true })
    fail?.('late worker failure')
    expect($documentSession.get().analysis).toBeNull()
    expect($documentWorkspace.get().analysisError).toBeNull()

    releaseFlush?.()
    await disposing
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

  it('persists dirty recovery under the renamed identity before discarding the old draft', async () => {
    const { deps } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    controller.changed(editDocumentText(opened!, 'definition', 'name: dirty\n'))

    await controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)

    expect(deps.recovery.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow:workspace:renamed.yaml',
        definition: expect.objectContaining({ path: 'renamed.yaml', text: 'name: dirty\n' }),
      }),
    )
    expect(vi.mocked(deps.recovery.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.recovery.discard).mock.invocationCallOrder[0]!,
    )
  })

  it('retains the old recovery draft when renamed-identity persistence fails', async () => {
    const { deps } = dependencies({
      recovery: {
        save: vi.fn(async () => Promise.reject(new Error('recovery write failed'))),
        list: vi.fn(async () => []),
        discard: vi.fn(),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    controller.changed(editDocumentText(opened!, 'definition', 'name: dirty\n'))

    await expect(controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)).rejects.toThrow(
      'recovery write failed',
    )
    expect(deps.recovery.discard).not.toHaveBeenCalledWith('workflow:workspace:flow.yaml')
    expect($documentSession.get().pair?.definition.path).toBe('renamed.yaml')
  })

  it('does not replace B pending recovery when app-driven rename persistence finishes late', async () => {
    let releaseSave: (() => void) | undefined
    const { deps } = dependencies({
      recovery: {
        save: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseSave = resolve
            }),
        ),
        list: vi.fn(async () => []),
        discard: vi.fn(),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('a.yaml'), contract)
    controller.changed(editDocumentText(opened!, 'definition', 'name: dirty\n'))
    const renaming = controller.renameActivePair('workspace', 'a.yaml', 'renamed.yaml', false)
    await vi.waitFor(() => expect(releaseSave).toBeDefined())
    await controller.activate('workspace', entry('b.yaml'), contract)
    vi.mocked(deps.recoveryDrafts.changed).mockClear()

    releaseSave?.()
    await renaming

    expect(deps.recoveryDrafts.changed).not.toHaveBeenCalled()
    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
  })

  it('does not schedule renamed recovery after teardown starts during persistence', async () => {
    let releaseSave: (() => void) | undefined
    const { deps } = dependencies({
      recovery: {
        save: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseSave = resolve
            }),
        ),
        list: vi.fn(async () => []),
        discard: vi.fn(),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    controller.changed(editDocumentText(opened!, 'definition', 'name: dirty\n'))
    const renaming = controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)
    await vi.waitFor(() => expect(releaseSave).toBeDefined())
    await controller.dispose()
    vi.mocked(deps.recoveryDrafts.changed).mockClear()

    releaseSave?.()
    await renaming

    expect(deps.recoveryDrafts.changed).not.toHaveBeenCalled()
  })

  it('does not replace B pending recovery when external rename persistence finishes late', async () => {
    let releaseSave: (() => void) | undefined
    const { deps, watcher } = dependencies({
      recovery: {
        save: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseSave = resolve
            }),
        ),
        list: vi.fn(async () => []),
        discard: vi.fn(),
      },
    })
    const controller = new DocumentWorkspaceController(deps)
    await controller.start()
    const opened = await controller.activate('workspace', entry('a.yaml'), contract)
    controller.changed(editDocumentText(opened!, 'definition', 'name: dirty\n'))
    const moved = { ...read('renamed.yaml', opened!.definition.text), sha256: opened!.definition.diskHash! }
    const migrating = watcher()?.({
      event: { paths: ['a.yaml', 'renamed.yaml'], kind: 'rename' },
      files: [moved],
    })
    await vi.waitFor(() => expect(releaseSave).toBeDefined())
    await controller.activate('workspace', entry('b.yaml'), contract)
    vi.mocked(deps.recoveryDrafts.changed).mockClear()

    releaseSave?.()
    await migrating

    expect(deps.recoveryDrafts.changed).not.toHaveBeenCalled()
    expect($documentSession.get().pair?.definition.path).toBe('b.yaml')
  })

  it('rebases undo history onto the renamed workflow identity', async () => {
    const { deps } = dependencies()
    const controller = new DocumentWorkspaceController(deps)
    const opened = await controller.activate('workspace', entry('flow.yaml'), contract)
    const edited = editDocumentText(opened!, 'definition', 'name: edited\n')
    historyStore.set(
      recordTransaction(createHistoryState(), {
        mutation: { type: 'replace-document', document: 'definition', text: 'name: edited\n' },
        label: 'Replace definition YAML',
        workflowId: opened!.workflowId,
        pairGeneration: opened!.generation,
        before: { definition: opened!.definition.text, companion: null },
        after: { definition: edited.definition.text, companion: null },
        beforeRevisions: { definition: opened!.definition.revision, companion: null },
        afterRevisions: { definition: edited.definition.revision, companion: null },
        selection: { document: 'definition' },
      }),
    )
    controller.changed(edited)
    await controller.renameActivePair('workspace', 'flow.yaml', 'renamed.yaml', false)

    const undo = undoTransaction(historyStore.get(), $documentSession.get().pair!)
    expect(undo).toMatchObject({ ok: true, pair: { definition: { text: opened!.definition.text } } })
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

  it('confirms an already-created companion as saved and cancels recovery', async () => {
    let publish: ((analysis: DocumentAnalysis) => void) | undefined
    const { deps } = dependencies({
      createAnalysisClient: vi.fn((onAnalysis) => {
        publish = onAnalysis
        return { schedule: vi.fn(), dispose: vi.fn() }
      }),
    })
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', entry('flow.yaml'), contract)
    await controller.companionCreated('flow.yaml', 'flow.hermes.yaml')
    const created = $documentSession.get().pair!

    expect(created.savedGeneration).toBe(created.generation)
    expect(isDocumentPairDirty(created)).toBe(false)
    expect(deps.recoveryDrafts.changed).toHaveBeenLastCalledWith(created)

    publish?.({ ...createDocumentRevision(created, digest), issues: [], structurallyValid: true })
    const outcome = await controller.save()
    expect(outcome).toMatchObject({
      status: 'saved',
      results: { definition: { status: 'unchanged' }, companion: { status: 'unchanged' } },
    })
    expect(deps.write).not.toHaveBeenCalled()
    expect(deps.trash).not.toHaveBeenCalled()
    expect(deps.recovery.discard).toHaveBeenCalledWith(created.workflowId)
  })

  it('confirms an already-removed companion as saved without scheduling a second disk removal', async () => {
    let publish: ((analysis: DocumentAnalysis) => void) | undefined
    const { deps } = dependencies({
      createAnalysisClient: vi.fn((onAnalysis) => {
        publish = onAnalysis
        return { schedule: vi.fn(), dispose: vi.fn() }
      }),
    })
    const controller = new DocumentWorkspaceController(deps)
    await controller.activate('workspace', pairedEntry('flow.yaml'), contract)
    await controller.companionRemoved('flow.hermes.yaml')
    const removed = $documentSession.get().pair!

    expect(removed.companion).toBeNull()
    expect(removed.savedGeneration).toBe(removed.generation)
    expect(isDocumentPairDirty(removed)).toBe(false)
    expect(deps.recoveryDrafts.changed).toHaveBeenLastCalledWith(removed)

    publish?.({ ...createDocumentRevision(removed, digest), issues: [], structurallyValid: true })
    const outcome = await controller.save()
    expect(outcome).toMatchObject({
      status: 'saved',
      results: { definition: { status: 'unchanged' }, companion: null },
    })
    expect(deps.trash).not.toHaveBeenCalled()
    expect(deps.recovery.discard).toHaveBeenCalledWith(removed.workflowId)
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
