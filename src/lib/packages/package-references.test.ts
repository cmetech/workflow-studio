import { beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import authoringText from '../../../contracts/archon-2026-07-v6.json?raw'
import vectors from '../../../contracts/workflow-package-resource-resolution-v1-vectors.json'
import { loadAuthoringContract } from '../contract/contract-loader'
import type { AuthoringContract } from '../contract/types'
import { loadBundledResourceResolution } from '../package-contract/bundled-package-contract'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import { projectWorkflow } from '../projection/project-workflow'
import { parseWorkflowYaml } from '../yaml/parse-document'
import { resolvePackageReferences, type PackageReferenceInput } from './package-references'

let authoring: AuthoringContract
let contract: ResourceResolutionContract
beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(authoringText), {
    kind: 'bundled',
    identifier: 'test',
  })
  if (!loaded.ok) throw new Error(loaded.code)
  authoring = loaded.contract
  contract = (await loadBundledResourceResolution()).contract
})

export function referenceFixture(
  workflow: unknown,
  files: Record<string, string> = {},
  version = 6,
): PackageReferenceInput {
  const parsed = parseWorkflowYaml(stringify(workflow), { document: 'definition', maxBytes: 1048576 }).parsed!
  const projection = projectWorkflow(parsed, null, authoring.profile, authoring).projection
  const path = 'workflows/main.yaml'
  return {
    contract,
    packageRoot: 'packages/example',
    members: [{ definition: path }],
    files: new Map(Object.keys(files).map((path) => [path, { kind: 'file' as const }])),
    artifactTexts: new Map(Object.entries(files)),
    workflows: [
      {
        path,
        authoring: { ...authoring, normalizer_version: version },
        analysis: {
          workflowId: path,
          pairGeneration: 1,
          definitionPath: `packages/example/${path}`,
          companionPath: null,
          definitionRevision: 1,
          companionRevision: null,
          contractDigest: authoring.contract_digest,
          projection,
          issues: [],
          structurallyValid: true,
        },
      },
    ],
  }
}

