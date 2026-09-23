import { beforeAll, expect, it } from 'vitest'
import { loadBundledWorkflowPackageContract } from '$src/lib/package-contract/bundled-package-contract'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import {
  comparePackageVersions,
  suggestPackageVersion,
  packageVersionError,
  comparePackageFiles,
} from './package-version-actions'

let contract: WorkflowPackageContract
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
})
it('uses SemVer precedence, ignoring build metadata and comparing numeric prereleases numerically', () => {
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ]
  for (let i = 1; i < ordered.length; i++)
    expect(comparePackageVersions(ordered[i - 1]!, ordered[i]!, contract)).toBe(-1)
  expect(comparePackageVersions('1.0.0+one', '1.0.0+two', contract)).toBe(0)
  expect(comparePackageVersions('9007199254740993.0.0', '9007199254740992.0.0', contract)).toBe(1)
})
it('validates exact canonical versions against the pinned schema', () => {
  for (const invalid of ['1.0', '01.0.0', '1.0.0-01', '1.0.0\n', ' 1.0.0', '1.0.0+', '1.0.0-' + 'a'.repeat(128)])
    expect(packageVersionError(invalid, null, contract)).toBe('package_version_invalid')
  expect(packageVersionError('0.1.0', null, contract)).toBeNull()
})
it('requires precedence above the reachable baseline without treating build-only changes as a new version', () => {
  expect(packageVersionError('1.0.0+new', '1.0.0+old', contract)).toBe('package_version_not_increased')
  expect(packageVersionError('0.9.9', '1.0.0', contract)).toBe('package_version_not_increased')
  expect(packageVersionError('1.0.1', '1.0.0', contract)).toBeNull()
})
it('suggests deterministic patch, minor, and major increments with reasons', () => {
  const patch = { removedWorkflows: [], addedCapabilities: [], compatibilityChanged: false }
  expect(suggestPackageVersion(patch, '1.2.3', contract)).toMatchObject({ version: '1.2.4', kind: 'patch' })
  expect(suggestPackageVersion({ ...patch, addedCapabilities: ['workflow report'] }, '1.2.3', contract)).toMatchObject({
    version: '1.3.0',
    kind: 'minor',
  })
  expect(
    suggestPackageVersion({ ...patch, removedWorkflows: ['workflows/old.yaml'] }, '1.2.3', contract),
  ).toMatchObject({ version: '2.0.0', kind: 'major' })
  expect(suggestPackageVersion({ ...patch, compatibilityChanged: true }, '1.2.3', contract)).toMatchObject({
    version: '2.0.0',
    kind: 'major',
  })
  expect(suggestPackageVersion(patch, '9007199254740993.0.0', contract).version).toBe('9007199254740993.0.1')
})
it('reports exact added, changed, and deleted package files including generated metadata', () => {
  const before = [
    { relativePath: 'scripts/a.py', sha256: 'a', size: 1 },
    { relativePath: 'old.txt', sha256: 'b', size: 1 },
    { relativePath: 'same.txt', sha256: 's', size: 1 },
  ]
  const after = [
    { relativePath: 'scripts/a.py', sha256: 'z', size: 1 },
    { relativePath: 'digests.json', sha256: 'd', size: 4 },
    { relativePath: 'same.txt', sha256: 's', size: 1 },
  ]
  expect(comparePackageFiles(before, after)).toEqual([
    { kind: 'added', path: 'digests.json' },
    { kind: 'removed', path: 'old.txt' },
    { kind: 'modified', path: 'scripts/a.py' },
  ])
})
