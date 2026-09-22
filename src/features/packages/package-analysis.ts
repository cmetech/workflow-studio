import type { AuthoringContract } from '$src/lib/contract/types'
import type { WorkspaceNativeBridge, WorkspacePackageSnapshot } from '$src/lib/native/types'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
import type { ArtifactLanguage } from '$src/lib/artifacts/types'
import { analyzeWorkflowPair, selectWorkflowProfile } from '$src/lib/validation/analyze-workflow'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { buildPackageCatalog } from '$src/lib/packages/discovery'
import { classifyPackageArtifact } from '$src/lib/packages/artifact-kind'
import { resolvePackageReferences, type PackageReferenceInput } from '$src/lib/packages/package-references'
import { analyzePackageReadiness, type ArtifactStaticAnalysis, type PackageAnalysis } from '$src/lib/packages/readiness'
import { analyzeCommandMarkdown } from '$src/lib/packages/command-markdown'
import { generatePackageDigests, composePackageDigest } from '$src/lib/packages/digest'
import {
  reconcilePackageIndex,
  projectedPackageTraversalError,
  type PackageIndexContext,
} from '$src/lib/packages/preparation'
import { MARKETPLACE_INDEX_PATH } from '$src/lib/packages/marketplace-index'
import { analyzeArtifactSyntax } from '$src/features/artifacts/static-diagnostics'
import type { WorkflowPackageProjection, PackageFinding } from '$src/lib/packages/types'

