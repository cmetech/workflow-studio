import { beforeAll, expect, it } from 'vitest'
import { loadBundledResourceResolution } from '../package-contract/bundled-package-contract'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import { classifyPackageArtifact } from './artifact-kind'

let contract: ResourceResolutionContract
beforeAll(async () => {
  contract = (await loadBundledResourceResolution()).contract
})
it('gives membership and generated metadata precedence over editor extension hints', () => {
  const members = [{ definition: 'workflows/main.yaml', companion: 'workflows/main.hermes.yaml' }]
  const classify = (path: string) => classifyPackageArtifact({ path, members, contract, textAvailable: true })
  expect(classify('workflows/main.yaml')).toEqual({ kind: 'workflow', requiresStaticAnalysis: false })
  expect(classify('workflows/main.hermes.yaml').kind).toBe('companion')
  expect(classify('digests.json').kind).toBe('generated')
  expect(classify('data/digests.json').kind).toBe('json')
  expect(classify('commands/review.md').kind).toBe('command')
  expect(classify('README.md').kind).toBe('text')
})
it('uses exported suffixes for script editor selection, including unreferenced scripts', () => {
  const classify = (path: string) => classifyPackageArtifact({ path, members: [], contract, textAvailable: true })
  expect(classify('tools/helper.py')).toEqual({ kind: 'script', requiresStaticAnalysis: true })
  expect(classify('scripts/web.ts').kind).toBe('script')
  expect(classify('scripts/web.js').kind).toBe('script')
  expect(classify('scripts/task.sh').kind).toBe('text')
  expect(classifyPackageArtifact({ path: 'logo.png', members: [], contract, textAvailable: false }).kind).toBe('binary')
})
