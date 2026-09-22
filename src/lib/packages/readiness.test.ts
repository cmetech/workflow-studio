import { beforeAll, describe, expect, it } from 'vitest'
import authoringText from '../../../contracts/archon-2026-07-v6.json?raw'
import manifestText from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json?raw'
import { loadAuthoringContract } from '../contract/contract-loader'
import type { AuthoringContract } from '../contract/types'
import {
  loadBundledResourceResolution,
  loadBundledWorkflowPackageContract,
} from '../package-contract/bundled-package-contract'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import type { WorkflowPackageContract } from '../package-contract/types'
import { analyzeWorkflowPair } from '../validation/analyze-workflow'
import { buildPackageCatalog } from './discovery'
import { analyzePackageReadiness, type PackageReadinessInput } from './readiness'

let authoring: AuthoringContract
let contract: WorkflowPackageContract
let resolver: ResourceResolutionContract
beforeAll(async () => {
  const result = await loadAuthoringContract(new TextEncoder().encode(authoringText), {
    kind: 'bundled',
    identifier: 'test',
  })
  if (!result.ok) throw new Error(result.code)
  authoring = result.contract
  contract = await loadBundledWorkflowPackageContract()
  resolver = (await loadBundledResourceResolution()).contract
})
async function fixture(
  extra: Record<string, string> = { 'scripts/job.py': 'pass\n' },
  script = 'job',
): Promise<PackageReadinessInput> {
  const definition = `name: test\ndescription: Test\nnodes:\n  - id: job\n    runtime: uv\n    script: ${script}\n`
  const companion = 'language_compatibility: archon-2026-07\n'
  const manifest = JSON.stringify({
    ...JSON.parse(manifestText),
    workflows: [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }],
  })
  const texts = new Map(
    Object.entries({
      'workflow-package.json': manifest,
      'main.yaml': definition,
      'main.hermes.yaml': companion,
      ...extra,
    }),
  )
  const files = [...texts].map(([relativePath, text]) => ({
    relativePath,
    kind: 'file' as const,
    size: new TextEncoder().encode(text).byteLength,
    readOnly: false,
    modifiedAt: '',
    symlink: 'none' as const,
  }))
  const catalog = buildPackageCatalog({
    contract,
    files,
    manifestTexts: new Map([['workflow-package.json', manifest]]),
  })
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'test',
      workflowId: 'main',
      pairGeneration: 1,
      definition: { path: 'main.yaml', text: definition, revision: 1 },
      companion: { path: 'main.hermes.yaml', text: companion, revision: 1 },
      profile: authoring.profile,
      contractDigest: authoring.contract_digest,
      reason: 'open',
    },
    authoring,
  )
  expect(analysis.structurallyValid).toBe(true)
  return {
    package: catalog.packages[0]!,
    contract,
    scan: files,
    manifestText: manifest,
    resources: {
      contract: resolver,
      packageRoot: '',
      members: catalog.packages[0]!.workflows,
      files: new Map(files.map((f) => [f.relativePath, { kind: f.kind }])),
      artifactTexts: texts,
      workflows: [{ path: 'main.yaml', authoring, analysis }],
    },
    artifactAnalyses: Object.entries(extra).map(([path, sourceText]) => ({
      path,
      sourceText,
      structurallyValid: true,
      findings: [],
    })),
    integrity: { state: 'verified', findings: [] },
  }
}
describe('package readiness', () => {
  it('keeps companion diagnostic paths package-relative for nested package navigation', async () => {
    const input = await fixture()
    const analysis = await analyzeWorkflowPair(
      {
        type: 'analyze',
        requestId: 'nested-companion',
        workflowId: 'packages/nested/main.yaml',
        pairGeneration: 1,
        definition: {
          path: 'packages/nested/main.yaml',
          text: input.resources.artifactTexts.get('main.yaml')!,
          revision: 1,
        },
        companion: {
          path: 'packages/nested/main.hermes.yaml',
          text: 'language_compatibility: archon-2026-07\ntags: 42\n',
          revision: 1,
        },
        profile: authoring.profile,
        contractDigest: authoring.contract_digest,
        reason: 'open',
      },
      authoring,
    )
    expect(analysis.issues.some((issue) => issue.document === 'companion' && issue.blocking)).toBe(true)
    const result = analyzePackageReadiness({
      ...input,
      package: {
        ...input.package,
        root: 'packages/nested',
        manifestPath: 'packages/nested/workflow-package.json',
        artifacts: input.package.artifacts.map((artifact) => ({
          ...artifact,
          workspacePath: 'packages/nested/' + artifact.path,
        })),
      },
      resources: {
        ...input.resources,
        packageRoot: 'packages/nested',
        workflows: [{ path: 'main.yaml', authoring, analysis }],
      },
    })
    for (const issue of analysis.issues.filter((item) => item.document === 'companion' && item.blocking)) {
      expect(result.blockers).toContainEqual(
        expect.objectContaining({ code: issue.code, path: 'main.hermes.yaml', line: issue.line, column: issue.column }),
      )
    }
  })
  it('requires current inline script analysis and rejects an explicit runtime mismatch', async () => {
    const input = await fixture({}, 'print(1)')
    expect(analyzePackageReadiness(input).blockers).toContainEqual(
      expect.objectContaining({ code: 'package_analysis_required' }),
    )
    const inlineAnalyses = [
      { path: 'main.yaml', nodeId: 'job', sourceText: 'print(1)', structurallyValid: true, findings: [] },
    ]
    expect(analyzePackageReadiness({ ...input, inlineAnalyses }).blockers).toEqual([])
    expect(analyzePackageReadiness(await fixture({ 'scripts/job.js': 'void 0;' }, 'job.js')).blockers).toContainEqual(
      expect.objectContaining({ code: 'package_runtime_extension_mismatch' }),
    )
  })
  it('blocks a missing packaged script while runtime availability remains advisory', async () => {
    const result = analyzePackageReadiness(await fixture({}))
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'package_resource_missing' }))
    expect(result.advisories).toContainEqual(expect.objectContaining({ code: 'runtime_unverified' }))
  })
  it('accepts complete local analyses without claiming execution success', async () => {
    const result = analyzePackageReadiness(await fixture())
    expect(result.blockers).toEqual([])
    expect(result.ready).toBe(true)
    expect(result.advisories).toContainEqual(expect.objectContaining({ code: 'execution_unverified' }))
    expect(result.executionSurface.artifactPaths).toContain('scripts/job.py')
  })
  it('requires fresh analyses of all packaged scripts, including unreferenced files', async () => {
    const input = await fixture({ 'scripts/job.py': 'pass', 'extras/unused.py': 'invalid(' })
    const stale = input.artifactAnalyses.map((a) => ({ ...a, sourceText: 'old' }))
    expect(analyzePackageReadiness({ ...input, artifactAnalyses: stale }).blockers).toContainEqual(
      expect.objectContaining({ code: 'package_analysis_required', path: 'extras/unused.py' }),
    )
    const invalid = input.artifactAnalyses.map((a) =>
      a.path === 'extras/unused.py' ? { ...a, structurallyValid: false } : a,
    )
    expect(analyzePackageReadiness({ ...input, artifactAnalyses: invalid }).blockers).toContainEqual(
      expect.objectContaining({ code: 'package_artifact_invalid', path: 'extras/unused.py' }),
    )
  })
  it('blocks path, manifest, size, digest and index defects deterministically', async () => {
    const input = await fixture()
    const scan = [
      ...input.scan,
      {
        relativePath: 'link',
        kind: 'file' as const,
        size: contract.resource_rules.max_file_bytes + 1,
        readOnly: false,
        modifiedAt: '',
        symlink: 'safe' as const,
      },
    ]
    const integrity = {
      state: 'verified' as const,
      findings: [
        {
          code: 'package_digest_mismatch',
          path: 'digests.json',
          severity: 'blocking' as const,
          message: 'Changed bytes.',
        },
        { code: 'index_conflict', path: '../catalog.json', severity: 'blocking' as const, message: 'Duplicate ID.' },
      ],
    }
    const result = analyzePackageReadiness({ ...input, scan, integrity, manifestText: '{}' })
    for (const code of [
      'package_symlink_unsupported',
      'package_file_size_limit',
      'package_manifest_invalid',
      'package_digest_mismatch',
      'index_conflict',
    ])
      expect(result.blockers.some((f) => f.code === code)).toBe(true)
    expect(
      analyzePackageReadiness({
        ...input,
        scan: scan.slice().reverse(),
        integrity: { ...integrity, findings: integrity.findings.slice().reverse() },
        manifestText: '{}',
      }).findings,
    ).toEqual(result.findings)
    expect(analyzePackageReadiness({ ...input, integrity: { state: 'unchecked', findings: [] } }).ready).toBe(false)
  })
  it('uses the current scan rather than stale resolver file metadata', async () => {
    const input = await fixture()
    const result = analyzePackageReadiness({
      ...input,
      scan: input.scan.filter((f) => f.relativePath !== 'scripts/job.py'),
    })
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'package_resource_missing' }))
  })
  it('accepts an extensionless named script when its static analysis is current', async () => {
    const input = await fixture({ 'scripts/job': 'pass' })
    expect(analyzePackageReadiness(input).blockers).toEqual([])
  })
})
