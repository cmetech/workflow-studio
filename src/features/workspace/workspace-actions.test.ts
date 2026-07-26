import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract, FieldDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkspaceTrashRequest } from '$src/lib/native/types'
import type { WorkspaceFileEntry } from '$src/lib/workspace/types'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import type { ExportYamlFile } from './workspace-actions'
import { createWorkspaceActions, type WorkspaceActionsNative } from './workspace-actions'

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

function validAnalysis(): DocumentAnalysis {
  return {
    workflowId: 'flow',
    pairGeneration: 0,
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
    recentWorkspacesLoad: vi.fn(async () => ''),
    recentWorkspacesSave: vi.fn(async () => undefined),
    pathAvailable: vi.fn(async () => true),
    startupPaths: vi.fn(async () => []),
  }
}

describe('workspace actions', () => {
  let native: WorkspaceActionsNative
  let activate = vi.fn<(entry: WorkflowPairEntry) => void>()
  let openDraft = vi.fn<(pair: WorkflowPairText) => void>()
  let closeDocument = vi.fn<() => void>()
  let renameDocument = vi.fn<(from: string, to: string) => void>()
  let renameLayout = vi.fn<(workspaceId: string, from: string, to: string) => Promise<void>>()
  let recoverDraft = vi.fn<(pair: WorkflowPairText) => Promise<void>>()

  beforeEach(() => {
    native = createNative()
    activate = vi.fn<(entry: WorkflowPairEntry) => void>()
    openDraft = vi.fn<(pair: WorkflowPairText) => void>()
    closeDocument = vi.fn<() => void>()
    renameDocument = vi.fn<(from: string, to: string) => void>()
    renameLayout = vi.fn<(workspaceId: string, from: string, to: string) => Promise<void>>(async () => undefined)
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
      renameDocument,
      renameLayout,
      recoverDraft,
      now: () => '2026-07-25T12:00:00.000Z',
    })
  }

  it('changes the scoped root only after selection and leaves it unchanged when cancelled', async () => {
    const api = actions()
    await expect(api.openWorkspace()).resolves.toMatchObject({ rootPath: '/selected' })
    expect(native.workspaceSetRoot).toHaveBeenCalledWith('/selected')

    vi.mocked(native.chooseWorkspaceFolder).mockResolvedValueOnce(null)
    await expect(api.openWorkspace()).resolves.toBeNull()
    expect(native.workspaceSetRoot).toHaveBeenCalledTimes(1)
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
    await actions().renameWorkflow({
      workspaceId: 'workspace',
      definitionPath: 'flow.yaml',
      destinationDefinition: 'archive/renamed.yaml',
    })
    expect(native.workspaceRenamePair).toHaveBeenCalledWith({
      sourceDefinition: 'flow.yaml',
      destinationDefinition: 'archive/renamed.yaml',
    })
    expect(renameDocument).toHaveBeenCalledWith('flow.yaml', 'archive/renamed.yaml')
    expect(renameLayout).toHaveBeenCalledWith('workspace', 'flow.yaml', 'archive/renamed.yaml')
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
  })

  it('names and trashes the exact pair, closing only after every path succeeds', async () => {
    const api = actions()
    expect(api.previewTrashWorkflow({ definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' })).toEqual({
      paths: ['flow.yaml', 'flow.hermes.yaml'],
    })
    await api.trashWorkflow({
      definitionPath: 'flow.yaml',
      definitionHash: 'a'.repeat(64),
      companionPath: 'flow.hermes.yaml',
      companionHash: 'b'.repeat(64),
    })
    expect(closeDocument).toHaveBeenCalledTimes(1)

    vi.mocked(native.workspaceTrashPaths).mockResolvedValueOnce({
      results: [{ relativePath: 'flow.yaml', status: 'failed', errorCode: 'conflict' }],
    })
    await expect(
      api.trashWorkflow({
        definitionPath: 'flow.yaml',
        definitionHash: 'a'.repeat(64),
        companionPath: null,
        companionHash: null,
      }),
    ).rejects.toMatchObject({ code: 'workspace_trash_partial' })
    expect(closeDocument).toHaveBeenCalledTimes(1)
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
      renameDocument,
      renameLayout,
      recoverDraft,
      now: () => '2026-07-25T12:00:00.000Z',
    })

    await expect(api.importWorkflow({ profile: 'hermes-legacy' })).resolves.toMatchObject({ status: 'draft' })
    expect(openDraft).toHaveBeenCalledWith(
      expect.objectContaining({ definition: expect.objectContaining({ path: 'import.yaml' }) }),
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
      renameDocument,
      renameLayout,
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
        confirmCollision: async () => true,
      }),
    ).resolves.toMatchObject({ status: 'blocked' })
    expect(native.chooseExportDirectory).not.toHaveBeenCalled()

    vi.mocked(native.externalExportYamlPair).mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'destination_exists' }),
    )
    const confirmCollision = vi.fn(async () => true)
    await actions().exportWorkflow({ pair, analysis: { ...validAnalysis(), companionRevision: 0 }, confirmCollision })
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

  it('accepts startup folders and YAML files through the same root and selection flow and rejects other arguments', async () => {
    vi.mocked(native.startupPaths).mockResolvedValueOnce([
      { kind: 'directory', path: '/startup' },
      { kind: 'yaml', path: '/startup/flow.yaml' },
    ])
    await actions().handleStartupPaths()
    expect(native.workspaceSetRoot).toHaveBeenCalledWith('/startup')
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flow.yaml' }))
  })
})
