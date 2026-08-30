import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as releaseAssets from '../../scripts/verify-release-assets.mjs'

const RESOURCE_MANIFEST = 'src-tauri/resources/setup-integrity-v1.json'
const RESOURCE_DIRECTORIES = ['brands', 'contracts', 'examples', 'docs/licenses']

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
  const cleanupRoot = mkdtempSync(join(tmpdir(), 'workflow-studio-packaged-resources-'))
  const root = join(cleanupRoot, 'resources')
  mkdirSync(root)
  const manifest = JSON.parse(readFileSync(RESOURCE_MANIFEST, 'utf8')) as {
    files: Array<{ path: string }>
  }

  for (const entry of manifest.files) {
    const destination = join(root, entry.path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(entry.path, destination)
  }
  const manifestPath = join(cleanupRoot, RESOURCE_MANIFEST)
  mkdirSync(dirname(manifestPath), { recursive: true })
  cpSync(RESOURCE_MANIFEST, manifestPath)

  return { cleanupRoot, root, manifest, manifestPath }
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
}

type PeFixture = {
  machine?: number
  optionalHeaderMagic?: number
  optionalHeaderSize?: number
  subsystem?: number
  dosMagic?: boolean
  peSignature?: boolean
  peOffset?: number
  size?: number
}

function writePeFixture(path: string, fixture: PeFixture = {}) {
  const peOffset = fixture.peOffset ?? 0x80
  const optionalHeaderMagic = fixture.optionalHeaderMagic ?? 0x20b
  const size = fixture.size ?? peOffset + 24 + 0xf0
  const bytes = Buffer.alloc(size)

  if (fixture.dosMagic !== false && size >= 2) bytes.write('MZ', 0, 'ascii')
  if (size >= 0x40) bytes.writeUInt32LE(peOffset, 0x3c)
  if (fixture.peSignature !== false && peOffset + 4 <= size) bytes.write('PE\0\0', peOffset, 'ascii')
  if (peOffset + 24 <= size) {
    bytes.writeUInt16LE(fixture.machine ?? 0x8664, peOffset + 4)
    bytes.writeUInt16LE(fixture.optionalHeaderSize ?? 0xf0, peOffset + 20)
  }
  if (peOffset + 26 <= size) {
    bytes.writeUInt16LE(optionalHeaderMagic, peOffset + 24)
    if (peOffset + 24 + 70 <= size) bytes.writeUInt16LE(fixture.subsystem ?? 2, peOffset + 24 + 68)
  }
  writeFileSync(path, bytes)
}

function verifyPackagedResourcesWithPe(root: string, manifestPath: string, executable: string) {
  return spawnSync(
    process.execPath,
    [
      'scripts/verify-release-assets.mjs',
      '--packaged-resource-root',
      root,
      '--integrity-manifest',
      manifestPath,
      '--pe-executable',
      executable,
    ],
    { encoding: 'utf8' },
  )
}

describe('packaged resource verification', () => {
  it('accepts the exact 32-file packaged resource tree', async () => {
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      await expect(verifier()(root, manifestPath)).resolves.toEqual({ verifiedFiles: 32 })
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
    }
  })

  it('rejects protected resources changed from LF to CRLF bytes', async () => {
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      const target = join(root, 'examples/README.md')
      writeFileSync(target, readFileSync(target).toString().replaceAll('\n', '\r\n'))
      await expect(verifier()(root, manifestPath)).rejects.toThrow(/sha-256 mismatch/i)
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
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
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        schemaVersion: number
        files: Array<{ path: string }>
      }
      mutate(manifest)
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
      await expect(verifier()(root, manifestPath)).rejects.toThrow(expectedError)
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing', (root: string) => unlinkSync(join(root, 'examples/README.md')), /missing/i],
    ['extra', (root: string) => writeFileSync(join(root, 'brands/unexpected.txt'), 'unexpected\n'), /extra/i],
    [
      'root-level extra',
      (root: string) => writeFileSync(join(root, 'unexpected-root-entry'), 'unexpected\n'),
      /extra/i,
    ],
    ['extra package.json', (root: string) => writeFileSync(join(root, 'package.json'), '{}\n'), /extra/i],
    ['empty directory', (root: string) => mkdirSync(join(root, 'examples/unexpected-empty')), /extra/i],
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
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      mutate(root)
      await expect(verifier()(root, manifestPath)).rejects.toThrow(expectedError)
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
    }
  })

  it('keeps every protected resource byte-stable in an autocrlf checkout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-autocrlf-'))
    const repository = join(root, 'repository')
    const checkout = join(root, 'checkout')
    mkdirSync(repository)
    try {
      for (const directory of RESOURCE_DIRECTORIES) {
        const destination = join(repository, directory)
        mkdirSync(dirname(destination), { recursive: true })
        cpSync(directory, destination, { recursive: true })
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
      const verification = spawnSync(
        process.execPath,
        [
          'scripts/verify-release-assets.mjs',
          '--source-resource-root',
          checkout,
          '--integrity-manifest',
          join(checkout, RESOURCE_MANIFEST),
        ],
        { encoding: 'utf8' },
      )
      expect(verification.status, verification.stderr).toBe(0)
      expect(verification.stdout).toContain('Verified 32 packaged resource files')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Windows packaged executable verification', () => {
  it('accepts an AMD64 GUI PE executable with a valid packaged resource tree', () => {
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      const executable = join(cleanupRoot, 'Workflow Studio.exe')
      writePeFixture(executable)

      const result = verifyPackagedResourcesWithPe(root, manifestPath, executable)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('Verified 32 packaged resource files')
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
    }
  })

  it.each([
    ['console subsystem', { subsystem: 3 }, /Windows GUI subsystem/i],
    ['x86 machine', { machine: 0x14c }, /AMD64/i],
    ['ARM64 machine', { machine: 0xaa64 }, /AMD64/i],
    ['invalid DOS signature', { dosMagic: false }, /DOS magic/i],
    ['invalid PE signature', { peSignature: false }, /PE signature/i],
    ['out-of-bounds PE offset', { peOffset: 0x1000, size: 0x200 }, /e_lfanew/i],
    ['truncated optional header', { size: 0x98 }, /truncated/i],
    ['partial PE32+ optional header', { optionalHeaderSize: 70 }, /truncated optional header/i],
  ] as const)('rejects a %s executable', (_kind, fixture, expectedError) => {
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      const executable = join(cleanupRoot, 'Workflow Studio.exe')
      writePeFixture(executable, fixture)

      const result = verifyPackagedResourcesWithPe(root, manifestPath, executable)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(expectedError)
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
    }
  })

  it('runs the packaged-resource gate after a valid PE gate', () => {
    const { cleanupRoot, root, manifestPath } = materializeResourceRoot()
    try {
      const executable = join(cleanupRoot, 'Workflow Studio.exe')
      writePeFixture(executable)
      unlinkSync(join(root, 'examples/README.md'))

      const result = verifyPackagedResourcesWithPe(root, manifestPath, executable)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/missing packaged resource/i)
    } finally {
      rmSync(cleanupRoot, { recursive: true, force: true })
    }
  })

  it('declares the Windows GUI subsystem and frontend favicon explicitly', () => {
    expect(
      readFileSync('src-tauri/src/main.rs', 'utf8').startsWith(
        '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]',
      ),
    ).toBe(true)
    expect(readFileSync('index.html', 'utf8')).toContain('<link rel="icon" href="/favicon.ico" type="image/x-icon" />')
  })
})