export interface PackageAnalysisDependencies {
  readonly packageRoot: string
  readonly native: Pick<WorkspaceNativeBridge, 'workspaceHashPackage' | 'workspaceReadTextArtifact'>
  readonly contract: WorkflowPackageContract
  readonly resourceContract: ResourceResolutionContract
  /** Exactly one active contract per profile; ambiguous choices fail closed. */
  readonly authoring: readonly AuthoringContract[]
  readonly index?: PackageIndexContext
}
export interface CapturedPackageAnalysis {
  readonly package: WorkflowPackageProjection
  readonly snapshot: WorkspacePackageSnapshot
  readonly manifestText: string
  readonly artifactTexts: ReadonlyMap<string, string>
  readonly analyzedHashes: ReadonlyMap<string, string>
  readonly analysis: PackageAnalysis
}
async function hashText(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
function language(path: string, runtime?: string | null): ArtifactLanguage | null {
  const suffix = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (suffix === '.py') return 'python'
  if (suffix === '.ts') return 'typescript'
  if (suffix === '.js') return 'javascript'
  if (suffix === '.json') return 'json'
  if (suffix === '.yaml' || suffix === '.yml') return 'yaml'
  if (runtime === 'uv') return 'python'
  if (runtime === 'bun') return 'typescript'
  return null
}
function unsupported(path: string, text: string): ArtifactStaticAnalysis {
  return {
    path,
    sourceText: text,
    structurallyValid: false,
    findings: [
      {
        path,
        code: 'package_analysis_required',
        severity: 'blocking',
        message: 'A supported runtime is required for static script analysis.',
      },
    ],
  }
}

/** Capture complete native inventory, then analyze only text matching its exact-byte hashes. */
export async function capturePackageAnalysis(deps: PackageAnalysisDependencies): Promise<CapturedPackageAnalysis> {
  const snapshot = await deps.native.workspaceHashPackage(deps.packageRoot)
  if (snapshot.packageRoot !== deps.packageRoot) throw new Error('package_analysis_stale')
  const prefix = deps.packageRoot ? deps.packageRoot + '/' : ''
  const texts = new Map<string, string>()
  const analyzedHashes = new Map<string, string>()
  for (const file of snapshot.files) {
    const path = prefix + file.relativePath
    try {
      const read = await deps.native.workspaceReadTextArtifact(path)
      if (
        read.relativePath !== path ||
        read.sha256 !== file.sha256 ||
        read.size !== file.size ||
        (await hashText(read.text)) !== file.sha256
      )
        throw new Error('package_analysis_stale')
      texts.set(file.relativePath, read.text)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'invalid_utf8') throw error
      // A binary payload participates in native snapshot revalidation and digest composition.
    }
    analyzedHashes.set(file.relativePath, file.sha256)
  }
  const manifestText = texts.get('workflow-package.json')
  if (manifestText === undefined) throw new Error('package_manifest_invalid')
  const catalog = buildPackageCatalog({
    contract: deps.contract,
    files: snapshot.entries,
    manifestTexts: new Map([[prefix + 'workflow-package.json', manifestText]]),
  })
  const pkg = catalog.packages.find((p) => p.root === deps.packageRoot)
  if (!pkg) throw new Error(catalog.findings[0]?.code ?? 'package_manifest_invalid')
  const workflows: PackageReferenceInput['workflows'][number][] = []
  for (const member of pkg.workflows) {
    const definitionText = texts.get(member.definition)
    const companionText = member.companion ? texts.get(member.companion) : undefined
    if (definitionText === undefined || (member.companion && companionText === undefined))
      throw new Error('package_member_missing')
    const companionParsed =
      companionText === undefined
        ? null
        : parseWorkflowYaml(companionText, {
            document: 'companion',
            maxBytes: deps.contract.resource_rules.max_file_bytes,
          }).parsed
    let companionValue: unknown
    try {
      companionValue = companionParsed?.document.toJS({ maxAliasCount: 1000 })
    } catch {
      throw new Error('package_workflow_invalid')
    }
    const selected = selectWorkflowProfile(companionValue)
    const matches = deps.authoring.filter((c) => c.profile === selected.profile)
    if (!selected.recognized || matches.length !== 1) throw new Error('package_authoring_contract_required')
    const authoring = matches[0]!
    const analysis = await analyzeWorkflowPair(
      {
        type: 'analyze',
        requestId: snapshot.sourceSnapshotToken + ':' + member.definition,
        workflowId: prefix + member.definition,
        pairGeneration: 1,
        definition: { path: prefix + member.definition, text: definitionText, revision: 1 },
        companion: member.companion ? { path: prefix + member.companion, text: companionText!, revision: 1 } : null,
        profile: authoring.profile,
        contractDigest: authoring.contract_digest,
        reason: 'open',
      },
      authoring,
    )
    workflows.push({ path: member.definition, authoring, analysis })
  }
  const scan = snapshot.entries
    .filter((e) => e.relativePath.startsWith(prefix))
    .map((e) => ({ ...e, relativePath: e.relativePath.slice(prefix.length) }))
  const resources: PackageReferenceInput = {
    contract: deps.resourceContract,
    packageRoot: pkg.root,
    members: pkg.workflows,
    files: new Map(scan.map((file) => [file.relativePath, { kind: file.symlink === 'none' ? file.kind : 'symlink' }])),
    artifactTexts: texts,
    workflows,
    maxArtifactBytes: deps.contract.resource_rules.max_file_bytes,
  }
  const references = resolvePackageReferences(resources)
  const artifacts: ArtifactStaticAnalysis[] = []
  for (const [path, text] of texts) {
    const kind = classifyPackageArtifact({
      path,
      members: pkg.workflows,
      contract: deps.resourceContract,
      textAvailable: true,
    })
    const consumers = references.references.filter((r) => r.artifactPath === path && r.kind !== 'mcp_resource')
    if (!kind.requiresStaticAnalysis && !consumers.length) continue
    if (kind.kind === 'command' || consumers.some((r) => r.kind === 'command'))
      artifacts.push(analyzeCommandMarkdown(path, text))
    else {
      const runtimes = [...new Set(consumers.map((r) => r.runtime).filter(Boolean))]
      const mode = language(path, runtimes.length === 1 ? runtimes[0] : null)
      artifacts.push(mode ? analyzeArtifactSyntax(path, mode, text) : unsupported(path, text))
    }
  }
  const inlineAnalyses = references.inlineScripts.map((script) => {
    const mode = language('', script.runtime)
    return {
      ...(mode
        ? analyzeArtifactSyntax(script.workflowPath, mode, script.source)
        : unsupported(script.workflowPath, script.source)),
      nodeId: script.nodeId,
    }
  })
  // Verify new generated claims, allowing ordinary edits to replace stale old digests.
  await generatePackageDigests(snapshot.files, deps.contract)
  const integrityFindings: PackageFinding[] = []
  const projectedError = projectedPackageTraversalError(snapshot, deps.contract)
  if (projectedError)
    integrityFindings.push({
      path: 'digests.json',
      code: projectedError,
      severity: 'blocking',
      message: 'Generating package metadata would exceed the traversal limit.',
    })
  if (!deps.index)
    integrityFindings.push({
      path: MARKETPLACE_INDEX_PATH,
      code: 'package_index_unverified',
      severity: 'blocking',
      message: 'Repository index checks must complete before package preparation.',
    })
  else {
    try {
      await reconcilePackageIndex(
        deps.index,
        pkg.manifest,
        pkg.root,
        await composePackageDigest(snapshot.files, deps.contract.digest_rules),
        deps.contract,
      )
    } catch (error) {
      integrityFindings.push({
        path: MARKETPLACE_INDEX_PATH,
        code: error instanceof Error ? error.message : 'package_index_invalid',
        severity: 'blocking',
        message: 'The repository index conflicts with package preparation.',
      })
    }
  }
  const analysis = analyzePackageReadiness({
    package: pkg,
    contract: deps.contract,
    scan,
    manifestText,
    resources,
    artifactAnalyses: artifacts,
    inlineAnalyses,
    catalogFindings: catalog.findings,
    integrity: { state: 'verified', findings: integrityFindings },
  })
  return { package: pkg, snapshot, manifestText, artifactTexts: texts, analyzedHashes, analysis }
}
