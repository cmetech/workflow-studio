import type { AuthoringContract } from '$src/lib/contract/types'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { ExampleDescriptor } from '$src/lib/examples/types'
import type { WorkspaceNativeBridge, WorkspacePackageSnapshot } from '$src/lib/native/types'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
import {
  planPackageCreation,
  planWorkflowImport,
  assertPackageContentLimits,
  type PackageCreationSnapshot,
  type PackageWorkflowOption,
  type CreatePackageRequest,
  type ImportWorkflowPackageRequest,
} from '$src/lib/packages/creation'
import { packagePathError, packagePathIdentity, validatePackagePaths } from '$src/lib/packages/paths'
import type { WorkflowPackageProjection } from '$src/lib/packages/types'
import type { WorkspaceFileEntry } from '$src/lib/workspace/types'
import { capturePackageAnalysis } from './package-analysis'
import { buildPackageAuthoringSources } from './package-authoring-sources'
export interface PackageAuthoringContext {
  readonly workspaceId: string
  readonly files: readonly WorkspaceFileEntry[]
  readonly packages: readonly WorkflowPackageProjection[]
  readonly authoring: readonly AuthoringContract[]
  readonly activePair: WorkflowPairText | null
}
export interface PackageAuthoringDependencies {
  readonly getContext: () => PackageAuthoringContext | Promise<PackageAuthoringContext>
  readonly native: Pick<
    WorkspaceNativeBridge,
    | 'workspaceScan'
    | 'workspaceHashPackage'
    | 'workspaceReadTextArtifact'
    | 'workspaceApplyTransaction'
    | 'chooseImportArtifact'
    | 'workspaceImportArtifact'
  >
  readonly contract: WorkflowPackageContract
  readonly resourceContract: ResourceResolutionContract
  readonly workflowExamples?: readonly ExampleDescriptor[]
  readonly onCompleted: (root: string, path?: string) => void | Promise<void>
}
export interface PackageAuthoringSession {
  readonly context: PackageAuthoringContext
  readonly snapshot: PackageCreationSnapshot
  readonly sources: readonly PackageWorkflowOption[]
  readonly packageSnapshots: ReadonlyMap<string, WorkspacePackageSnapshot>
}
export function createPackageAuthoringController(deps: PackageAuthoringDependencies) {
  const sessions = new WeakSet<PackageAuthoringSession>()
  let committing = false
  async function current(session: PackageAuthoringSession) {
    const context = await deps.getContext()
    if (!sessions.has(session) || context.workspaceId !== session.context.workspaceId)
      throw Error('The workspace changed. Reopen this dialog.')
    if (
      deps.contract !== session.snapshot.contract ||
      deps.resourceContract !== session.snapshot.resourceContract ||
      context.authoring.length !== session.context.authoring.length ||
      context.authoring.some(
        (contract) =>
          !session.context.authoring.some(
            (previous) =>
              previous.profile === contract.profile && previous.contract_digest === contract.contract_digest,
          ),
      )
    )
      throw Error('The active contract changed. Reopen this dialog.')
    return context
  }
  async function prepare(): Promise<PackageAuthoringSession> {
    const context = await deps.getContext()
    if (!context.workspaceId || !context.authoring.length)
      throw Error('Select a workspace and an active authoring contract.')
    if (new Set(context.authoring.map((item) => item.profile)).size !== context.authoring.length)
      throw Error('Authoring profiles are ambiguous.')
    const files = await deps.native.workspaceScan()
    const entries = new Map(
      files.map((file) => [file.relativePath, { ...file } as PackageCreationSnapshot['entries'][number]]),
    )
    const captures = new Map<string, Awaited<ReturnType<typeof capturePackageAnalysis>>>()
    for (const pkg of context.packages) {
      const captured = await capturePackageAnalysis({
        packageRoot: pkg.root,
        native: deps.native,
        contract: deps.contract,
        resourceContract: deps.resourceContract,
        authoring: context.authoring,
      })
      if (captured.snapshot.workspaceId !== context.workspaceId)
        throw Error('The workspace changed while reading package sources.')
      captures.set(pkg.root, captured)
      const prefix = pkg.root ? pkg.root + '/' : ''
      for (const entry of captured.snapshot.entries) {
        const path = entry.relativePath.slice(prefix.length)
        const hash = captured.snapshot.files.find((file) => file.relativePath === path)?.sha256
        const text = captured.artifactTexts.get(path)
        entries.set(entry.relativePath, {
          ...entry,
          ...(hash ? { sha256: hash } : {}),
          ...(text !== undefined ? { text } : {}),
        })
      }
    }
    for (const entry of entries.values()) {
      if (
        entry.kind !== 'file' ||
        entry.symlink !== 'none' ||
        entry.text !== undefined ||
        !/\.ya?ml$/i.test(entry.relativePath)
      )
        continue
      try {
        const read = await deps.native.workspaceReadTextArtifact(entry.relativePath)
        entries.set(entry.relativePath, { ...entry, sha256: read.sha256, text: read.text })
      } catch {
        /* An unreadable source is excluded, never guessed. */
      }
    }
    const snapshot: PackageCreationSnapshot = {
      workspaceId: context.workspaceId,
      entries: [...entries.values()],
      packages: context.packages.map((pkg) => ({ root: pkg.root, id: pkg.manifest.id })),
      contract: deps.contract,
      resourceContract: deps.resourceContract,
    }
    const sources = await buildPackageAuthoringSources(context, snapshot, captures, deps.workflowExamples ?? [])
    if ((await deps.getContext()).workspaceId !== context.workspaceId)
      throw Error('The workspace changed while reading sources.')
    const session = {
      context,
      snapshot,
      sources,
      packageSnapshots: new Map([...captures].map(([root, value]) => [root, value.snapshot])),
    }
    sessions.add(session)
    return session
  }
  async function mutate<T>(session: PackageAuthoringSession, operation: () => Promise<T>): Promise<T> {
    if (committing) throw Error('A package operation is already in progress.')
    committing = true
    try {
      await current(session)
      return await operation()
    } finally {
      committing = false
    }
  }
  async function authorizeSource(session: PackageAuthoringSession, source: CreatePackageRequest['workflow']) {
    const option = session.sources.find((item) => item.source === source)
    if (!option || option.disabledReason) throw Error(option?.disabledReason ?? 'Choose a source from this dialog.')
    const context = await current(session)
    const pair = context.activePair
    if (
      pair &&
      [source.definition, ...(source.companion ? [source.companion] : [])].some(
        (file) => file.sourcePath === pair.definition.path || file.sourcePath === pair.companion?.path,
      ) &&
      (pair.generation !== pair.savedGeneration ||
        pair.definition.revision !== pair.definition.savedRevision ||
        (pair.companion && pair.companion.revision !== pair.companion.savedRevision))
    )
      throw Error('Save the source workflow before copying it.')
  }
  async function freshPackageToken(session: PackageAuthoringSession, root: string): Promise<string> {
    const snapshot = await deps.native.workspaceHashPackage(root)
    if (snapshot.workspaceId !== session.context.workspaceId || snapshot.packageRoot !== root)
      throw Error('The workspace changed before publication.')
    await current(session)
    return snapshot.sourceSnapshotToken
  }
  async function completed(session: PackageAuthoringSession, root: string, path?: string) {
    try {
      await current(session)
      if (path === undefined) await deps.onCompleted(root)
      else await deps.onCompleted(root, path)
    } catch (cause) {
      throw Error(
        'The package changes were committed, but the view could not be refreshed: ' +
          (cause instanceof Error ? cause.message : String(cause)),
      )
    }
  }
  async function create(session: PackageAuthoringSession, request: CreatePackageRequest) {
    return mutate(session, async () => {
      await authorizeSource(session, request.workflow)
      const plan = await planPackageCreation(request, session.snapshot)
      await authorizeSource(session, request.workflow)
      await deps.native.workspaceApplyTransaction(plan)
      await completed(session, request.root)
    })
  }
  async function importWorkflow(session: PackageAuthoringSession, request: ImportWorkflowPackageRequest) {
    return mutate(session, async () => {
      await authorizeSource(session, request.workflow)
      const plan = await planWorkflowImport(request, session.snapshot)
      const guardedPlan = { ...plan, packageSnapshotToken: await freshPackageToken(session, request.root) }
      await authorizeSource(session, request.workflow)
      await deps.native.workspaceApplyTransaction(guardedPlan)
      await completed(session, request.root)
    })
  }
  function artifactTarget(session: PackageAuthoringSession, root: string, path: string) {
    const snapshot = session.packageSnapshots.get(root)
    if (!snapshot) throw Error('Reopen Add Artifact for a verified package.')
    if (
      packagePathError(path) ||
      ['workflow-package.json', 'digests.json', '.well-known/hermes-workflows/index.json'].includes(
        packagePathIdentity(path),
      )
    )
      throw Error('Choose a canonical, non-reserved package-relative filename.')
    const relativePath = root ? root + '/' + path : path
    if (snapshot.entries.some((entry) => packagePathIdentity(entry.relativePath) === packagePathIdentity(relativePath)))
      throw Error('This filename already exists. Choose another filename.')
    const prefix = root ? root + '/' : ''
    const projected = [
      ...snapshot.entries.map((entry) => ({ ...entry, relativePath: entry.relativePath.slice(prefix.length) })),
      { relativePath: path, kind: 'file' as const, size: 0, symlink: 'none' as const, readOnly: false, modifiedAt: '' },
    ]
    const invalid = validatePackagePaths(projected)[0]
    if (invalid) throw Error(invalid.message)
    return { snapshot, relativePath, projected }
  }
  async function addTextArtifact(session: PackageAuthoringSession, root: string, path: string, text: string) {
    return mutate(session, async () => {
      const target = artifactTarget(session, root, path)
      const projected = target.projected.map((entry) =>
        entry.relativePath === path ? { ...entry, size: new TextEncoder().encode(text).byteLength } : entry,
      )
      assertPackageContentLimits(projected, deps.contract)
      const packageSnapshotToken = await freshPackageToken(session, root)
      const plan = {
        packageSnapshotToken,
        workspaceId: session.context.workspaceId,
        expectedEntries: [
          ...target.snapshot.files.map((file) => ({
            relativePath: root ? root + '/' + file.relativePath : file.relativePath,
            expectedCurrentHash: file.sha256,
          })),
          { relativePath: target.relativePath, expectedCurrentHash: null },
        ],
        writes: [{ relativePath: target.relativePath, text, expectedCurrentHash: null }],
        moves: [],
        trashes: [],
      }
      await deps.native.workspaceApplyTransaction(plan)
      await completed(session, root, target.relativePath)
    })
  }
  async function importArtifact(session: PackageAuthoringSession, root: string, path: string) {
    return mutate(session, async () => {
      const target = artifactTarget(session, root, path)
      const source = await deps.native.chooseImportArtifact()
      if (!source) return false
      await current(session)
      const request = {
        relativePath: target.relativePath,
        sourceGrantToken: source.sourceGrantToken,
        packageSnapshotToken: await freshPackageToken(session, root),
      }
      await deps.native.workspaceImportArtifact(request)
      await completed(session, root, target.relativePath)
      return true
    })
  }
  return { prepare, create, importWorkflow, addTextArtifact, importArtifact }
}
