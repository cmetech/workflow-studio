import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as releaseAssets from '../../scripts/verify-release-assets.mjs'

const RESOURCE_MANIFEST = 'src-tauri/resources/setup-integrity-v1.json'
const RESOURCE_DIRECTORIES = ['brands', 'contracts', 'examples']

type PackagedResourceVerifier = (
  resourceRoot: string,
  integrityManifestPath: string,
) => Promise<{ verifiedFiles: number }>

function verifier(): PackagedResourceVerifier {
  const candidate = (releaseAssets as Record<string, unknown>).verifyPackagedResources
  expect(typeof candidate).toBe('function')
  return candidate as PackagedResourceVerifier
}

function materializeResourceRoot() {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-packaged-resources-'))
  const manifest = JSON.parse(readFileSync(RESOURCE_MANIFEST, 'utf8')) as {
    files: Array<{ path: string }>
  }

  for (const entry of manifest.files) {
    const destination = join(root, entry.path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(entry.path, destination)
  }
  const manifestPath = join(root, RESOURCE_MANIFEST)
  mkdirSync(dirname(manifestPath), { recursive: true })
  cpSync(RESOURCE_MANIFEST, manifestPath)

  return { root, manifest, manifestPath }
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
}

describe('packaged resource verification', () => {
  it('accepts the exact 30-file packaged resource tree', async () => {
    const { root, manifestPath } = materializeResourceRoot()
    try {
      await expect(verifier()(root, manifestPath)).resolves.toEqual({ verifiedFiles: 30 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects protected resources changed from LF to CRLF bytes', async () => {
    const { root, manifestPath } = materializeResourceRoot()
    try {
      const target = join(root, 'examples/README.md')
      writeFileSync(target, readFileSync(target).toString().replaceAll('\n', '\r\n'))
      await expect(verifier()(root, manifestPath)).rejects.toThrow(/sha-256 mismatch/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'a duplicate manifest entry',
      (manifest: { schemaVersion: number; files: Array<{ path: string }> }) => manifest.files.push(manifest.files[0]!),
      /duplicate/i,
    ],
    [
      'an unsupported manifest schema',
      (manifest: { schemaVersion: number; files: Array<{ path: string }> }) => {
        manifest.schemaVersion = 2
      },
      /schema version/i,
    ],
  ])('rejects %s', async (_kind, mutate, expectedError) => {
    const { root, manifestPath } = materializeResourceRoot()
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        schemaVersion: number
        files: Array<{ path: string }>
      }
      mutate(manifest)
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
      await expect(verifier()(root, manifestPath)).rejects.toThrow(expectedError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing', (root: string) => unlinkSync(join(root, 'examples/README.md')), /missing/i],
    ['extra', (root: string) => writeFileSync(join(root, 'brands/unexpected.txt'), 'unexpected\n'), /extra/i],
    [
      'symlinked',
      (root: string) => {
        const target = join(root, 'examples/README.md')
        unlinkSync(target)
        symlinkSync(join(root, 'contracts/README.md'), target)
      },
      /symbolic link/i,
    ],
    [
      'oversized',
      (root: string) => writeFileSync(join(root, 'examples/README.md'), Buffer.alloc(2 * 1024 * 1024 + 1)),
      /maximum size/i,
    ],
    [
      'non-regular',
      (root: string) => {
        const target = join(root, 'examples/README.md')
        unlinkSync(target)
        mkdirSync(target)
      },
      /regular file/i,
    ],
  ])('rejects a %s packaged-resource entry', async (_kind, mutate, expectedError) => {
    const { root, manifestPath } = materializeResourceRoot()
    try {
      mutate(root)
      await expect(verifier()(root, manifestPath)).rejects.toThrow(expectedError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps every protected resource byte-stable in an autocrlf checkout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-autocrlf-'))
    const repository = join(root, 'repository')
    const checkout = join(root, 'checkout')
    mkdirSync(repository)
    try {
      for (const directory of RESOURCE_DIRECTORIES) {
        cpSync(directory, join(repository, directory), { recursive: true })
      }
      const manifestPath = join(repository, RESOURCE_MANIFEST)
      mkdirSync(dirname(manifestPath), { recursive: true })
      cpSync(RESOURCE_MANIFEST, manifestPath)
      cpSync('.gitattributes', join(repository, '.gitattributes'))

      runGit(repository, ['init', '--quiet'])
      runGit(repository, ['config', 'core.autocrlf', 'false'])
      runGit(repository, ['config', 'user.email', 'workflow-studio@example.test'])
      runGit(repository, ['config', 'user.name', 'Workflow Studio Test'])
      runGit(repository, ['add', '.'])
      runGit(repository, ['commit', '--quiet', '-m', 'resource fixture'])
      runGit(root, ['-c', 'core.autocrlf=true', 'clone', '--quiet', repository, checkout])

      const manifest = JSON.parse(readFileSync(RESOURCE_MANIFEST, 'utf8')) as {
        files: Array<{ path: string }>
      }
      for (const entry of manifest.files) {
        expect(readFileSync(join(checkout, entry.path))).toEqual(readFileSync(entry.path))
      }
      await expect(verifier()(checkout, join(checkout, RESOURCE_MANIFEST))).resolves.toEqual({ verifiedFiles: 30 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
