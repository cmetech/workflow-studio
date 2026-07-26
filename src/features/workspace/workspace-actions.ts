import { stringify } from 'yaml'
import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import { createDocumentRevision, isAnalysisCurrent } from '$src/lib/documents/revisions'
import type {
  WorkspaceReadResult,
  WorkspaceRenameRequest,
  WorkspaceRenameResult,
  WorkspaceRootInfo,
  WorkspaceTrashRequest,
  WorkspaceTrashResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '$src/lib/native/types'
import { createRecentWorkspaceStore, type RecentWorkspaceStore } from '$src/lib/workspace/recent-workspaces'
import { pairWorkflowFiles } from '$src/lib/workspace/pair-workflows'
import type { WorkflowPairEntry, WorkspaceFileEntry } from '$src/lib/workspace/types'
import { loadWorkspaceEntries, selectWorkspaceEntry } from '$src/stores/workspace'

export interface ExternalYamlReadResult {
  readonly path: string
  readonly text: string
}

export interface ExportYamlFile {
  readonly fileName: string
  readonly text: string
}

export interface StartupPath {
  readonly kind: 'directory' | 'yaml'
  readonly path: string
  readonly rootPath?: string
  readonly relativePath?: string
}

export interface WorkspaceActionsNative {
  chooseWorkspaceFolder(): Promise<string | null>
  chooseImportDefinition(): Promise<string | null>
  chooseExportDirectory(): Promise<string | null>
  workspaceSetRoot(rootPath: string): Promise<WorkspaceRootInfo>
  workspaceScan(): Promise<readonly WorkspaceFileEntry[]>
  workspaceRead(relativePath: string): Promise<WorkspaceReadResult>
  workspaceWrite(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>
  workspaceRenamePair(request: WorkspaceRenameRequest): Promise<WorkspaceRenameResult>
  workspaceTrashPaths(requests: readonly WorkspaceTrashRequest[]): Promise<WorkspaceTrashResult>
  externalReadYaml(path: string): Promise<ExternalYamlReadResult>
  externalExportYamlPair(request: {
    readonly directoryPath: string
    readonly overwrite: boolean
    readonly files: readonly ExportYamlFile[]
  }): Promise<{ readonly paths: readonly string[] }>
  recentWorkspacesLoad(): Promise<string>
  recentWorkspacesSave(content: string): Promise<void>
  pathAvailable(path: string): Promise<boolean>
  startupPaths(): Promise<readonly StartupPath[]>
}

export interface WorkspaceActionsDependencies {
  readonly native: WorkspaceActionsNative
  readonly contracts: readonly AuthoringContract[]
  readonly analyze: (input: {
    definitionText: string
    companionText: string | null
    contract: AuthoringContract
  }) => Promise<DocumentAnalysis>
  readonly activate: (entry: WorkflowPairEntry) => void
  readonly openDraft: (pair: WorkflowPairText) => void
  readonly closeDocument: () => void
  readonly renameDocument: (from: string, to: string) => void
  readonly renameLayout: (workspaceId: string, from: string, to: string) => Promise<void>
  readonly recoverDraft: (pair: WorkflowPairText) => Promise<void>
  readonly now?: () => string
}

export interface NewWorkflowInput {
  readonly name: string
  readonly description: string
  readonly profile: WorkflowProfile
  readonly firstNodeId: string
  readonly firstNodeKind: string
  readonly firstNodeValues: Readonly<Record<string, unknown>>
}

export class WorkspaceActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly paths: readonly string[] = [],
  ) {
    super(message)
    this.name = 'WorkspaceActionError'
  }
}

