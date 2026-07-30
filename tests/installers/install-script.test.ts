import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SUPPORTED_TARGETS,
  normalizeUpdaterManifest,
  selectInstallerAsset,
  validateChecksumText,
  validateReleaseManifest,
} from '../../scripts/verify-release-assets.mjs'

interface FixtureAsset {
  name: string
  size: number
  sha256?: string
}

interface ReleaseFixture {
  tag: string
  assets: FixtureAsset[]
  updater: {
    version: string
    notes: string
    pub_date: string
    platforms: Record<string, { url: string; signature: string }>
  }
}

const fixture = JSON.parse(readFileSync('tests/fixtures/releases/valid-manifest.json', 'utf8')) as ReleaseFixture

const TEST_UPDATER_PUBLIC_KEY = `untrusted comment: minisign public key E7620F1842B4E81F
RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3
`
const TEST_UPDATER_SIGNATURE_DOCUMENT = `untrusted comment: signature from minisign secret key
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=
trusted comment: timestamp:1556193335\tfile:test
y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==`
const TEST_UPDATER_SIGNATURE = Buffer.from(TEST_UPDATER_SIGNATURE_DOCUMENT).toString('base64')
const signatureVerifierPath = join(
  'src-tauri',
  'target',
  'debug',
  'examples',
  `verify_release_signature${process.platform === 'win32' ? '.exe' : ''}`,
)

function materializeCryptoRelease(useApiUrls = false) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-assets-'))
  const directory = join(root, 'assets')
  const tauriConfig = join(root, 'tauri.conf.json')
  mkdirSync(directory)

  const updater = structuredClone(fixture.updater)
  for (const platform of Object.values(updater.platforms)) {
    platform.signature = TEST_UPDATER_SIGNATURE
    if (useApiUrls) {
      platform.url = 'https://api.github.com/repos/cmetech/workflow-studio/releases/assets/12345'
    }
  }
  for (const asset of fixture.assets) {
    if (asset.name === 'SHA256SUMS') continue
    let bytes = `installer:${asset.name}\n`
    if (asset.name === 'latest.json') bytes = `${JSON.stringify(updater)}\n`
    if (asset.name.endsWith('.sig')) bytes = `${TEST_UPDATER_SIGNATURE}\n`
    if (/\.(?:app|nsis|AppImage)\.(?:tar\.gz|zip)$/.test(asset.name)) bytes = 'test'
    writeFileSync(join(directory, asset.name), bytes)
  }
  writeFileSync(
    tauriConfig,
    `${JSON.stringify({ plugins: { updater: { pubkey: Buffer.from(TEST_UPDATER_PUBLIC_KEY).toString('base64') } } })}\n`,
  )
  return { root, directory, tauriConfig }
}

function manifestWith(mutator: (copy: ReleaseFixture) => void): ReleaseFixture {
  const copy = structuredClone(fixture)
  mutator(copy)
  return copy
}

