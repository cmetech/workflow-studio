/** Deterministic E2E filesystem/Git fixture. This module is only imported by the E2E bootstrap. */
import {
  NativeError,
  type WorkspaceChangedHandler,
  type WorkspaceNativeBridge,
  type WorkspacePackageSnapshot,
} from '$src/lib/native/types'
import type { GitBase, GitPackageContext, GitPackageVersionPreview } from '$src/lib/git/types'

const INDEX = '.well-known/hermes-workflows/index.json'
const sources = import.meta.glob('../../examples/packages/laptop-diagnostic/**/*', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>
export const packageScenarioFiles = Object.fromEntries(
  Object.entries(sources).map(([path, text]) => [path.replace('../../examples/packages/', 'packages/'), text]),
)
export interface PackageScenarioControls {
  files(): Promise<Record<string, string>>
  calls(): readonly string[]
  change(path: string, text: string): Promise<void>
  failNextGeneratedWrite(): void
}
declare global {
  interface Window {
    __WORKFLOW_STUDIO_PACKAGE_E2E__?: PackageScenarioControls
  }
}

export function installPackageScenario(
  bridge: WorkspaceNativeBridge,
  notify: WorkspaceChangedHandler,
): WorkspaceNativeBridge {
  const calls: string[] = []
  let failGenerated = false
  let base: GitBase = { kind: 'unborn', reference: 'refs/heads/base' }
  const committed = new Map<string, string>()
  const contexts = new Map<string, GitPackageContext>()
  const snapshots = new Map<string, WorkspacePackageSnapshot>()
  const previews = new Map<
    string,
    { preview: GitPackageVersionPreview; source: WorkspacePackageSnapshot; index: string }
  >()
  const equalSource = (left: WorkspacePackageSnapshot, right: WorkspacePackageSnapshot) =>
    left.workspaceId === right.workspaceId &&
    left.packageRoot === right.packageRoot &&
    left.generatedDigestHash === right.generatedDigestHash &&
    JSON.stringify(left.files.map((file) => [file.relativePath, file.sha256, file.size])) ===
      JSON.stringify(right.files.map((file) => [file.relativePath, file.sha256, file.size]))
  const text = async (path: string) => {
    try {
      return await bridge.workspaceReadTextArtifact(path)
    } catch (error) {
      if (error instanceof NativeError && error.code === 'path_not_found') return null
      throw error
    }
  }
  window.__WORKFLOW_STUDIO_PACKAGE_E2E__ = {
    calls: () => [...calls],
    async files() {
      const result: Record<string, string> = {}
      for (const entry of await bridge.workspaceScan())
        if (entry.kind === 'file') {
          try {
            result[entry.relativePath] = (await bridge.workspaceReadTextArtifact(entry.relativePath)).text
          } catch (error) {
            if (!(error instanceof NativeError) || error.code !== 'invalid_utf8') throw error
          }
        }
      return result
    },
    async change(path, value) {
      const previous = await text(path)
      await bridge.workspaceWriteTextArtifact({
        relativePath: path,
        text: value,
        expectedCurrentHash: previous?.sha256 ?? null,
      })
      await notify({ paths: [path], kind: previous ? 'modify' : 'create' })
    },
    failNextGeneratedWrite() {
      failGenerated = true
    },
  }
  const fixture: WorkspaceNativeBridge = {
    ...bridge,
    async workspaceHashPackage(root) {
      const snapshot = await bridge.workspaceHashPackage(root)
      snapshots.set(snapshot.sourceSnapshotToken, snapshot)
      return snapshot
    },
    async workspaceReplaceGeneratedFiles(request) {
      if (failGenerated) {
        failGenerated = false
        throw new NativeError(
          'workspace_transaction_rolled_back',
          'Injected generated-write failure; original generated files retained.',
        )
      }
      return bridge.workspaceReplaceGeneratedFiles(request)
    },
    async gitReadPackageContext(root) {
      const index = await text(INDEX)
      const context: GitPackageContext = {
        workspaceId: 'browser-workspace',
        packageRoot: root,
        repository: { root: '/e2e/workspace', branch: 'base', detachedHead: null },
        base,
        contextToken: crypto.randomUUID(),
        committedManifestText: committed.get(root + '/workflow-package.json') ?? null,
        baselineManifestText: committed.get(root + '/workflow-package.json') ?? null,
        committedFiles: [],
        committedIndexText: committed.get(INDEX) ?? null,
        workingIndexText: index?.text ?? null,
        workingIndexHash: index?.sha256 ?? null,
      }
      for (const [path, value] of committed)
        if (path.startsWith(root + '/')) {
          const bytes = new TextEncoder().encode(value)
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          ;(
            context.committedFiles as Array<{ relativePath: string; sha256: string; size: number; gitMode: string }>
          ).push({
            relativePath: path.slice(root.length + 1),
            size: bytes.length,
            gitMode: '100644',
            sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
          })
        }
      contexts.set(context.contextToken, context)
      return context
    },
    async gitPreviewPackageVersion(request) {
      const context = contexts.get(request.contextToken)
      contexts.delete(request.contextToken)
      const source = request.sourceSnapshotToken ? snapshots.get(request.sourceSnapshotToken) : undefined
      if (!context || !source || JSON.stringify(context.base) !== JSON.stringify(base))
        throw new NativeError('git_preview_stale', 'Validate again.')
      const current = await bridge.workspaceHashPackage(context.packageRoot)
      const index = await text(INDEX)
      if (!equalSource(source, current) || index?.sha256 !== request.expectedIndexHash)
        throw new NativeError('git_preview_stale', 'Files changed.')
      const paths = [
        ...source.files.map((file) => context.packageRoot + '/' + file.relativePath),
        context.packageRoot + '/digests.json',
        INDEX,
      ].sort()
      const preview: GitPackageVersionPreview = {
        authorizationToken: crypto.randomUUID(),
        packageRoot: context.packageRoot,
        base,
        version: request.version,
        message: request.message,
        changedPaths: paths,
        diff: paths.map((path) => `diff --git a/${path} b/${path}\n+ prepared package content`).join('\n'),
      }
      previews.set(preview.authorizationToken, { preview, source, index: index!.text })
      return preview
    },
    async gitCommitPackageVersion(token) {
      const accepted = previews.get(token)
      previews.delete(token)
      if (!accepted || JSON.stringify(accepted.preview.base) !== JSON.stringify(base))
        throw new NativeError('git_preview_stale', 'Review a fresh preview.')
      if (
        !equalSource(accepted.source, await bridge.workspaceHashPackage(accepted.preview.packageRoot)) ||
        (await text(INDEX))?.text !== accepted.index
      )
        throw new NativeError('git_preview_stale', 'Files changed after preview.')
      for (const path of accepted.preview.changedPaths) committed.set(path, (await text(path))!.text)
      base = { kind: 'head', oid: 'e2e-package-commit', reference: 'refs/heads/base' }
      return { outcome: 'committed', oid: base.oid, status: null, warnings: [] }
    },
  }
  return new Proxy(fixture, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        calls.push(String(key))
        return Reflect.apply(value, target, args)
      }
    },
  })
}