export function createWorkspaceActions(dependencies: WorkspaceActionsDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const recentWorkspaces: RecentWorkspaceStore = createRecentWorkspaceStore({
    load: () => dependencies.native.recentWorkspacesLoad(),
    save: (content) => dependencies.native.recentWorkspacesSave(content),
    isAvailable: (rootPath) => dependencies.native.pathAvailable(rootPath),
  })

  async function selectRoot(rootPath: string): Promise<WorkspaceRootInfo> {
    const selected = await dependencies.native.workspaceSetRoot(rootPath)
    const files = await dependencies.native.workspaceScan()
    loadWorkspaceEntries(selected.workspaceId, fileName(selected.rootPath), files)
    await recentWorkspaces.record(selected.rootPath, now())
    return selected
  }

  async function openWorkspace(rootPath?: string): Promise<WorkspaceRootInfo | null> {
    const selectedPath = rootPath ?? (await dependencies.native.chooseWorkspaceFolder())
    return selectedPath === null ? null : selectRoot(selectedPath)
  }

  async function createWorkflow(input: NewWorkflowInput): Promise<{ path: string; text: string }> {
    const activeContract = contractFor(dependencies.contracts, input.profile)
    const descriptor = activeContract.node_kinds.find(
      (kind) =>
        kind.id === input.firstNodeKind &&
        kind.status === 'supported' &&
        kind.applicability.profiles.includes(input.profile) &&
        kind.applicability.documents.includes('definition'),
    )
    if (!input.name.trim() || !input.description.trim() || !input.firstNodeId.trim() || !descriptor) {
      throw new WorkspaceActionError('new_workflow_incomplete', 'Complete every required New Workflow field.')
    }
    const requiredFields = requiredFirstNodeFields(activeContract, descriptor)
    const values = Object.fromEntries(
      requiredFields.map((field) => [field.field_path, input.firstNodeValues[field.id]]),
    )
    if (Object.values(values).some((value) => value === undefined || value === '')) {
      throw new WorkspaceActionError('new_workflow_incomplete', 'Complete every contract-required first-node field.')
    }

    const graph = graphParameters(activeContract)
    const definition: Record<string, unknown> = { name: input.name.trim(), description: input.description.trim() }
    const node: Record<string, unknown> = {}
    setPath(node, graph.idField, input.firstNodeId.trim())
    setPath(node, graph.dependenciesField, [])
    setRelativeDescriptorPath(node, descriptor.field_path, graph.nodesPath, valueForDescriptor(descriptor, input))
    for (const field of descriptor.fields) {
      const value = input.firstNodeValues[field.id]
      if (value !== undefined) setRelativeDescriptorPath(node, field.field_path, graph.nodesPath, value)
    }
    setPath(definition, graph.nodesPath, [node])
    const text = stringify(definition, { lineWidth: 0 })
    const companionText = input.profile === 'hermes-legacy' ? null : companionTextFor(activeContract, input.profile, {})
    const analysis = await dependencies.analyze({ definitionText: text, companionText, contract: activeContract })
    if (!analysis.structurallyValid) {
      throw new WorkspaceActionError(
        'generated_workflow_invalid',
        'The active contract rejected the generated workflow.',
      )
    }
    const relativePath = `${safeBasename(input.name)}.yaml`
    await dependencies.native.workspaceWrite({ relativePath, text, expectedCurrentHash: null })
    if (companionText !== null) {
      await dependencies.native.workspaceWrite({
        relativePath: companionPathFor(relativePath),
        text: companionText,
        expectedCurrentHash: null,
      })
    }
    return { path: relativePath, text }
  }

  async function duplicateWorkflow(input: {
    definitionPath: string
    companionPath: string | null
  }): Promise<{ definitionPath: string; companionPath: string | null }> {
    const [definition, companion, files] = await Promise.all([
      dependencies.native.workspaceRead(input.definitionPath),
      input.companionPath ? dependencies.native.workspaceRead(input.companionPath) : Promise.resolve(null),
      dependencies.native.workspaceScan(),
    ])
    const occupied = new Set(files.map(({ relativePath }) => relativePath))
    const destination = collisionSafeCopyPath(input.definitionPath, occupied)
    const companionDestination = companion ? companionPathFor(destination) : null
    await dependencies.native.workspaceWrite({
      relativePath: destination,
      text: definition.text,
      expectedCurrentHash: null,
    })
    if (companion && companionDestination) {
      await dependencies.native.workspaceWrite({
        relativePath: companionDestination,
        text: companion.text,
        expectedCurrentHash: null,
      })
    }
    return { definitionPath: destination, companionPath: companionDestination }
  }

  async function renameWorkflow(input: {
    workspaceId: string
    definitionPath: string
    destinationDefinition: string
  }): Promise<WorkspaceRenameResult> {
    const result = await dependencies.native.workspaceRenamePair({
      sourceDefinition: input.definitionPath,
      destinationDefinition: input.destinationDefinition,
    })
    dependencies.renameDocument(input.definitionPath, input.destinationDefinition)
    const sourceCompanion = companionPathFor(input.definitionPath)
    const destinationCompanion = companionPathFor(input.destinationDefinition)
    if (result.paths.includes(destinationCompanion)) dependencies.renameDocument(sourceCompanion, destinationCompanion)
    await dependencies.renameLayout(input.workspaceId, input.definitionPath, input.destinationDefinition)
    return result
  }

  async function createCompanion(input: {
    definitionPath: string
    profile: WorkflowProfile
    metadata: Readonly<Record<string, unknown>>
  }): Promise<string> {
    const activeContract = contractFor(dependencies.contracts, input.profile)
    const text = companionTextFor(activeContract, input.profile, input.metadata)
    const definition = await dependencies.native.workspaceRead(input.definitionPath)
    const analysis = await dependencies.analyze({
      definitionText: definition.text,
      companionText: text,
      contract: activeContract,
    })
    if (!analysis.structurallyValid) {
      throw new WorkspaceActionError(
        'companion_invalid',
        'The selected companion metadata is invalid for this contract.',
      )
    }
    const path = companionPathFor(input.definitionPath)
    await dependencies.native.workspaceWrite({ relativePath: path, text, expectedCurrentHash: null })
    return path
  }

  function previewRemoveCompanion(input: {
    definitionPath: string
    companionPath: string
    selectedProfile: WorkflowProfile
  }) {
    void input.definitionPath
    return {
      paths: [input.companionPath],
      currentProfile: input.selectedProfile,
      effectiveProfileAfter: 'hermes-legacy' as const,
    }
  }

  async function removeCompanion(input: { companionPath: string; expectedHash: string }): Promise<void> {
    const result = await dependencies.native.workspaceTrashPaths([
      { relativePath: input.companionPath, expectedCurrentHash: input.expectedHash },
    ])
    requireTrashSuccess(result, [input.companionPath])
  }

  function previewTrashWorkflow(input: { definitionPath: string; companionPath: string | null }) {
    return { paths: [input.definitionPath, ...(input.companionPath ? [input.companionPath] : [])] }
  }

  async function trashWorkflow(input: {
    definitionPath: string
    definitionHash: string
    companionPath: string | null
    companionHash: string | null
  }): Promise<void> {
    const requests: WorkspaceTrashRequest[] = [
      { relativePath: input.definitionPath, expectedCurrentHash: input.definitionHash },
    ]
    if (input.companionPath && input.companionHash) {
      requests.push({ relativePath: input.companionPath, expectedCurrentHash: input.companionHash })
    }
    const result = await dependencies.native.workspaceTrashPaths(requests)
    requireTrashSuccess(
      result,
      requests.map(({ relativePath }) => relativePath),
    )
    dependencies.closeDocument()
  }

  async function importWorkflow(input: { profile: WorkflowProfile }) {
    const selectedPath = await dependencies.native.chooseImportDefinition()
    if (selectedPath === null) return { status: 'cancelled' as const }
    const definition = await dependencies.native.externalReadYaml(selectedPath)
    const companionExternalPath = companionPathFor(selectedPath)
    let companion: ExternalYamlReadResult | null = null
    try {
      companion = await dependencies.native.externalReadYaml(companionExternalPath)
    } catch (error: unknown) {
      if (!hasCode(error, 'path_not_found') && !hasCode(error, 'dialog_permission_required')) throw error
    }
    const activeContract = contractFor(dependencies.contracts, input.profile)
    const analysis = await dependencies.analyze({
      definitionText: definition.text,
      companionText: companion?.text ?? null,
      contract: activeContract,
    })
    const name = fileName(definition.path)
    if (!analysis.structurallyValid) {
      const pair = unsavedPair(name, definition.text, companion?.text ?? null)
      dependencies.openDraft(pair)
      await dependencies.recoverDraft(pair)
      return { status: 'draft' as const, pair, issues: analysis.issues }
    }
    const files = await dependencies.native.workspaceScan()
    const destination = collisionSafeImportPath(name, new Set(files.map(({ relativePath }) => relativePath)))
    await dependencies.native.workspaceWrite({
      relativePath: destination,
      text: definition.text,
      expectedCurrentHash: null,
    })
    const companionDestination = companion ? companionPathFor(destination) : null
    if (companion && companionDestination) {
      await dependencies.native.workspaceWrite({
        relativePath: companionDestination,
        text: companion.text,
        expectedCurrentHash: null,
      })
    }
    return { status: 'imported' as const, definitionPath: destination, companionPath: companionDestination }
  }

  async function exportWorkflow(input: {
    pair: WorkflowPairText
    analysis: DocumentAnalysis | null
    confirmCollision: (paths: readonly string[]) => Promise<boolean>
  }) {
    if (
      !input.analysis?.structurallyValid ||
      !isAnalysisCurrent(
        createDocumentRevision(input.pair, input.analysis?.contractDigest ?? `sha256:${'0'.repeat(64)}`),
        input.analysis,
      )
    ) {
      return { status: 'blocked' as const, issues: input.analysis?.issues ?? [] }
    }
    const directoryPath = await dependencies.native.chooseExportDirectory()
    if (directoryPath === null) return { status: 'cancelled' as const }
    const files: ExportYamlFile[] = [
      { fileName: fileName(input.pair.definition.path), text: input.pair.definition.text },
      ...(input.pair.companion
        ? [{ fileName: fileName(input.pair.companion.path), text: input.pair.companion.text }]
        : []),
    ]
    try {
      const result = await dependencies.native.externalExportYamlPair({ directoryPath, overwrite: false, files })
      return { status: 'exported' as const, paths: result.paths }
    } catch (error: unknown) {
      if (!hasCode(error, 'destination_exists')) throw error
      const paths = files.map(({ fileName }) => joinPath(directoryPath, fileName))
      if (!(await input.confirmCollision(paths))) return { status: 'cancelled' as const }
      const result = await dependencies.native.externalExportYamlPair({ directoryPath, overwrite: true, files })
      return { status: 'exported' as const, paths: result.paths }
    }
  }

  async function handleStartupPaths(): Promise<void> {
    for (const startup of await dependencies.native.startupPaths()) {
      await handleExternalPath(startup.path, startup)
    }
  }

  async function handleExternalPath(path: string, classified?: StartupPath): Promise<void> {
    const isYaml = classified?.kind === 'yaml' || /\.(?:yaml|yml)$/i.test(path)
    if (!isYaml) {
      await openWorkspace(path)
      return
    }
    const rootPath = classified?.rootPath ?? parentPath(path)
    const relativePath = classified?.relativePath ?? fileName(path)
    const selected = await selectRoot(rootPath)
    const entries = pairWorkflowFiles(selected.workspaceId, await dependencies.native.workspaceScan())
    const targetDefinition = relativePath.endsWith('.hermes.yaml')
      ? relativePath.replace(/\.hermes\.yaml$/, '.yaml')
      : relativePath
    const target = entries.find(
      (candidate): candidate is WorkflowPairEntry =>
        candidate.kind === 'workflow' && candidate.definitionPath === targetDefinition,
    )
    if (target) {
      selectWorkspaceEntry(target.id)
      dependencies.activate(target)
      return
    }
    const orphan = entries.find(
      (candidate) => candidate.kind === 'orphan-companion' && candidate.companionPath === relativePath,
    )
    if (orphan) selectWorkspaceEntry(orphan.id)
  }

  return {
    recentWorkspaces,
    openWorkspace,
    createWorkflow,
    duplicateWorkflow,
    renameWorkflow,
    createCompanion,
    previewRemoveCompanion,
    removeCompanion,
    previewTrashWorkflow,
    trashWorkflow,
    importWorkflow,
    exportWorkflow,
    handleExternalPath,
    handleStartupPaths,
  }
}

