import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { expect, it } from 'vitest'
import authoringText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from '../contract/contract-loader'
import {
  loadBundledResourceResolution,
  loadBundledWorkflowPackageContract,
} from '../package-contract/bundled-package-contract'
import { analyzeWorkflowPair } from '../validation/analyze-workflow'
import { buildPackageCatalog } from './discovery'
import { resolvePackageReferences } from './package-references'

it('loads the complete laptop fixture and binds shared scripts from its package root', async () => {
  const root = resolve('tests/fixtures/workflow-packages/laptop-diagnostic')
  const texts = new Map<string, string>()
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const absolute = `${entry.parentPath}/${entry.name}`
      const path = relative(root, absolute).replaceAll('\\', '/')
      texts.set(path, await readFile(absolute, 'utf8'))
    }
  }
  const contract = await loadBundledWorkflowPackageContract()
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
    manifestTexts: new Map([['workflow-package.json', texts.get('workflow-package.json')!]]),
  })
  expect(catalog.findings).toEqual([])
  const pack = catalog.packages[0]!
  const loaded = await loadAuthoringContract(new TextEncoder().encode(authoringText), {
    kind: 'bundled',
    identifier: 'test',
  })
  if (!loaded.ok) throw new Error(loaded.code)
  const authoring = loaded.contract
  const member = pack.workflows[0]!
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'fixture',
      workflowId: 'fixture',
      pairGeneration: 1,
      definition: { path: member.definition, text: texts.get(member.definition)!, revision: 1 },
      companion: { path: member.companion!, text: texts.get(member.companion!)!, revision: 1 },
      profile: authoring.profile,
      contractDigest: authoring.contract_digest,
      reason: 'open',
    },
    authoring,
  )
  expect(analysis.issues.filter((i) => i.blocking)).toEqual([])
  const graph = resolvePackageReferences({
    contract: (await loadBundledResourceResolution()).contract,
    packageRoot: '',
    members: pack.workflows,
    files: new Map(files.map((f) => [f.relativePath, { kind: f.kind }])),
    artifactTexts: texts,
    workflows: [{ path: member.definition, authoring, analysis }],
  })
  expect(graph.findings).toEqual([])
  expect(graph.forNode('analyze-cpu')).toContainEqual(
    expect.objectContaining({ artifactPath: 'scripts/analyze-snapshot.py' }),
  )
  expect(graph.forNode('analyze-memory')).toContainEqual(
    expect.objectContaining({ artifactPath: 'scripts/analyze-snapshot.py' }),
  )
  expect(graph.forNode('interpret-report')).toContainEqual(
    expect.objectContaining({ artifactPath: 'commands/interpret-report.md' }),
  )
  expect(graph.unreferencedPaths).toContain('fixtures/laptop-snapshot.json')
})
