import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkspaceTrashRequest } from '$src/lib/native/types'
import type { WorkspaceFileEntry } from '$src/lib/workspace/types'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import type { ExportYamlFile } from './workspace-actions'
import { createWorkspaceActions, type WorkspaceActionsNative } from './workspace-actions'
import { workspace } from '$src/stores/workspace'

const digest = `sha256:${'1'.repeat(64)}` as const

function field(id: string, fieldPath: string): FieldDescriptor {
  return {
    id,
    label: id,
    description: id,
    field_path: fieldPath,
    applicability: { profiles: ['hermes-legacy'], documents: ['definition'], node_kinds: ['command'] },
    widget: 'text',
    section: 'general',
    order: 1,
    status: 'supported',
    examples: [],
  }
}

const commandKind: NodeKindDescriptor = {
  ...field('command', 'nodes[].command'),
  fields: [field('command-value', 'nodes[].command')],
}

const contract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'hermes-legacy',
  normalizer_version: 1,
  contract_digest: digest,
  definition_schema: {
    type: 'object',
    required: ['name', 'description', 'nodes'],
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      nodes: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'command'],
          properties: { id: { type: 'string' }, depends_on: { type: 'array' }, command: { type: 'string' } },
        },
      },
    },
  },
  sidecar_schema: {
    type: 'object',
    properties: {
      language_compatibility: { enum: ['hermes-legacy'] },
      runtime: { type: 'string' },
    },
    additionalProperties: false,
  },
  node_kinds: [commandKind],
  semantic_rules: [
    {
      id: 'dag',
      label: 'DAG',
      description: 'DAG',
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

const archonContract: AuthoringContract = {
  ...contract,
  profile: 'archon-2026-07',
  sidecar_schema: {
    type: 'object',
    properties: { language_compatibility: { enum: ['archon-2026-07'] } },
  },
  node_kinds: contract.node_kinds.map((kind) => ({
    ...kind,
    applicability: { ...kind.applicability, profiles: ['archon-2026-07'] },
    fields: kind.fields.map((descriptor) => ({
      ...descriptor,
      applicability: { ...descriptor.applicability, profiles: ['archon-2026-07'] },
    })),
  })),
  semantic_rules: contract.semantic_rules.map((rule) => ({
    ...rule,
    applicability: { ...rule.applicability, profiles: ['archon-2026-07'] },
  })),
}

function validAnalysis(): DocumentAnalysis {
  return {
    workflowId: 'flow',
    pairGeneration: 0,
    definitionPath: 'flow.yaml',
    companionPath: null,
    definitionRevision: 0,
    companionRevision: null,
    contractDigest: digest,
    issues: [],
    structurallyValid: true,
  }
}

function entry(relativePath: string): WorkspaceFileEntry {
  return { relativePath, kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false }
}

function createNative(): WorkspaceActionsNative {
  const disk = new Map<string, string>([
    ['flow.yaml', '# keep\nname: Flow\ndescription: Existing\nnodes:\n  - id: first\n    command: echo\n'],
    ['flow.hermes.yaml', 'language_compatibility: hermes-legacy\n'],
    ['legacy.yaml', 'name: Legacy\ndescription: Existing\nnodes:\n  - id: first\n    command: echo\n'],
  ])
  return {
    chooseWorkspaceFolder: vi.fn(async () => '/selected'),
    chooseImportDefinition: vi.fn(async () => '/outside/import.yaml'),
    chooseExportDirectory: vi.fn(async () => '/exports'),
    workspaceSetRoot: vi.fn(async (rootPath) => ({ workspaceId: 'workspace', rootPath })),
    workspaceScan: vi.fn(async () => [...disk.keys()].map(entry)),
    workspaceRead: vi.fn(async (relativePath) => {
      const text = disk.get(relativePath)
      if (text === undefined) throw new Error('missing')
      return {
        relativePath,
        text,
        sha256: relativePath.padEnd(64, 'a').slice(0, 64),
        size: text.length,
        modifiedAt: '0',
        readOnly: false,
      }
    }),
    workspaceWrite: vi.fn(async ({ relativePath, text }) => {
      if (disk.has(relativePath)) throw Object.assign(new Error('exists'), { code: 'external_revision_conflict' })
      disk.set(relativePath, text)
      return { relativePath, sha256: 'a'.repeat(64), size: text.length, modifiedAt: '0' }
    }),
    workspaceRenamePair: vi.fn(async ({ sourceDefinition, destinationDefinition }) => {
      const sourceCompanion = sourceDefinition.replace(/\.(?:yaml|yml)$/, '.hermes.yaml')
      const destinationCompanion = destinationDefinition.replace(/\.(?:yaml|yml)$/, '.hermes.yaml')
      disk.set(destinationDefinition, disk.get(sourceDefinition) ?? '')
      disk.delete(sourceDefinition)
      if (disk.has(sourceCompanion)) {
        disk.set(destinationCompanion, disk.get(sourceCompanion) ?? '')
        disk.delete(sourceCompanion)
      }
      return { paths: [destinationDefinition, destinationCompanion], results: [] }
    }),
    workspaceTrashPaths: vi.fn(async (requests: readonly WorkspaceTrashRequest[]) => {
      for (const request of requests) disk.delete(request.relativePath)
      return { results: requests.map(({ relativePath }) => ({ relativePath, status: 'trashed' as const })) }
    }),
    externalReadYaml: vi.fn(async (path) => {
      if (path.endsWith('.hermes.yaml')) throw Object.assign(new Error('missing'), { code: 'path_not_found' })
      return { path, text: 'name: Imported\ndescription: Valid\nnodes:\n  - id: first\n    command: hi\n' }
    }),
    externalExportYamlPair: vi.fn(async ({ files }: { files: readonly ExportYamlFile[] }) => ({
      paths: files.map(({ fileName }) => `/exports/${fileName}`),
    })),
    revokeExportGrant: vi.fn(async () => undefined),
    recentWorkspacesLoad: vi.fn(async () => ''),
    recentWorkspacesSave: vi.fn(async () => undefined),
    pathAvailable: vi.fn(async () => true),
    startupPaths: vi.fn(async () => []),
  }
}

describe('workspace actions', () => {
  let native: WorkspaceActionsNative
  let activate = vi.fn<(entry: WorkflowPairEntry) => Promise<void>>()
  let openDraft = vi.fn<(pair: WorkflowPairText, contract: AuthoringContract | null) => Promise<void>>()
  let closeDocument = vi.fn<(workflowId: string) => Promise<void>>()
  let currentDocument = vi.fn<() => WorkflowPairText | null>()
  let flushRecovery = vi.fn<(pair: WorkflowPairText) => Promise<void>>()
  let closeWorkspace = vi.fn<() => Promise<void>>()
  let renameDocument =
    vi.fn<(workspaceId: string, from: string, to: string, companionMoved: boolean) => Promise<void>>()
  let companionCreated = vi.fn<(definitionPath: string, companionPath: string) => Promise<void>>()
  let companionRemoved = vi.fn<(companionPath: string) => Promise<void>>()
  let recoverDraft = vi.fn<(pair: WorkflowPairText) => Promise<void>>()

  beforeEach(() => {
    native = createNative()
    activate = vi.fn<(entry: WorkflowPairEntry) => Promise<void>>(async () => undefined)
    openDraft = vi.fn<(pair: WorkflowPairText, contract: AuthoringContract | null) => Promise<void>>(
      async () => undefined,
    )
    closeDocument = vi.fn<(workflowId: string) => Promise<void>>(async () => undefined)
    currentDocument = vi.fn<() => WorkflowPairText | null>(() => null)
    flushRecovery = vi.fn<(pair: WorkflowPairText) => Promise<void>>(async () => undefined)
    closeWorkspace = vi.fn<() => Promise<void>>(async () => undefined)
    renameDocument = vi.fn<(workspaceId: string, from: string, to: string, companionMoved: boolean) => Promise<void>>(
      async () => undefined,
    )
    companionCreated = vi.fn<(definitionPath: string, companionPath: string) => Promise<void>>(async () => undefined)
    companionRemoved = vi.fn<(companionPath: string) => Promise<void>>(async () => undefined)
    recoverDraft = vi.fn<(pair: WorkflowPairText) => Promise<void>>(async () => undefined)
  })

  function actions() {
    return createWorkspaceActions({
      native,
      contracts: [contract],
      analyze: vi.fn(async () => validAnalysis()),
      activate,
      openDraft,
      closeDocument,
      currentDocument,
      flushRecovery,
      closeWorkspace,
      renameDocument,
      companionCreated,
      companionRemoved,
      recoverDraft,
      now: () => '2026-07-25T12:00:00.000Z',
    })
  }

  it('changes the scoped root only after selection and leaves it unchanged when cancelled', async () => {
    const api = actions()
    await expect(api.openWorkspace()).resolves.toMatchObject({ rootPath: '/selected' })
    expect(native.workspaceSetRoot).toHaveBeenCalledWith('/selected')
    expect(closeWorkspace).toHaveBeenCalledBefore(vi.mocked(native.workspaceSetRoot))

    vi.mocked(native.chooseWorkspaceFolder).mockResolvedValueOnce(null)
    await expect(api.openWorkspace()).resolves.toBeNull()
    expect(native.workspaceSetRoot).toHaveBeenCalledTimes(1)
  })

  function sameProfileActions() {
    const active = {
      ...contract,
      contract_digest: `sha256:${'f'.repeat(64)}` as const,
      sidecar_schema: {
        type: 'object',
        properties: {
          language_compatibility: { enum: ['hermes-legacy'] },
          runtime: { type: 'string' },
          active_marker: { type: 'string' },
        },
        additionalProperties: false,
      },
    }
    const api = createWorkspaceActions({
      native,
      contracts: [contract, active],
      activeContract: (profile) => (profile === 'hermes-legacy' ? active : undefined),
      analyze: async ({ contract: candidate }) => ({
        ...validAnalysis(),
        contractDigest: candidate.contract_digest,
        structurallyValid: candidate.contract_digest === active.contract_digest,
      }),
      activate,
      openDraft,
      closeDocument,
      currentDocument,
      flushRecovery,
      closeWorkspace,
      renameDocument,
      companionCreated,
      companionRemoved,
      recoverDraft,
    })
    return api
  }

  it('creates with the active same-profile contract when lexical digest order differs', async () => {
    const api = sameProfileActions()

    await expect(
      api.createWorkflow({
        name: 'Active contract',
        description: 'Uses the selected version',
        profile: 'hermes-legacy',
        firstNodeId: 'first',
        firstNodeKind: 'command',
        firstNodeValues: { 'command-value': 'echo' },
      }),
    ).resolves.toMatchObject({ status: 'completed' })
  })

  it('imports with the unchanged active same-profile contract when lexical digest order differs', async () => {
    const api = sameProfileActions()

    await expect(api.importWorkflow({ profile: 'hermes-legacy' })).resolves.toMatchObject({ status: 'imported' })
  })

  it('creates a companion with the active same-profile contract when lexical digest order differs', async () => {
    const api = sameProfileActions()

    await expect(
      api.createCompanion({
        definitionPath: 'legacy.yaml',
        profile: 'hermes-legacy',
        metadata: { active_marker: 'selected' },
      }),
    ).resolves.toBe('legacy.hermes.yaml')
    await expect(native.workspaceRead('legacy.hermes.yaml')).resolves.toMatchObject({
      text: expect.stringContaining('active_marker: selected'),
    })
  })

  it('blocks ambiguous same-profile creation before writing when no active contract is selected', async () => {
    const active = { ...contract, contract_digest: `sha256:${'f'.repeat(64)}` as const }
    const api = createWorkspaceActions({
      native,
      contracts: [contract, active],
      activeContract: () => undefined,
      analyze: async () => validAnalysis(),
      activate,
      openDraft,
      closeDocument,
      currentDocument,
      flushRecovery,
      closeWorkspace,
      renameDocument,
      companionCreated,
      companionRemoved,
      recoverDraft,
    })

    await expect(
      api.createWorkflow({
        name: 'Ambiguous',
        description: 'Must not select lexical first',
        profile: 'hermes-legacy',
        firstNodeId: 'first',
        firstNodeKind: 'command',
        firstNodeValues: { 'command-value': 'echo' },
      }),
    ).rejects.toMatchObject({ code: 'contract_unavailable' })
    expect(native.workspaceWrite).not.toHaveBeenCalled()
  })

  it('aborts a root switch when the active lifecycle cannot flush and close', async () => {
    closeWorkspace.mockRejectedValueOnce(new Error('recovery flush failed'))
    await expect(actions().openWorkspace('/other')).rejects.toThrow('recovery flush failed')
    expect(native.workspaceSetRoot).not.toHaveBeenCalled()
  })

  it('serializes root changes so the latest open request wins after an older native call resolves', async () => {
    let releaseSlow: ((value: { workspaceId: string; rootPath: string }) => void) | undefined
    vi.mocked(native.workspaceSetRoot).mockImplementation((rootPath) =>
      rootPath === '/slow'
        ? new Promise((resolve) => (releaseSlow = resolve))
        : Promise.resolve({ workspaceId: 'fast', rootPath }),
    )
    const api = actions()
    const slow = api.openWorkspace('/slow')
    await vi.waitFor(() => expect(native.workspaceSetRoot).toHaveBeenCalledWith('/slow'))
    const fast = api.openWorkspace('/fast')
    releaseSlow?.({ workspaceId: 'slow', rootPath: '/slow' })

    await expect(slow).resolves.toBeNull()
    await expect(fast).resolves.toMatchObject({ workspaceId: 'fast', rootPath: '/fast' })
    expect(workspace.get()).toMatchObject({ id: 'fast', displayName: 'fast' })
    expect(native.recentWorkspacesSave).toHaveBeenCalledTimes(1)
    expect(vi.mocked(native.recentWorkspacesSave).mock.calls[0]?.[0]).toContain('/fast')
  })

  it('awaits activation inside the root queue so a newer root cannot replace native scope mid-open', async () => {
    let releaseActivation: (() => void) | undefined
    let activationReleased = false
    activate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseActivation = () => {
            activationReleased = true
            resolve()
          }
        }),
    )
    vi.mocked(native.workspaceSetRoot).mockImplementation(async (rootPath) => {
      if (rootPath === '/new') expect(activationReleased).toBe(true)
      return { workspaceId: rootPath.slice(1), rootPath }
    })
    const api = actions()
    const old = api.handleExternalPath('/old/flow.yaml', {
      kind: 'yaml',
      path: '/old/flow.yaml',
      rootPath: '/old',
      relativePath: 'flow.yaml',
    })
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1))
    const newer = api.handleExternalPath('/new/legacy.yaml', {
      kind: 'yaml',
      path: '/new/legacy.yaml',
      rootPath: '/new',
      relativePath: 'legacy.yaml',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(native.workspaceSetRoot).not.toHaveBeenCalledWith('/new')
    releaseActivation?.()
    await Promise.all([old, newer])

    expect(vi.mocked(native.workspaceSetRoot).mock.calls.map(([root]) => root)).toEqual(['/old', '/new'])
    expect(activate).toHaveBeenLastCalledWith(expect.objectContaining({ definitionPath: 'legacy.yaml' }))
    expect(workspace.get()).toMatchObject({ id: 'new', displayName: 'new' })
  })

  it('requires all contract-driven first-write values and creates valid YAML only once complete', async () => {
    const api = actions()
    await expect(
      api.createWorkflow({
        name: '',
        description: '',
        profile: 'hermes-legacy',
        firstNodeId: '',
        firstNodeKind: '',
        firstNodeValues: {},
      }),
    ).rejects.toMatchObject({ code: 'new_workflow_incomplete' })
    expect(native.workspaceWrite).not.toHaveBeenCalled()

    await api.createWorkflow({
      name: 'Release',
      description: 'Ship it',
      profile: 'hermes-legacy',
      firstNodeId: 'first',
      firstNodeKind: 'command',
      firstNodeValues: { 'command-value': 'echo ready' },
    })
    expect(native.workspaceWrite).toHaveBeenCalledTimes(1)
    expect(native.workspaceWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: 'release.yaml',
        expectedCurrentHash: null,
        text: expect.stringContaining('command: echo ready'),
      }),
    )
  })

  it('duplicates exact pair text under a collision-safe basename', async () => {
    vi.mocked(native.workspaceScan).mockResolvedValueOnce([
      entry('flow.yaml'),
      entry('flow.hermes.yaml'),
      entry('flow-copy.yaml'),
    ])
    await actions().duplicateWorkflow({ definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' })
    const writes = vi.mocked(native.workspaceWrite).mock.calls.map(([request]) => request)
    expect(writes).toEqual([
      expect.objectContaining({ relativePath: 'flow-copy-2.yaml', text: expect.stringContaining('# keep') }),
      expect.objectContaining({
        relativePath: 'flow-copy-2.hermes.yaml',
        text: 'language_compatibility: hermes-legacy\n',
      }),
    ])
  })

  it('renames both canonical files and migrates document and layout identities after native success', async () => {
    const outcome = await actions().renameWorkflow({
      workspaceId: 'workspace',
      definitionPath: 'flow.yaml',
      destinationDefinition: 'archive/renamed.yaml',
    })
    expect(outcome.status).toBe('completed')
    expect(native.workspaceRenamePair).toHaveBeenCalledWith({
      sourceDefinition: 'flow.yaml',
      destinationDefinition: 'archive/renamed.yaml',
    })
    expect(renameDocument).toHaveBeenCalledWith('workspace', 'flow.yaml', 'archive/renamed.yaml', true)
  })

  it('returns a structured partial rename outcome when post-native lifecycle migration fails', async () => {
    renameDocument.mockRejectedValueOnce(new Error('layout flush failed'))

    const outcome = await actions().renameWorkflow({
      workspaceId: 'workspace',
      definitionPath: 'flow.yaml',
      destinationDefinition: 'renamed.yaml',
    })

    expect(outcome).toMatchObject({
      status: 'partial',
      paths: ['renamed.yaml', 'renamed.hermes.yaml'],
      results: [
        expect.objectContaining({
          relativePath: 'renamed.yaml',
          status: 'partial',
          errorCode: 'document_lifecycle_migration_failed',
          message: 'layout flush failed',
        }),
      ],
    })
  })

  it('creates only contract-supported companion metadata and previews/removes exactly that file', async () => {
    await actions().createCompanion({
      definitionPath: 'legacy.yaml',
      profile: 'hermes-legacy',
      metadata: { runtime: 'local', secret: 'drop' },
    })
    expect(native.workspaceWrite).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'legacy.hermes.yaml', text: expect.stringContaining('runtime: local') }),
    )
    expect(vi.mocked(native.workspaceWrite).mock.calls[0]?.[0].text).not.toContain('secret')
    expect(companionCreated).toHaveBeenCalledWith('legacy.yaml', 'legacy.hermes.yaml')

    const preview = actions().previewRemoveCompanion({
      definitionPath: 'flow.yaml',
      companionPath: 'flow.hermes.yaml',
      selectedProfile: 'hermes-legacy',
    })
    expect(preview).toEqual({
      paths: ['flow.hermes.yaml'],
      currentProfile: 'hermes-legacy',
      effectiveProfileAfter: 'hermes-legacy',
    })
    await actions().removeCompanion({ companionPath: 'flow.hermes.yaml', expectedHash: 'f'.repeat(64) })
    expect(native.workspaceTrashPaths).toHaveBeenCalledWith([
      { relativePath: 'flow.hermes.yaml', expectedCurrentHash: 'f'.repeat(64) },
    ])
    expect(companionRemoved).toHaveBeenCalledWith('flow.hermes.yaml')
  })

  it('names and trashes the exact pair, closing only after every path succeeds', async () => {
    currentDocument.mockReturnValue({
      workflowId: 'workspace:flow.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'workspace:flow.yaml:definition',
        kind: 'definition',
        path: 'flow.yaml',
        text: 'dirty',
        revision: 1,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: {
        id: 'workspace:flow.yaml:companion',
        kind: 'companion',
        path: 'flow.hermes.yaml',
        text: 'dirty',
        revision: 1,
        savedRevision: 0,
        diskHash: 'b'.repeat(64),
      },
    })
    const api = actions()
    expect(api.previewTrashWorkflow({ definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' })).toEqual({
      paths: ['flow.yaml', 'flow.hermes.yaml'],
    })
    await api.trashWorkflow({
      workflowId: 'workspace:flow.yaml',
      definitionPath: 'flow.yaml',
      definitionHash: 'a'.repeat(64),
      companionPath: 'flow.hermes.yaml',
      companionHash: 'b'.repeat(64),
    })
    expect(flushRecovery).toHaveBeenCalledTimes(1)
    expect(closeDocument).toHaveBeenCalledWith('workspace:flow.yaml')

    vi.mocked(native.workspaceTrashPaths).mockResolvedValueOnce({
      results: [{ relativePath: 'flow.yaml', status: 'failed', errorCode: 'conflict' }],
    })
    await expect(
      api.trashWorkflow({
        workflowId: 'workspace:flow.yaml',
        definitionPath: 'flow.yaml',
        definitionHash: 'a'.repeat(64),
        companionPath: null,
        companionHash: null,
      }),
    ).rejects.toMatchObject({ code: 'workspace_trash_partial' })
    expect(closeDocument).toHaveBeenCalledTimes(1)
    expect(flushRecovery).toHaveBeenCalledTimes(1)
  })

  it('does not flush or close dirty workflow A when trashing workflow B', async () => {
    currentDocument.mockReturnValue({
      workflowId: 'workspace:a.yaml',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'workspace:a.yaml:definition',
        kind: 'definition',
        path: 'a.yaml',
        text: 'dirty',
        revision: 1,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    })

    await actions().trashWorkflow({
      workflowId: 'workspace:b.yaml',
      definitionPath: 'flow.yaml',
      definitionHash: 'a'.repeat(64),
      companionPath: null,
      companionHash: null,
    })

    expect(flushRecovery).not.toHaveBeenCalled()
    expect(closeDocument).not.toHaveBeenCalled()
  })

  it('keeps invalid imports as recovery-backed unsaved drafts and copies valid imports exactly', async () => {
    const analyze = vi
      .fn()
      .mockResolvedValueOnce({ ...validAnalysis(), structurallyValid: false })
      .mockResolvedValueOnce(validAnalysis())
    const api = createWorkspaceActions({
      native,
      contracts: [contract],
      analyze,
      activate,
      openDraft,
      closeDocument,
      currentDocument,
      flushRecovery,
      closeWorkspace,
      renameDocument,
      companionCreated,
      companionRemoved,
      recoverDraft,
      now: () => '2026-07-25T12:00:00.000Z',
    })

    await expect(api.importWorkflow({ profile: 'hermes-legacy' })).resolves.toMatchObject({ status: 'draft' })
    expect(openDraft).toHaveBeenCalledWith(
      expect.objectContaining({ definition: expect.objectContaining({ path: 'import.yaml' }) }),
      contract,
    )
    expect(recoverDraft).toHaveBeenCalledTimes(1)
    expect(native.workspaceWrite).not.toHaveBeenCalled()

    await expect(api.importWorkflow({ profile: 'hermes-legacy' })).resolves.toMatchObject({ status: 'imported' })
    expect(native.workspaceWrite).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'import.yaml', text: expect.stringContaining('name: Imported') }),
    )
  })

  it('imports a canonical companion through its one-time grant and preserves both texts exactly', async () => {
    vi.mocked(native.externalReadYaml).mockImplementation(async (path) =>
      path.endsWith('.hermes.yaml')
        ? { path, text: '# companion\nlanguage_compatibility: hermes-legacy\n' }
        : { path, text: '# definition\nname: Imported\ndescription: Valid\nnodes:\n  - id: first\n    command: hi\n' },
    )
    const analyze = vi.fn(async ({ companionText }: { companionText: string | null }) => {
      expect(companionText).toBe('# companion\nlanguage_compatibility: hermes-legacy\n')
      return { ...validAnalysis(), companionRevision: 0 }
    })
    const api = createWorkspaceActions({
      native,
      contracts: [contract],
      analyze,
      activate,
      openDraft,
      closeDocument,
      currentDocument,
      flushRecovery,
      closeWorkspace,
      renameDocument,
      companionCreated,
      companionRemoved,
      recoverDraft,
    })

    await expect(api.importWorkflow({ profile: 'hermes-legacy' })).resolves.toMatchObject({
      status: 'imported',
      definitionPath: 'import.yaml',
      companionPath: 'import.hermes.yaml',
    })
    expect(native.workspaceWrite).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: expect.stringContaining('# definition') }),
    )
    expect(native.workspaceWrite).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: expect.stringContaining('# companion') }),
    )
  })

  it('blocks invalid export, confirms collisions, and exports only the YAML pair', async () => {
    const pair: WorkflowPairText = {
      workflowId: 'flow',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'flow:def',
        kind: 'definition',
        path: 'flow.yaml',
        text: 'definition',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: {
        id: 'flow:comp',
        kind: 'companion',
        path: 'flow.hermes.yaml',
        text: 'companion',
        revision: 0,
        savedRevision: 0,
        diskHash: 'b'.repeat(64),
      },
    }
    await expect(
      actions().exportWorkflow({
        pair,
        analysis: { ...validAnalysis(), structurallyValid: false },
        activeRevision: { ...validAnalysis(), companionRevision: 0 },
        confirmCollision: async () => true,
      }),
    ).resolves.toMatchObject({ status: 'blocked' })
    expect(native.chooseExportDirectory).not.toHaveBeenCalled()

    vi.mocked(native.externalExportYamlPair).mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'destination_exists' }),
    )
    const confirmCollision = vi.fn(async () => true)
    await actions().exportWorkflow({
      pair,
      analysis: { ...validAnalysis(), companionRevision: 0 },
      activeRevision: { ...validAnalysis(), companionRevision: 0 },
      confirmCollision,
    })
    expect(confirmCollision).toHaveBeenCalledWith(['/exports/flow.yaml', '/exports/flow.hermes.yaml'])
    expect(native.externalExportYamlPair).toHaveBeenLastCalledWith({
      directoryPath: '/exports',
      overwrite: true,
      files: [
        { fileName: 'flow.yaml', text: 'definition' },
        { fileName: 'flow.hermes.yaml', text: 'companion' },
      ],
    })
  })

  it('revokes the pending native export grant when collision confirmation is cancelled', async () => {
    const pair: WorkflowPairText = {
      workflowId: 'flow',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'flow:def',
        kind: 'definition',
        path: 'flow.yaml',
        text: 'definition',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    }
    vi.mocked(native.externalExportYamlPair).mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'destination_exists' }),
    )

    await expect(
      actions().exportWorkflow({
        pair,
        analysis: validAnalysis(),
        activeRevision: validAnalysis(),
        confirmCollision: async () => false,
      }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    expect(native.revokeExportGrant).toHaveBeenCalledWith('/exports')
    expect(native.externalExportYamlPair).toHaveBeenCalledTimes(1)
  })

  it('revokes the pending native export grant when confirmation UI aborts with an error', async () => {
    const pair: WorkflowPairText = {
      workflowId: 'flow',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'flow:def',
        kind: 'definition',
        path: 'flow.yaml',
        text: 'definition',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    }
    const aborted = new Error('confirmation UI unmounted')
    vi.mocked(native.externalExportYamlPair).mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'destination_exists' }),
    )

    await expect(
      actions().exportWorkflow({
        pair,
        analysis: validAnalysis(),
        activeRevision: validAnalysis(),
        confirmCollision: async () => Promise.reject(aborted),
      }),
    ).rejects.toBe(aborted)
    expect(native.revokeExportGrant).toHaveBeenCalledWith('/exports')
  })

  it('accepts startup folders and YAML files through the same root and selection flow and rejects other arguments', async () => {
    vi.mocked(native.startupPaths).mockResolvedValueOnce([
      { kind: 'directory', path: '/startup' },
      { kind: 'yaml', path: '/startup/flow.yaml' },
    ])
    await actions().handleStartupPaths()
    expect(native.workspaceSetRoot).toHaveBeenCalledWith('/startup')
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flow.yaml' }))
  })

  it('returns explicit per-path partial state and recovery when duplicate companion write fails', async () => {
    vi.mocked(native.workspaceWrite)
      .mockResolvedValueOnce({ relativePath: 'flow-copy.yaml', sha256: 'a'.repeat(64), size: 10, modifiedAt: '0' })
      .mockRejectedValueOnce(Object.assign(new Error('companion failed'), { code: 'workspace_write_failed' }))

    await expect(
      actions().duplicateWorkflow({ definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' }),
    ).resolves.toMatchObject({
      status: 'partial',
      results: [
        { path: 'flow-copy.yaml', status: 'written' },
        { path: 'flow-copy.hermes.yaml', status: 'failed', errorCode: 'workspace_write_failed' },
      ],
      recoveryRetained: true,
    })
    expect(recoverDraft).toHaveBeenCalledTimes(1)
  })

  it('returns explicit per-path partial state and recovery when New Workflow companion write fails', async () => {
    vi.mocked(native.workspaceWrite)
      .mockResolvedValueOnce({ relativePath: 'release.yaml', sha256: 'a'.repeat(64), size: 10, modifiedAt: '0' })
      .mockRejectedValueOnce(Object.assign(new Error('companion failed'), { code: 'workspace_write_failed' }))
    const api = createWorkspaceActions({
      native,
      contracts: [archonContract],
      analyze: vi.fn(async () => ({ ...validAnalysis(), contractDigest: archonContract.contract_digest })),
      activate,
      openDraft,
      closeDocument,
      currentDocument,
      flushRecovery,
      closeWorkspace,
      renameDocument,
      companionCreated,
      companionRemoved,
      recoverDraft,
    })

    await expect(
      api.createWorkflow({
        name: 'Release',
        description: 'Ship it',
        profile: 'archon-2026-07',
        firstNodeId: 'first',
        firstNodeKind: 'command',
        firstNodeValues: { 'command-value': 'echo ready' },
      }),
    ).resolves.toMatchObject({
      status: 'partial',
      results: [
        { path: 'release.yaml', status: 'written' },
        { path: 'release.hermes.yaml', status: 'failed', errorCode: 'workspace_write_failed' },
      ],
      recoveryRetained: true,
    })
    expect(recoverDraft).toHaveBeenCalledTimes(1)
  })

  it('returns explicit per-path partial state and recovery when import companion write fails', async () => {
    vi.mocked(native.externalReadYaml).mockImplementation(async (path) =>
      path.endsWith('.hermes.yaml')
        ? { path, text: 'language_compatibility: hermes-legacy\n' }
        : { path, text: 'name: Imported\ndescription: Valid\nnodes:\n  - id: first\n    command: hi\n' },
    )
    vi.mocked(native.workspaceWrite)
      .mockResolvedValueOnce({ relativePath: 'import.yaml', sha256: 'a'.repeat(64), size: 10, modifiedAt: '0' })
      .mockRejectedValueOnce(Object.assign(new Error('companion failed'), { code: 'workspace_write_failed' }))

    await expect(actions().importWorkflow({ profile: 'hermes-legacy' })).resolves.toMatchObject({
      status: 'partial',
      results: [
        { path: 'import.yaml', status: 'written' },
        { path: 'import.hermes.yaml', status: 'failed', errorCode: 'workspace_write_failed' },
      ],
      recoveryRetained: true,
    })
    expect(recoverDraft).toHaveBeenCalledTimes(1)
  })

  it('rejects a companion without its hash before mutating Trash and retains exact unexpected outcomes', async () => {
    const api = actions()
    await expect(
      api.trashWorkflow({
        workflowId: 'workspace:flow.yaml',
        definitionPath: 'flow.yaml',
        definitionHash: 'a'.repeat(64),
        companionPath: 'flow.hermes.yaml',
        companionHash: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_trash_request', paths: ['flow.yaml', 'flow.hermes.yaml'] })
    expect(native.workspaceTrashPaths).not.toHaveBeenCalled()

    vi.mocked(native.workspaceTrashPaths).mockResolvedValueOnce({
      results: [
        { relativePath: 'flow.yaml', status: 'trashed' },
        { relativePath: 'unexpected.yaml', status: 'failed', errorCode: 'unexpected' },
      ],
    })
    await expect(
      api.trashWorkflow({
        workflowId: 'workspace:flow.yaml',
        definitionPath: 'flow.yaml',
        definitionHash: 'a'.repeat(64),
        companionPath: null,
        companionHash: null,
      }),
    ).rejects.toMatchObject({
      code: 'workspace_trash_partial',
      pathResults: expect.arrayContaining([expect.objectContaining({ relativePath: 'unexpected.yaml' })]),
    })
    expect(closeDocument).not.toHaveBeenCalled()
  })

  it('rejects export analysis stale against an independently supplied active revision', async () => {
    const pair: WorkflowPairText = {
      workflowId: 'flow',
      generation: 0,
      savedGeneration: 0,
      definition: {
        id: 'flow:def',
        kind: 'definition',
        path: 'flow.yaml',
        text: 'definition',
        revision: 0,
        savedRevision: 0,
        diskHash: 'a'.repeat(64),
      },
      companion: null,
    }
    await expect(
      actions().exportWorkflow({
        pair,
        analysis: validAnalysis(),
        activeRevision: { ...validAnalysis(), contractDigest: `sha256:${'9'.repeat(64)}` },
        confirmCollision: async () => true,
      }),
    ).resolves.toMatchObject({ status: 'blocked', reason: 'analysis_missing_or_stale' })
    expect(native.chooseExportDirectory).not.toHaveBeenCalled()
  })

  it('activates a .yml definition when startup selects its actual canonical companion path', async () => {
    vi.mocked(native.startupPaths).mockResolvedValueOnce([
      {
        kind: 'yaml',
        path: '/startup/flow.hermes.yaml',
        rootPath: '/startup',
        relativePath: 'flow.hermes.yaml',
      },
    ])
    vi.mocked(native.workspaceScan).mockResolvedValue([entry('flow.yml'), entry('flow.hermes.yaml')])

    await actions().handleStartupPaths()

    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({ definitionPath: 'flow.yml', companionPath: 'flow.hermes.yaml' }),
    )
  })
})
