import { freezePackageValue } from '../package-contract/package-contract-loader'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { WorkspaceFileEntry } from '../workspace/types'
import { classifyPackageArtifact } from './artifact-kind'
import { parsePackageManifest } from './manifest'
import {
  resolvePackageReferences,
  sortPackageFindings,
  type PackageReferenceGraph,
  type PackageReferenceInput,
} from './package-references'
import { comparePackagePaths, validatePackagePaths } from './paths'
import type { PackageFinding, WorkflowPackageProjection } from './types'

export interface ArtifactStaticAnalysis {
  readonly path: string
  /** Exact analyzed draft; stale results cannot make current bytes ready. */
  readonly sourceText: string
  readonly structurallyValid: boolean
  readonly findings: readonly PackageFinding[]
}
export interface PackageExecutionSurface {
  readonly workflowPaths: readonly string[]
  readonly artifactPaths: readonly string[]
  readonly inlineScripts: PackageReferenceGraph['inlineScripts']
}
export interface PackageAnalysis {
  readonly ready: boolean
  readonly findings: readonly PackageFinding[]
  readonly blockers: readonly PackageFinding[]
  readonly advisories: readonly PackageFinding[]
  readonly references: PackageReferenceGraph
  readonly executionSurface: PackageExecutionSurface
}
export interface PackageReadinessInput {
  readonly package: WorkflowPackageProjection
  readonly contract: WorkflowPackageContract
  /** Complete package-relative scan, including ignored and unreferenced files. */
  readonly scan: readonly WorkspaceFileEntry[]
  readonly manifestText: string
  readonly resources: PackageReferenceInput
  readonly artifactAnalyses: readonly ArtifactStaticAnalysis[]
  readonly inlineAnalyses?: readonly (ArtifactStaticAnalysis & { readonly nodeId: string })[]
  readonly catalogFindings?: readonly PackageFinding[]
  readonly integrity: { readonly state: 'unchecked' | 'verified'; readonly findings: readonly PackageFinding[] }
}