function contractFor(contracts: readonly AuthoringContract[], profile: WorkflowProfile): AuthoringContract {
  const active = contracts.find((contract) => contract.profile === profile)
  if (!active)
    throw new WorkspaceActionError('contract_unavailable', `The ${profile} authoring contract is unavailable.`)
  return active
}

function graphParameters(contract: AuthoringContract) {
  const rule = contract.semantic_rules.find(
    ({ applicability, parameters, status }) =>
      status === 'supported' &&
      applicability.profiles.includes(contract.profile) &&
      typeof parameters.nodes_path === 'string' &&
      typeof parameters.id_field === 'string' &&
      typeof parameters.dependencies_field === 'string',
  )
  if (!rule) throw new WorkspaceActionError('contract_dag_rule_missing', 'The contract does not publish DAG paths.')
  return {
    nodesPath: pathTokens(rule.parameters.nodes_path as string),
    idField: pathTokens(rule.parameters.id_field as string),
    dependenciesField: pathTokens(rule.parameters.dependencies_field as string),
  }
}

function pathTokens(path: string): string[] {
  return path.replaceAll('[]', '').replace(/^\//, '').split(/[./]/).filter(Boolean)
}

function setRelativeDescriptorPath(
  target: Record<string, unknown>,
  descriptorPath: string,
  nodesPath: readonly string[],
  value: unknown,
): void {
  const descriptor = pathTokens(descriptorPath)
  const relative = nodesPath.every((segment, index) => descriptor[index] === segment)
    ? descriptor.slice(nodesPath.length)
    : descriptor
  setPath(target, relative, value)
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  if (path.length === 0)
    throw new WorkspaceActionError('contract_field_path_invalid', 'A contract field path is empty.')
  let current = target
  for (const segment of path.slice(0, -1)) {
    const next: Record<string, unknown> = {}
    current[segment] = next
    current = next
  }
  current[path.at(-1)!] = value
}

function valueForDescriptor(descriptor: AuthoringContract['node_kinds'][number], input: NewWorkflowInput): unknown {
  return input.firstNodeValues[descriptor.id] ?? input.firstNodeValues[descriptor.fields[0]?.id ?? ''] ?? {}
}

function requireTrashSuccess(result: WorkspaceTrashResult, expectedPaths: readonly string[]): void {
  const successful = new Set(
    result.results.filter(({ status }) => status === 'trashed').map(({ relativePath }) => relativePath),
  )
  if (expectedPaths.some((path) => !successful.has(path))) {
    throw new WorkspaceActionError(
      'workspace_trash_partial',
      'Not every requested file reached the operating-system Trash.',
      expectedPaths,
    )
  }
}

function collisionSafeCopyPath(path: string, occupied: ReadonlySet<string>): string {
  const extension = path.endsWith('.yml') ? '.yml' : '.yaml'
  const stem = path.slice(0, -extension.length)
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? '-copy' : `-copy-${index}`
    const candidate = `${stem}${suffix}${extension}`
    if (!occupied.has(candidate) && !occupied.has(companionPathFor(candidate))) return candidate
  }
}

