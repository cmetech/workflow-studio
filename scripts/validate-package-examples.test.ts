import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { validatePackageExamples } from './validate-package-examples'

it('validates every complete bundled package with production contracts, static analysis and exact digests', async () => {
  expect(await validatePackageExamples()).toEqual([])
})

it('rejects modified package bytes and unresolved packaged commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loop24-package-examples-'))
  try {
    await cp('examples/packages', root, { recursive: true })
    const path = join(root, 'laptop-diagnostic/workflows/laptop-diagnostic.yaml')
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace('command: interpret-report', 'command: missing-command'),
    )
    const errors = await validatePackageExamples(root)
    expect(errors.some((error) => error.includes('digest'))).toBe(true)
    expect(errors.some((error) => error.includes('missing') || error.includes('unresolved'))).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects empty directories that cannot be preserved by the package file transaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loop24-package-empty-'))
  try {
    await cp('examples/packages', root, { recursive: true })
    await mkdir(join(root, 'laptop-diagnostic/empty-resource'))
    expect((await validatePackageExamples(root)).some((error) => error.includes('empty'))).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a linked ancestor in a nested package catalog path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loop24-package-linked-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'loop24-package-linked-target-'))
  try {
    await cp('examples/packages', root, { recursive: true })
    await cp('examples/packages/laptop-diagnostic', join(outside, 'laptop-diagnostic'), { recursive: true })
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const catalog = join(root, 'catalog.yaml')
    await writeFile(
      catalog,
      (await readFile(catalog, 'utf8')).replace('path: laptop-diagnostic', 'path: linked/laptop-diagnostic'),
    )
    expect((await validatePackageExamples(root)).some((error) => /link/i.test(error))).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