describe('workflow resource graph', () => {
  it('does not apply a script runtime to that node’s MCP definition', () => {
    const graph = resolvePackageReferences(
      referenceFixture(
        { name: 'test', nodes: [{ id: 'use', runtime: 'uv', script: 'job', mcp: 'local' }] },
        { 'scripts/job.py': 'pass', 'mcp/local.yaml': 'command: external' },
      ),
    )
    expect(graph.references.find((r) => r.kind === 'mcp')?.runtime).toBeUndefined()
  })
  it('rejects mismatched companion analysis and incomplete projected graphs', () => {
    const input = referenceFixture({ name: 'test', nodes: [{ id: 'use', prompt: 'hello' }] })
    const member = { definition: 'workflows/main.yaml', companion: 'workflows/main.hermes.yaml' }
    expect(resolvePackageReferences({ ...input, members: [member] }).findings).toContainEqual(
      expect.objectContaining({ code: 'package_analysis_required' }),
    )
    const workflow = input.workflows[0]!
    const view = workflow.analysis.projection as Record<string, unknown>
    expect(
      resolvePackageReferences({
        ...input,
        workflows: [{ ...workflow, analysis: { ...workflow.analysis, projection: { ...view, graphs: [] } } }],
      }).findings,
    ).toContainEqual(expect.objectContaining({ code: 'package_analysis_required' }))
  })
  it('fails closed when scope or closure semantics change', () => {
    const input = referenceFixture({ name: 'test', nodes: [{ id: 'use', prompt: 'hello' }] })
    for (const [field, key, value] of [
      ['scope', 'root', 'other[]'],
      ['mcp_local_closure', 'base', 'definition-directory'],
    ] as const) {
      const changed = structuredClone(contract)
      Reflect.set(changed[field] as object, key, value)
      expect(resolvePackageReferences({ ...input, contract: changed }).findings).toContainEqual(
        expect.objectContaining({ code: 'unsupported_resource_contract' }),
      )
    }
  })
  it.each(vectors.compilation.filter((f) => f.sources.length === 1 && 'resources' in f.expected))(
    'replays compiled resource bindings for $id',
    (fixture) => {
      const source = fixture.sources[0]!
      const input = referenceFixture(
        source.workflow,
        Object.fromEntries(
          Object.entries('files' in source ? (source.files as Record<string, string>) : {}).map(([path, text]) => [
            path,
            text.replaceAll('@HOST_PYTHON_JSON@', JSON.stringify('/fixture/python')),
          ]),
        ),
        fixture.normalizer_version,
      )
      const result = resolvePackageReferences({ ...input, hostPython: '/fixture/python' })
      expect(result.findings.filter((f) => f.severity === 'blocking')).toEqual([])
      expect(
        result.references
          .filter((r) => r.artifactPath)
          .map((r) => ({
            kind: r.kind,
            node_id: r.nodeId,
            package_key: `${source.key}:${source.workflow.name}`,
            path: r.artifactPath,
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual(fixture.expected.resources!.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    },
  )

  it('keeps shared resources, inline scripts and unreferenced files distinct without mutating source', () => {
    const workflow = {
      name: 'test',
      nodes: [
        { id: 'a', runtime: 'uv', script: 'job' },
        { id: 'b', runtime: 'uv', script: 'job' },
        { id: 'inline', runtime: 'uv', script: 'print(1)' },
      ],
      extra: { preserved: true },
    }
    const input = referenceFixture(workflow, { 'scripts/job.py': 'pass', 'data/unused.json': '{}' })
    const before = JSON.stringify(input.workflows[0]!.analysis.projection)
    const graph = resolvePackageReferences(input)
    expect(graph.forNode('a')).toContainEqual(expect.objectContaining({ artifactPath: 'scripts/job.py' }))
    expect(graph.forNode('b')).toHaveLength(1)
    expect(graph.inlineScripts).toContainEqual(expect.objectContaining({ nodeId: 'inline', source: 'print(1)' }))
    expect(graph.unreferencedPaths).toEqual(['data/unused.json'])
    expect(JSON.stringify(input.workflows[0]!.analysis.projection)).toBe(before)
  })

  it.each(vectors.compilation.filter((f) => f.sources.length > 1))(
    'requires catalog-selected origins for $id',
    (fixture) => {
      const graph = resolvePackageReferences(
        referenceFixture(fixture.sources[0]!.workflow, { 'commands/review.md': 'wrong origin' }),
      )
      expect(graph.findings).toContainEqual(
        expect.objectContaining({ code: 'resource_resolution_context_required', severity: 'blocking' }),
      )
      expect(graph.references).toEqual([])
    },
  )
  it.each(vectors.compilation.filter((f) => 'code' in f.expected))(
    'blocks rejected compilation fixture $id',
    (fixture) => {
      const input = referenceFixture(fixture.sources[0]!.workflow, {}, fixture.normalizer_version)
      // Workflow structural rejections remain owned by the authoring validator; the graph must honor them.
      const structural = fixture.id === 'unsupported-authored-mcp-default'
      const workflow = input.workflows[0]!
      const result = resolvePackageReferences(
        structural
          ? { ...input, workflows: [{ ...workflow, analysis: { ...workflow.analysis, structurallyValid: false } }] }
          : input,
      )
      expect(result.findings.some((f) => f.severity === 'blocking')).toBe(true)
      if (fixture.id === 'missing-packaged-mcp')
        expect(result.findings).toContainEqual(expect.objectContaining({ causeCode: fixture.expected.code }))
    },
  )

  it('blocks missing packaged files even when unrelated files exist', () => {
    const graph = resolvePackageReferences(
      referenceFixture(
        { name: 'test', nodes: [{ id: 'job', runtime: 'uv', script: 'missing' }] },
        { 'workflows/scripts/missing.py': 'pass' },
      ),
    )
    expect(graph.findings).toContainEqual(
      expect.objectContaining({ code: 'package_resource_missing', causeCode: 'missing_named_script' }),
    )
  })

  it('requires an MCP snapshot and bounds host-sensitive closure without probing the host', () => {
    const input = referenceFixture(
      { name: 'test', nodes: [{ id: 'use', prompt: 'hello', mcp: 'local' }] },
      { 'mcp/local.yaml': 'command: /usr/bin/python\n' },
    )
    expect(resolvePackageReferences({ ...input, artifactTexts: new Map() }).findings).toContainEqual(
      expect.objectContaining({ code: 'package_analysis_required' }),
    )
    expect(resolvePackageReferences(input).findings).toContainEqual(
      expect.objectContaining({ code: 'resource_resolution_context_required' }),
    )
    expect(resolvePackageReferences({ ...input, hostPython: '/usr/bin/python' }).findings).toEqual([])
  })

  it('rejects invalid MCP YAML and unsupported descriptor changes', () => {
    const input = referenceFixture(
      { name: 'test', nodes: [{ id: 'use', prompt: 'hello', mcp: 'local' }] },
      { 'mcp/local.yaml': 'args: [unclosed' },
    )
    expect(resolvePackageReferences(input).findings).toContainEqual(expect.objectContaining({ code: 'invalid_mcp' }))
    const changed = structuredClone(contract)
    Reflect.set(changed.scope as object, 'option_merge', 'first-wins')
    expect(resolvePackageReferences({ ...input, contract: changed }).findings).toContainEqual(
      expect.objectContaining({ code: 'unsupported_resource_contract' }),
    )
  })

  it('rejects stale contract identity, absent members, invalid workflow and unsafe first candidates', () => {
    const input = referenceFixture(
      { name: 'test', nodes: [{ id: 'a', runtime: 'uv', script: 'job' }] },
      { 'scripts/job.py': 'pass' },
    )
    expect(resolvePackageReferences({ ...input, workflows: [] }).findings).toContainEqual(
      expect.objectContaining({ code: 'package_analysis_required' }),
    )
    const item = input.workflows[0]!
    expect(
      resolvePackageReferences({
        ...input,
        workflows: [{ ...item, analysis: { ...item.analysis, structurallyValid: false } }],
      }).findings,
    ).toContainEqual(expect.objectContaining({ code: 'package_workflow_invalid' }))
    expect(
      resolvePackageReferences({
        ...input,
        workflows: [{ ...item, analysis: { ...item.analysis, contractDigest: 'sha256:wrong' } }],
      }).findings,
    ).toContainEqual(expect.objectContaining({ code: 'package_analysis_required' }))
    expect(
      resolvePackageReferences({
        ...input,
        files: new Map([...input.files, ['scripts/job', { kind: 'directory' as const }]]),
      }).findings,
    ).toContainEqual(expect.objectContaining({ code: 'include_resource_invalid' }))
  })
})