function collisionSafeImportPath(path: string, occupied: ReadonlySet<string>): string {
  if (!occupied.has(path) && !occupied.has(companionPathFor(path))) return path
  const extension = path.endsWith('.yml') ? '.yml' : '.yaml'
  const stem = path.slice(0, -extension.length)
  for (let index = 2; ; index += 1) {
    const candidate = `${stem}-${index}${extension}`
    if (!occupied.has(candidate) && !occupied.has(companionPathFor(candidate))) return candidate
  }
}

function companionPathFor(definitionPath: string): string {
  return definitionPath.replace(/\.(?:yaml|yml)$/i, '.hermes.yaml')
}

function unsavedPair(path: string, text: string, companionText: string | null): WorkflowPairText {
  return {
    workflowId: `draft:${path}`,
    generation: 0,
    savedGeneration: 0,
    definition: {
      id: `draft:${path}:definition`,
      kind: 'definition',
      path,
      text,
      revision: 1,
      savedRevision: 0,
      diskHash: null,
    },
    companion:
      companionText === null
        ? null
        : {
            id: `draft:${path}:companion`,
            kind: 'companion',
            path: companionPathFor(path),
            text: companionText,
            revision: 1,
            savedRevision: 0,
            diskHash: null,
          },
  }
}

function companionTextFor(
  contract: AuthoringContract,
  profile: WorkflowProfile,
  metadata: Readonly<Record<string, unknown>>,
): string {
  const schema = record(contract.sidecar_schema)
  const properties = record(schema.properties)
  const companion: Record<string, unknown> = {}
  if (Object.hasOwn(properties, 'language_compatibility')) companion.language_compatibility = profile
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== 'language_compatibility' && Object.hasOwn(properties, key)) companion[key] = value
  }
  return stringify(companion, { lineWidth: 0 })
}