export function analyzePackageReadiness(input: PackageReadinessInput): PackageAnalysis {
  const findings: PackageFinding[] = [
    ...(input.catalogFindings ?? []),
    ...validatePackagePaths(input.scan),
    ...input.integrity.findings,
  ]
  const add = (code: string, path: string, message: string, severity: PackageFinding['severity'] = 'blocking') =>
    findings.push({ code, path, message, severity })
  const parsed = parsePackageManifest(input.manifestText, 'workflow-package.json', input.contract)
  findings.push(...parsed.findings)
  if (parsed.ok && JSON.stringify(parsed.manifest) !== JSON.stringify(input.package.manifest))
    add('package_analysis_required', 'workflow-package.json', 'Package projection must match the current manifest.')
  if (input.integrity.state !== 'verified')
    add(
      'package_integrity_unverified',
      'digests.json',
      'Digest and marketplace index checks must complete before preparation.',
    )
  const references = resolvePackageReferences({
    ...input.resources,
    files: new Map(
      input.scan.map((file) => [file.relativePath, { kind: file.symlink === 'none' ? file.kind : 'symlink' }]),
    ),
    maxArtifactBytes: input.contract.resource_rules.max_file_bytes,
  })
  findings.push(...references.findings)
  if (
    input.resources.packageRoot !== input.package.root ||
    JSON.stringify(input.resources.members) !== JSON.stringify(input.package.workflows)
  )
    add(
      'package_analysis_required',
      'workflow-package.json',
      'Resource analysis must cover this package and all workflow members.',
    )
  const limits = input.contract.resource_rules
  const files = input.scan.filter((f) => f.kind === 'file')
  const payload = files.filter((f) => !input.contract.digest_rules.excluded_paths.includes(f.relativePath))
  if (input.scan.length > limits.max_traversal_entries)
    add('package_traversal_limit', '', 'Package scan exceeds its entry limit.')
  if (payload.length > limits.max_files) add('package_file_count_limit', '', 'Package contains too many files.')
  if (payload.reduce((total, f) => total + f.size, 0) > limits.max_total_bytes)
    add('package_total_size_limit', '', 'Package exceeds its total size limit.')
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0)
      add('package_size_invalid', file.relativePath, 'File size metadata is invalid.')
    if (file.size > limits.max_file_bytes)
      add('package_file_size_limit', file.relativePath, 'File exceeds the package size limit.')
  }
  const present = new Set(files.map((f) => f.relativePath))
  const execution = new Set<string>()
  for (const member of input.package.workflows) {
    for (const path of [member.definition, ...(member.companion ? [member.companion] : [])])
      if (!present.has(path)) add('package_member_missing', path, 'Declared workflow member is missing.')
  }
  for (const workflow of input.resources.workflows) {
    for (const issue of workflow.analysis.issues)
      findings.push({
        code: issue.code,
        path: issue.document === 'companion' ? (workflow.analysis.companionPath ?? workflow.path) : workflow.path,
        message: issue.message,
        severity: issue.blocking ? 'blocking' : 'advisory',
        ...(issue.line !== undefined ? { line: issue.line } : {}),
        ...(issue.column !== undefined ? { column: issue.column } : {}),
      })
  }
  for (const file of files) {
    const path = file.relativePath
    const text = input.resources.artifactTexts.get(path)
    const artifact = classifyPackageArtifact({
      path,
      members: input.package.workflows,
      contract: input.resources.contract,
      textAvailable: text !== undefined,
    })
    const consumers = references.references.filter((r) => r.artifactPath === path)
    const resource = consumers.some((r) => r.kind !== 'mcp_resource')
    if (artifact.kind === 'script' || artifact.kind === 'command' || resource) execution.add(path)
    if (!artifact.requiresStaticAnalysis && !resource) continue
    const analyses = input.artifactAnalyses.filter((a) => a.path === path)
    const analysis = analyses[0]
    if (analyses.length !== 1 || !analysis || text === undefined || analysis.sourceText !== text) {
      add('package_analysis_required', path, 'Current static artifact analysis is required.')
      continue
    }
    findings.push(...analysis.findings)
    if (!analysis.structurallyValid) add('package_artifact_invalid', path, 'Artifact contains static syntax errors.')
    for (const consumer of consumers) {
      if (!consumer.runtime) continue
      const rule = input.resources.contract.runtime_validation as Record<string, unknown>
      const suffixes = rule[`${consumer.runtime}_suffixes`]
      const name = path.split('/').at(-1)!
      const dot = name.lastIndexOf('.')
      const suffix = dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : ''
      if (suffix && Array.isArray(suffixes) && !suffixes.includes(suffix))
        add('package_runtime_extension_mismatch', path, `Artifact extension is incompatible with ${consumer.runtime}.`)
    }
  }
  for (const script of references.inlineScripts) {
    const matches = (input.inlineAnalyses ?? []).filter(
      (a) => a.path === script.workflowPath && a.nodeId === script.nodeId,
    )
    const analysis = matches[0]
    if (matches.length !== 1 || !analysis || analysis.sourceText !== script.source) {
      add(
        'package_analysis_required',
        script.workflowPath,
        `${script.nodeId}: current inline script analysis is required.`,
      )
      continue
    }
    findings.push(...analysis.findings)
    if (!analysis.structurallyValid)
      add(
        'package_artifact_invalid',
        script.workflowPath,
        `${script.nodeId}: inline script contains static syntax errors.`,
      )
  }
  for (const [category, values] of Object.entries(input.package.manifest.externalRequirements)) {
    for (const value of values)
      add(
        category === 'runtimes' ? 'runtime_unverified' : 'external_requirement_unverified',
        'workflow-package.json',
        `${category}: ${value} must be available at the destination.`,
        'advisory',
      )
  }
  if (references.references.some((r) => r.ownership === 'external'))
    add(
      'external_resource_unverified',
      '',
      'MCP external resources and service availability are destination-dependent.',
      'advisory',
    )
  add(
    'execution_unverified',
    '',
    'Static readiness does not verify dependencies, credentials, trust, or execution success.',
    'advisory',
  )
  const sorted = sortPackageFindings(findings)
  const blockers = sorted.filter((f) => f.severity === 'blocking')
  return freezePackageValue({
    ready: blockers.length === 0,
    findings: sorted,
    blockers,
    advisories: sorted.filter((f) => f.severity === 'advisory'),
    references,
    executionSurface: {
      workflowPaths: input.package.workflows.map((m) => m.definition).sort(comparePackagePaths),
      artifactPaths: [...execution].sort(comparePackagePaths),
      inlineScripts: references.inlineScripts,
    },
  })
}
