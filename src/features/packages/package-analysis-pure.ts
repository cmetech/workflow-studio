import type { AuthoringContract } from '$src/lib/contract/types'
import type { WorkspacePackageSnapshot } from '$src/lib/native/types'
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

export interface PackageAnalysisInput {
  readonly snapshot: WorkspacePackageSnapshot
  readonly texts: ReadonlyMap<string, string>
  readonly contract: WorkflowPackageContract
  readonly resourceContract: ResourceResolutionContract
  readonly authoring: readonly AuthoringContract[]
  readonly index?: PackageIndexContext
}
export interface PackageAnalysisResult {
  readonly package: WorkflowPackageProjection
  readonly analysis: Omit<PackageAnalysis, 'references'> & {
    readonly references: Omit<PackageAnalysis['references'], 'forNode'>
  }
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

/** Pure derived analysis; accepts verified bytes and has no filesystem, Git, or execution authority. */
export async function analyzeCapturedPackage(deps: PackageAnalysisInput): Promise<PackageAnalysisResult> {
  const { snapshot, texts } = deps
  const prefix = snapshot.packageRoot ? snapshot.packageRoot + '/' : ''
  const manifestText = texts.get('workflow-package.json')
  if (manifestText === undefined) throw new Error('package_manifest_invalid')
  const catalog = buildPackageCatalog({
    contract: deps.contract,
    files: snapshot.entries,
    manifestTexts: new Map([[prefix + 'workflow-package.json', manifestText]]),
  })
  const pkg = catalog.packages.find((p) => p.root === snapshot.packageRoot)
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
  const { references: values, inlineScripts, findings, unreferencedPaths } = analysis.references
  const serializedReferences = { references: values, inlineScripts, findings, unreferencedPaths }
  return { package: pkg, analysis: { ...analysis, references: serializedReferences } }
}