export function requiredFirstNodeFields(
  contract: AuthoringContract,
  descriptor: AuthoringContract['node_kinds'][number],
) {
  const graph = graphParameters(contract)
  const definitionProperties = record(record(contract.definition_schema).properties)
  const nodesSchema = graph.nodesPath.reduce<unknown>(
    (current, segment) => record(record(current).properties)[segment],
    {
      properties: definitionProperties,
    },
  )
  const itemSchema = record(record(nodesSchema).items)
  const required = new Set(
    Array.isArray(itemSchema.required)
      ? itemSchema.required.filter((item): item is string => typeof item === 'string')
      : [],
  )
  const kindRelative = relativePath(descriptor.field_path, graph.nodesPath)
  return descriptor.fields.filter((field) => {
    const fieldRelative = relativePath(field.field_path, graph.nodesPath)
    return (
      field.status === 'supported' &&
      (required.has(fieldRelative[0] ?? '') || fieldRelative.join('.') === kindRelative.join('.'))
    )
  })
}

function relativePath(path: string, parent: readonly string[]): string[] {
  const tokens = pathTokens(path)
  return parent.every((segment, index) => tokens[index] === segment) ? tokens.slice(parent.length) : tokens
}

function safeBasename(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  if (!normalized) throw new WorkspaceActionError('invalid_workflow_name', 'The workflow name cannot form a file name.')
  return normalized
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

function parentPath(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator <= 0 ? path.slice(0, separator + 1) : path.slice(0, separator)
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/[\\/]$/, '')}/${name}`
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
