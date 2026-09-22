import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncPackageContracts, checkPackageContracts } from './sync-package-contracts'

const roots: string[] = []
const files = ['workflow-package-v1.json', 'workflow-package-v1-vectors.json'] as const
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'studio-package-contract-'))
  roots.push(root)
  const sourceRoot = join(root, 'source')
  const destinationRoot = join(root, 'output')
  const artifacts = join(sourceRoot, 'plugins/workflow/contracts')
  await mkdir(artifacts, { recursive: true })
  for (const file of files) await writeFile(join(artifacts, file), await readFile(join('contracts', file)))
  const git = (...args: string[]) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'core.autocrlf=false',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  )
  const provenance = JSON.parse(await readFile('contracts/workflow-package-provenance.json', 'utf8'))
  provenance.commit = git('rev-parse', 'HEAD')
  return { sourceRoot, destinationRoot, artifacts, provenance }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

// Real Git fixtures may exceed the unit-test default under Windows filesystem scanning.
describe('package contract sync', { timeout: 30_000 }, () => {
  it('copies pinned committed bytes, ignoring dirty working-tree content and preserving unrelated files', async () => {
    const fixture = await repository()
    await writeFile(join(fixture.artifacts, files[0]), 'dirty checkout')
    await mkdir(fixture.destinationRoot)
    await writeFile(join(fixture.destinationRoot, 'unrelated.txt'), 'keep')
    const result = await syncPackageContracts(fixture)
    expect(result.files).toEqual(files)
    for (const file of files)
      expect(await readFile(join(fixture.destinationRoot, file))).toEqual(await readFile(join('contracts', file)))
    expect(await readFile(join(fixture.destinationRoot, 'unrelated.txt'), 'utf8')).toBe('keep')
    await expect(checkPackageContracts(fixture.destinationRoot, fixture.provenance)).resolves.toBeUndefined()
  })

  it('validates every source before writing any destination bytes', async () => {
    const fixture = await repository()
    fixture.provenance.files[files[1]] = '0'.repeat(64)
    await mkdir(fixture.destinationRoot)
    await expect(syncPackageContracts(fixture)).rejects.toThrow(/digest|checksum/i)
    expect(await readdir(fixture.destinationRoot)).toEqual([])
  })

  it('checks bundled files without needing the sibling repository', async () => {
    await expect(checkPackageContracts('contracts')).resolves.toBeUndefined()
  })

  it('rejects a linked output directory without changing its target', async () => {
    const fixture = await repository()
    const target = join(fixture.sourceRoot, 'target')
    await mkdir(target)
    await symlink(target, fixture.destinationRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(syncPackageContracts(fixture)).rejects.toThrow(/symlink|link/i)
    expect(await readdir(target)).toEqual([])
  })
})
