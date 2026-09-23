import { beforeAll, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import diagnosticsManifest from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json?raw'
import productivityManifest from '../../../tests/fixtures/workflow-packages/multiple/packages/productivity/workflow-package.json?raw'
import {
  loadBundledWorkflowPackageContract,
  loadBundledWorkflowPackageVectors,
} from '../package-contract/bundled-package-contract'
import type { WorkflowPackageContract } from '../package-contract/types'
import type { WorkspaceFileEntry } from '../workspace/types'
import { pairWorkflowFiles } from '../workspace/pair-workflows'
import { buildPackageCatalog, findPackageManifestPaths } from './discovery'
import { validatePackagePaths } from './paths'

let contract: WorkflowPackageContract
let valid: Record<string, unknown>
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
  valid = (await loadBundledWorkflowPackageVectors()).validationVectors.find((v) => v.name === 'manifest_valid')!
    .value as Record<string, unknown>
})
function entry(relativePath: string, changes: Partial<WorkspaceFileEntry> = {}): WorkspaceFileEntry {
  return {
    relativePath,
    kind: 'file',
    size: 64,
    modifiedAt: '2026-09-22T00:00:00Z',
    symlink: 'none',
    readOnly: false,
    ...changes,
  }
}
function input(roots: string[], ids = roots.map((_, i) => `package-${i}`)) {
  return {
    contract,
    files: roots.flatMap((root) => [
      entry(`${root}/workflow-package.json`),
      entry(`${root}/main.yaml`),
      entry(`${root}/scripts/run.py`),
    ]),
    manifestTexts: new Map(
      roots.map((root, i) => [
        `${root}/workflow-package.json`,
        JSON.stringify({ ...valid, id: ids[i], workflows: [{ definition: 'main.yaml' }] }),
      ]),
    ),
  }
}