describe('release asset verification', () => {
  beforeAll(() => {
    const build = spawnSync('cargo', [
      'build',
      '--quiet',
      '--locked',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--example',
      'verify_release_signature',
    ])
    expect(build.status, build.stderr?.toString()).toBe(0)
  }, 60_000)
  it.each([
    ['darwin', 'aarch64', 'LOOP24-Workflow-Studio_0.1.0_macos_aarch64.dmg'],
    ['darwin', 'x86_64', 'LOOP24-Workflow-Studio_0.1.0_macos_x86_64.dmg'],
    ['windows', 'x86_64', 'LOOP24-Workflow-Studio_0.1.0_windows_x86_64-setup.exe'],
    ['linux', 'x86_64', 'LOOP24-Workflow-Studio_0.1.0_linux_x86_64.AppImage'],
  ])('selects exactly one %s/%s installer', (os, arch, expected) => {
    expect(selectInstallerAsset(fixture.assets, fixture.tag, os, arch).name).toBe(expected)
  })

  it.each([
    ['windows', 'aarch64'],
    ['linux', 'aarch64'],
    ['freebsd', 'x86_64'],
    ['darwin', 'arm64'],
  ])('fails clearly rather than falling back for unsupported %s/%s', (os, arch) => {
    expect(() => selectInstallerAsset(fixture.assets, fixture.tag, os, arch)).toThrow(
      `Unsupported release target: ${os}/${arch}`,
    )
  })

  it('declares only native targets proven by the release matrix', () => {
    expect(SUPPORTED_TARGETS).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64', 'linux-x86_64'])
  })

  it('accepts complete branded assets, checksums, signatures, and updater coverage', () => {
    expect(validateReleaseManifest(fixture)).toEqual({
      tag: 'v0.1.0',
      version: '0.1.0',
      assetCount: 14,
      updaterTargets: SUPPORTED_TARGETS,
    })
  })

  it('normalizes Tauri Action API URLs to public exact-tag asset URLs without altering signatures', () => {
    const updater = structuredClone(fixture.updater)
    for (const platform of Object.values(updater.platforms)) {
      platform.url = 'https://api.github.com/repos/cmetech/workflow-studio/releases/assets/12345'
    }
    const normalized = normalizeUpdaterManifest(updater, fixture.tag)
    expect(normalized.platforms['darwin-aarch64-app']).toEqual({
      url: 'https://github.com/cmetech/workflow-studio/releases/download/v0.1.0/LOOP24-Workflow-Studio_0.1.0_macos_aarch64.app.tar.gz',
      signature: 'signed-darwin-arm',
    })
    expect(normalized.platforms['windows-x86_64'].url).toContain(
      '/v0.1.0/LOOP24-Workflow-Studio_0.1.0_windows_x86_64.nsis.zip',
    )
    expect(updater.platforms['windows-x86_64']!.url).toContain('api.github.com')
  })

  it.each([
    'Other-Workflow-Studio_0.1.0_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_9.9.9_linux_x86_64.AppImage',
    '../LOOP24-Workflow-Studio_0.1.0_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_0.1.0_linux_x86_64/app.AppImage',
    'loop24-workflow-studio_0.1.0_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_0.1.0_linux_x86_64.AppImage\nsecond',
  ])('rejects a wrong-brand/version or unsafe asset name: %s', (name) => {
    const invalid = manifestWith((copy) => {
      copy.assets[9] = { ...copy.assets[9]!, name }
    })
    expect(() => validateReleaseManifest(invalid)).toThrow()
  })

  it('rejects case-folded collisions and duplicate installers', () => {
    const invalid = manifestWith((copy) => {
      copy.assets.push({ ...copy.assets[9]!, name: copy.assets[9]!.name.toLowerCase() })
    })
    expect(() => validateReleaseManifest(invalid)).toThrow(/collision/i)
  })

  it('rejects missing checksums, signature companions, updater targets, and empty bytes', () => {
    const noChecksum = manifestWith((copy) => {
      copy.assets[0]!.sha256 = undefined
    })
    const noSignature = manifestWith((copy) => {
      copy.assets = copy.assets.filter((asset) => !asset.name.endsWith('macos_aarch64.app.tar.gz.sig'))
    })
    const noUpdaterTarget = manifestWith((copy) => {
      delete copy.updater.platforms['linux-x86_64']
    })
    const zeroBytes = manifestWith((copy) => {
      copy.assets[0]!.size = 0
    })

    expect(() => validateReleaseManifest(noChecksum)).toThrow(/checksum/i)
    expect(() => validateReleaseManifest(noSignature)).toThrow(/signature/i)
    expect(() => validateReleaseManifest(noUpdaterTarget)).toThrow(/updater target/i)
    expect(() => validateReleaseManifest(zeroBytes)).toThrow(/empty/i)
  })

  it('rejects updater URLs for unknown or cross-release assets', () => {
    const invalid = manifestWith((copy) => {
      copy.updater.platforms['linux-x86_64']!.url =
        'https://github.com/cmetech/workflow-studio/releases/download/v0.1.0/not-uploaded.tar.gz'
    })
    expect(() => validateReleaseManifest(invalid)).toThrow(/not present/i)
  })

  it('rejects missing or cross-version updater identity fields', () => {
    const missingDate = manifestWith((copy) => {
      copy.updater.pub_date = ''
    })
    const wrongVersion = manifestWith((copy) => {
      copy.updater.version = '9.9.9'
    })
    expect(() => validateReleaseManifest(missingDate)).toThrow(/publication date/i)
    expect(() => validateReleaseManifest(wrongVersion)).toThrow(/updater version/i)
  })

  it('parses checksum lines as exact local filenames and rejects unknown paths', () => {
    const text = fixture.assets
      .filter((asset) => asset.sha256)
      .map((asset) => `${asset.sha256}  ${asset.name}`)
      .join('\n')
    expect(
      validateChecksumText(
        text,
        fixture.assets.map((asset) => asset.name),
      ),
    ).toHaveLength(13)
    expect(() => validateChecksumText(`${text}\n${'e'.repeat(64)}  ../outside`, [])).toThrow(/unknown checksum path/i)
  })

  it('separates updater normalization from checksumming published bytes', () => {
    const { root, directory, tauriConfig } = materializeCryptoRelease(true)
    try {
      const unpublished = spawnSync(
        process.execPath,
        [
          'scripts/verify-release-assets.mjs',
          '--directory',
          directory,
          '--tag',
          fixture.tag,
          '--write-checksums',
          '--signature-verifier',
          signatureVerifierPath,
          '--tauri-config',
          tauriConfig,
        ],
        { encoding: 'utf8' },
      )
      expect(unpublished.status).toBe(1)
      expect(unpublished.stderr).toContain('exact v0.1.0 release')
      expect(readFileSync(join(directory, 'latest.json'), 'utf8')).toContain('api.github.com')

      const normalized = spawnSync(
        process.execPath,
        ['scripts/verify-release-assets.mjs', '--directory', directory, '--tag', fixture.tag, '--normalize-updater'],
        { encoding: 'utf8' },
      )
      expect(normalized.status).toBe(0)
      expect(readFileSync(join(directory, 'latest.json'), 'utf8')).toContain('/releases/download/v0.1.0/')

      const checksummed = spawnSync(
        process.execPath,
        [
          'scripts/verify-release-assets.mjs',
          '--directory',
          directory,
          '--tag',
          fixture.tag,
          '--write-checksums',
          '--signature-verifier',
          signatureVerifierPath,
          '--tauri-config',
          tauriConfig,
        ],
        { encoding: 'utf8' },
      )
      expect(checksummed.status).toBe(0)
      const checksumBytes = readFileSync(join(directory, 'SHA256SUMS'), 'utf8')
      const latestBytes = readFileSync(join(directory, 'latest.json'), 'utf8')

      const finalValidation = spawnSync(
        process.execPath,
        [
          'scripts/verify-release-assets.mjs',
          '--directory',
          directory,
          '--tag',
          fixture.tag,
          '--signature-verifier',
          signatureVerifierPath,
          '--tauri-config',
          tauriConfig,
        ],
        { encoding: 'utf8' },
      )
      expect(finalValidation.status).toBe(0)
      expect(readFileSync(join(directory, 'SHA256SUMS'), 'utf8')).toBe(checksumBytes)
      expect(readFileSync(join(directory, 'latest.json'), 'utf8')).toBe(latestBytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects updater metadata that does not exactly match its companion signature before checksumming', () => {
    const { root, directory, tauriConfig } = materializeCryptoRelease()
    try {
      const updaterPath = join(directory, 'latest.json')
      const updater = JSON.parse(readFileSync(updaterPath, 'utf8')) as ReleaseFixture['updater']
      updater.platforms['linux-x86_64']!.signature = `${TEST_UPDATER_SIGNATURE}tampered`
      writeFileSync(updaterPath, `${JSON.stringify(updater)}\n`)

      const result = spawnSync(
        process.execPath,
        [
          'scripts/verify-release-assets.mjs',
          '--directory',
          directory,
          '--tag',
          fixture.tag,
          '--write-checksums',
          '--signature-verifier',
          signatureVerifierPath,
          '--tauri-config',
          tauriConfig,
        ],
        { encoding: 'utf8' },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('does not match its companion .sig')
      expect(() => readFileSync(join(directory, 'SHA256SUMS'))).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects updater bytes with an invalid cryptographic signature before checksumming', () => {
    const { root, directory, tauriConfig } = materializeCryptoRelease()
    try {
      writeFileSync(join(directory, 'LOOP24-Workflow-Studio_0.1.0_linux_x86_64.AppImage.tar.gz'), 'Test')
      const result = spawnSync(
        process.execPath,
        [
          'scripts/verify-release-assets.mjs',
          '--directory',
          directory,
          '--tag',
          fixture.tag,
          '--write-checksums',
          '--signature-verifier',
          signatureVerifierPath,
          '--tauri-config',
          tauriConfig,
        ],
        { encoding: 'utf8' },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Cryptographic updater signature verification failed')
      expect(() => readFileSync(join(directory, 'SHA256SUMS'))).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('downloader static safety', () => {
  const shell = () => readFileSync('scripts/install.sh', 'utf8')
  const powershell = () => readFileSync('scripts/install.ps1', 'utf8')

  it('contains no shell evaluation, remote pipe execution, security bypass, or broad cleanup', () => {
    for (const script of [shell(), powershell()]) {
      expect(script).not.toMatch(/\beval\b/)
      expect(script).not.toMatch(/curl[^\n|]*\|\s*(?:sh|bash)/i)
      expect(script).not.toMatch(/Invoke-Expression|\biex\b/i)
      expect(script).not.toMatch(/xattr\s+-[a-z]*d|spctl|Set-MpPreference|ExecutionPolicy\s+Bypass/i)
      expect(script).not.toMatch(/rm\s+-rf|Remove-Item[^\n]*-Recurse/i)
    }
  })

  it('uses exact architecture mapping, local SHA-256 verification, and verified launch ordering', () => {
    expect(shell()).toContain('uname -m')
    expect(shell()).toMatch(/sha256sum|shasum/)
    expect(shell()).toContain('EXPECTED_CHECKSUM')
    expect(powershell()).toContain('[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture')
    expect(powershell()).toContain('Get-FileHash')

    for (const script of [shell(), powershell()]) {
      const verification = script.indexOf('EXPECTED_CHECKSUM')
      const launch = Math.max(script.indexOf('open "$INSTALLER_PATH"'), script.indexOf('Start-Process'))
      expect(verification).toBeGreaterThan(-1)
      expect(launch).toBeGreaterThan(verification)
      expect(script).toMatch(/Unsupported (operating system|architecture|release target)/)
    }
  })

  it('installs a verified Linux AppImage to a durable user path before launching it', () => {
    const script = shell()
    expect(script).toContain('INSTALL_ROOT=')
    expect(script).toContain('INSTALLED_APPIMAGE_PATH=')
    expect(script).toContain('mv -f -- "$STAGED_APPIMAGE_PATH" "$INSTALLED_APPIMAGE_PATH"')
    expect(script.indexOf('"$INSTALLED_APPIMAGE_PATH"')).toBeGreaterThan(script.indexOf('EXPECTED_CHECKSUM'))
  })

  it('rejects non-Windows hosts before PowerShell performs network or architecture selection', () => {
    if (process.platform === 'win32') return
    const probe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'])
    if (probe.error) return

    const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-File', 'scripts/install.ps1'], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unsupported operating system')
    expect(result.stdout).not.toContain('checking the latest public release')
  })

  it('rejects a non-semantic GitHub tag before any artifact is downloaded', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-studio-installer-test-'))
    try {
      const uname = join(directory, 'uname')
      const curl = join(directory, 'curl')
      writeFileSync(uname, '#!/bin/sh\n[ "$1" = "-s" ] && echo Darwin || echo x86_64\n')
      writeFileSync(curl, '#!/bin/sh\nprintf \'{\\n  "tag_name": "v1.2x.3",\\n  "assets": []\\n}\\n\'\n')
      chmodSync(uname, 0o700)
      chmodSync(curl, 0o700)

      const result = spawnSync('sh', ['scripts/install.sh'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('latest release returned an invalid tag')
      expect(result.stdout).not.toContain('downloading LOOP24-Workflow-Studio')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

interface WorkflowJob {
  needs?: string | string[]
  permissions?: Record<string, string>
  strategy?: { 'max-parallel'?: number; matrix?: { include?: Array<Record<string, unknown>> } }
  steps?: Array<{
    name?: string
    uses?: string
    run?: string
    env?: Record<string, string>
    with?: Record<string, unknown>
  }>
}

interface ReleaseWorkflow {
  on?: {
    push?: { tags?: string[] }
    workflow_dispatch?: { inputs?: { tag?: { required?: boolean; type?: string } } }
  }
  permissions?: Record<string, string>
  jobs?: Record<string, WorkflowJob>
}

describe('release workflow contract', () => {
  const workflow = () => parse(readFileSync('.github/workflows/release.yml', 'utf8')) as ReleaseWorkflow

  it('runs only for version tags or an explicit required tag input with global read access', () => {
    const release = workflow()
    expect(release.on?.push?.tags).toEqual(['v*'])
    expect(release.on?.workflow_dispatch?.inputs?.tag).toMatchObject({ required: true, type: 'string' })
    expect(release.permissions).toEqual({ contents: 'read' })
  })

  it('uses the exact proven native matrix and current official action majors', () => {
    const build = workflow().jobs?.build
    const matrix = build?.strategy?.matrix?.include ?? []
    expect(matrix.map((row) => row.runner)).toEqual([
      'macos-latest',
      'macos-15-intel',
      'windows-latest',
      'ubuntu-24.04',
    ])
    expect(matrix.map((row) => `${row.platform}-${row.arch}`)).toEqual([
      'macos-aarch64',
      'macos-x86_64',
      'windows-x86_64',
      'linux-x86_64',
    ])
    expect(build?.strategy).toMatchObject({ 'max-parallel': 1 })
    const allUses = Object.values(workflow().jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .map((step) => step.uses)
      .filter(Boolean)
    expect(allUses).toContain('actions/checkout@v7')
    expect(allUses).toContain('actions/setup-node@v6')
    expect(allUses).toContain('tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f')
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain(
      '# tauri-apps/tauri-action v1 resolved and reviewed at 1deb371b0cd8bd54025b384f1cd735e725c4060f',
    )
  })

  it('limits write permission to draft upload jobs and sources updater signing only from secrets', () => {
    const release = workflow()
    expect(release.jobs?.validate?.permissions).toBeUndefined()
    expect(release.jobs?.build?.permissions).toEqual({ contents: 'write' })
    expect(release.jobs?.verify?.permissions).toEqual({ contents: 'write' })
    const yaml = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(yaml).toContain('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}')
    expect(yaml).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}')
    expect(yaml).not.toMatch(/APPLE_CERTIFICATE|APPLE_SIGNING_IDENTITY|WINDOWS_CERTIFICATE|AZURE_TENANT/)
    expect(yaml).toContain('releaseDraft: true')
    expect(yaml).not.toMatch(/gh release edit[^\n]*--draft=false/)
    const checkoutSteps = Object.values(release.jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses === 'actions/checkout@v7')
    expect(checkoutSteps.length).toBeGreaterThan(0)
    for (const step of checkoutSteps) {
      expect(step.with?.['persist-credentials']).toBe(false)
    }
    expect(yaml).not.toMatch(/env:\n\s+GH_TOKEN:[\s\S]{0,400}(?:npm ci|npm run)/)
  })

  it('checks the exact tag against base and verifies every draft asset before manual publication', () => {
    const yaml = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(yaml).toContain("ref: ${{ format('refs/tags/{0}', steps.requested-ref.outputs.tag) }}")
    expect(yaml.indexOf('id: requested-ref')).toBeLessThan(yaml.indexOf('- uses: actions/checkout@v7'))
    expect(yaml).toContain('git merge-base --is-ancestor "$TAG_COMMIT" "origin/base"')
    expect(yaml).toContain('commit: ${{ steps.release-ref.outputs.commit }}')
    expect(yaml).toContain('ref: ${{ needs.validate.outputs.commit }}')
    expect(yaml).toContain('releaseCommitish: ${{ needs.validate.outputs.commit }}')
    expect(yaml).toContain('REMOTE_TAG_COMMIT')
    expect(yaml).toContain('Tag moved after validation')
    const normalize = yaml.indexOf('--normalize-updater')
    const uploadLatest = yaml.indexOf('gh release upload "$TAG" "$ASSET_DIR/latest.json" --clobber')
    const redownloadPublished = yaml.indexOf('Re-download published updater bytes')
    const writeChecksums = yaml.indexOf('--write-checksums')
    const uploadChecksums = yaml.indexOf('gh release upload "$TAG" "$ASSET_DIR/SHA256SUMS"')
    const redownloadComplete = yaml.indexOf('Re-download completed draft')
    const finalValidate = yaml.lastIndexOf(
      'node scripts/verify-release-assets.mjs --directory "$ASSET_DIR" --tag "$TAG"',
    )
    expect(normalize).toBeGreaterThan(-1)
    expect(uploadLatest).toBeGreaterThan(normalize)
    expect(redownloadPublished).toBeGreaterThan(uploadLatest)
    expect(writeChecksums).toBeGreaterThan(redownloadPublished)
    expect(uploadChecksums).toBeGreaterThan(writeChecksums)
    expect(redownloadComplete).toBeGreaterThan(uploadChecksums)
    expect(finalValidate).toBeGreaterThan(redownloadComplete)
    expect(
      yaml.indexOf('cargo build --locked --manifest-path src-tauri/Cargo.toml --example verify_release_signature'),
    ).toBeLessThan(writeChecksums)
    expect(
      yaml.match(/--signature-verifier "\$SIGNATURE_VERIFIER" --tauri-config src-tauri\/tauri\.conf\.json/g),
    ).toHaveLength(2)
    expect(yaml).toContain(
      'node scripts/verify-release-assets.mjs --directory "$ASSET_DIR" --tag "$TAG" --write-checksums',
    )
    expect(yaml).toContain('if [[ "$ASSET_NAME" == "SHA256SUMS" ]]')
    expect(yaml).toContain('releases/assets/$ASSET_ID" --method DELETE')
    expect(yaml).toContain('gh release upload "$TAG" "$ASSET_DIR/SHA256SUMS"')
    expect(yaml).toContain('Draft release verified; publish it manually after review.')
  })

  it('installs the complete Linux native dependency set before compiling the release verifier', () => {
    const steps = workflow().jobs?.verify?.steps ?? []
    const dependencies = steps.findIndex((step) => step.name === 'Install Linux bundle dependencies')
    const verifier = steps.findIndex((step) => step.name === 'Build updater signature verifier')
    expect(dependencies).toBeGreaterThan(-1)
    expect(dependencies).toBeLessThan(verifier)
    expect(steps[dependencies]?.run).toContain(
      'sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils',
    )
  })
})

describe('release documentation contract', () => {
  it('documents safe one-line downloads without piping network responses to a shell', () => {
    const installing = readFileSync('docs/installing.md', 'utf8')
    expect(installing).toContain('curl --fail --location')
    expect(installing).toContain('Invoke-RestMethod')
    expect(installing).not.toMatch(/curl[^\n|]*\|\s*(?:sh|bash)/i)
    expect(installing).toContain('SHA256SUMS')
    expect(installing).toContain('Right-click')
    expect(installing).toContain('More info')
    expect(installing).not.toContain('/base/scripts/install')
    expect(installing.match(/2a0ec9f5c5bd95f693d8b97599653700d1471f0c\/scripts\/install/g)).toHaveLength(2)
    expect(installing).toContain('does not automatically adopt later bootstrap-script changes')
  })

  it('documents updater key custody, the base/tag invariant, draft verification, and no OS signing', () => {
    const releasing = readFileSync('docs/releasing.md', 'utf8')
    expect(releasing).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(releasing).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    expect(releasing).toContain('base')
    expect(releasing).toContain('draft')
    expect(releasing).toContain('unsigned')
    expect(releasing).toContain('Never publish a release from this workflow automatically')
    expect(releasing).toContain('re-downloads the published `latest.json` bytes before hashing')
    expect(releasing).toContain('re-downloads and validates the completed draft')
  })
})