describe('package discovery', () => {
  it('discovers independent packages without changing ordinary workflow pairing', () => {
    const fixture = input(['packages/productivity', 'packages/diagnostics'], ['productivity', 'diagnostics'])
    fixture.manifestTexts.set('packages/productivity/workflow-package.json', productivityManifest)
    fixture.manifestTexts.set('packages/diagnostics/workflow-package.json', diagnosticsManifest)
    fixture.files.push(entry('ordinary.yaml'))
    const catalog = buildPackageCatalog(fixture)
    expect(catalog.packages.map((p) => p.id)).toEqual(['diagnostics', 'productivity'])
    expect(catalog.findings).toEqual([])
    expect(catalog.packages[0]!.artifacts.some((a) => a.path === 'scripts/run.py')).toBe(true)
    expect(pairWorkflowFiles('workspace', fixture.files).some((p) => p.relativePath === 'ordinary.yaml')).toBe(true)
  })

  it('sorts supplementary Unicode paths by code point rather than UTF-16 code unit', () => {
    const catalog = buildPackageCatalog(input(['\ud83d\ude00', '\ue000']))
    expect(catalog.packages.map((p) => p.root)).toEqual(['\ue000', '\ud83d\ude00'])
  })

  it('keeps a standalone workspace-root package discoverable', () => {
    const fixture = input(['a'])
    fixture.files = fixture.files.map((file) => ({ ...file, relativePath: file.relativePath.slice(2) }))
    fixture.manifestTexts = new Map([['workflow-package.json', fixture.manifestTexts.get('a/workflow-package.json')!]])
    expect(buildPackageCatalog(fixture).packages.map((p) => p.root)).toEqual([''])
  })

  it('does not advertise nested roots or duplicate IDs as valid packages', () => {
    for (const fixture of [input(['a', 'a/child']), input(['a', 'b'], ['same', 'same'])]) {
      const catalog = buildPackageCatalog(fixture)
      expect(catalog.packages).toEqual([])
      expect(catalog.findings.length).toBeGreaterThan(0)
    }
  })

  it('rejects every symlink, including a safe ancestor of a package root', () => {
    for (const symlink of ['safe', 'unsafe'] as const) {
      const fixture = input(['a'])
      fixture.files.push(entry('a', { kind: 'directory', symlink }))
      expect(buildPackageCatalog(fixture)).toMatchObject({
        packages: [],
        findings: expect.arrayContaining([expect.objectContaining({ code: 'package_symlink_unsupported' })]),
      })
    }
  })

  it('rejects missing members and leaves a separate valid package available', () => {
    const fixture = input(['a', 'b'])
    fixture.files = fixture.files.filter((f) => f.relativePath !== 'a/main.yaml')
    const catalog = buildPackageCatalog(fixture)
    expect(catalog.packages.map((p) => p.root)).toEqual(['b'])
    expect(catalog.findings.some((f) => f.code === 'package_member_missing')).toBe(true)
  })

  it('offers only the rejected existing manifest for repair while preserving a separate package', () => {
    const fixture = input(['a', 'b'])
    fixture.files = fixture.files.filter((f) => f.relativePath !== 'a/main.yaml')
    expect(buildPackageCatalog(fixture)).toMatchObject({
      repairableManifestPaths: ['a/workflow-package.json'],
      packages: [expect.objectContaining({ root: 'b' })],
    })
    fixture.files.push(entry('a/main.yaml'))
    expect(buildPackageCatalog(fixture)).toMatchObject({ repairableManifestPaths: [], findings: [] })
  })

  it('does not offer nested or aliased package roots as manifest repair paths', () => {
    for (const roots of [
      ['a', 'a/child'],
      ['a', 'A'],
    ])
      expect(buildPackageCatalog(input(roots))).toMatchObject({ packages: [], repairableManifestPaths: [] })
  })

  it('detects case-folded directory aliases and file/directory ancestry conflicts', () => {
    for (const paths of [
      ['fixtures/Stra\u00dfe/a', 'fixtures/STRASSE/b'],
      ['fixture', 'fixture/child'],
    ]) {
      const fixture = input(['a'])
      fixture.files.push(...paths.map((p) => entry(`a/${p}`)))
      expect(buildPackageCatalog(fixture).packages).toEqual([])
    }
  })

  it('uses exact manifest filenames, sorts by code point, and diagnoses malformed manifests', () => {
    expect(
      findPackageManifestPaths([
        entry('a/WORKFLOW-PACKAGE.JSON'),
        entry('z/workflow-package.json'),
        entry('a/workflow-package.json'),
      ]),
    ).toEqual(['a/workflow-package.json', 'z/workflow-package.json'])
    const fixture = input(['a'])
    fixture.manifestTexts.set('a/workflow-package.json', '{')
    expect(buildPackageCatalog(fixture).packages).toEqual([])
  })

  it('never accepts two roots with canonical segment ancestry', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'a/child', 'b', 'b/child', 'c'), { maxLength: 12 }), (roots) => {
        const catalog = buildPackageCatalog(input([...new Set(roots)]))
        for (const left of catalog.packages)
          for (const right of catalog.packages) {
            if (left !== right) expect(right.root.startsWith(`${left.root}/`)).toBe(false)
          }
      }),
      { numRuns: 40 },
    )
  })

  it('matches every upstream path vector and its diagnostic code', async () => {
    for (const vector of (await loadBundledWorkflowPackageVectors()).pathVectors) {
      const source = vector.input as { path?: string; paths?: string[]; kind?: string }
      const expected = vector.expected as { accepted: boolean; diagnosticCode?: string }
      const paths = source.paths ?? [source.path!]
      const findings = validatePackagePaths(
        paths.map((path) => entry(path, { symlink: source.kind === 'symlink' ? 'safe' : 'none' })),
      )
      expect(findings.length === 0, vector.name).toBe(expected.accepted)
      if (!expected.accepted)
        expect(
          findings.map((f) => f.code),
          vector.name,
        ).toContain(expected.diagnosticCode)
    }
  })
})
