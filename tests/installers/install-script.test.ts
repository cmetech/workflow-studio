import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
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

function manifestWith(mutator: (copy: ReleaseFixture) => void): ReleaseFixture {
  const copy = structuredClone(fixture)
  mutator(copy)
  return copy
}

describe('release asset verification', () => {
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
  strategy?: { matrix?: { include?: Array<Record<string, unknown>> } }
  steps?: Array<{ uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }>
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
    expect(allUses).toContain('tauri-apps/tauri-action@v1')
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
  })

  it('checks the exact tag against base and verifies every draft asset before manual publication', () => {
    const yaml = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(yaml).toContain('git merge-base --is-ancestor "$TAG_COMMIT" "origin/base"')
    expect(yaml).toContain('releaseCommitish: ${{ needs.validate.outputs.tag }}')
    expect(yaml).toContain(
      'node scripts/verify-release-assets.mjs --directory release-assets --tag "$TAG" --write-checksums',
    )
    expect(yaml).toContain('if [[ "$ASSET_NAME" == "SHA256SUMS" ]]')
    expect(yaml).toContain('releases/assets/$ASSET_ID" --method DELETE')
    expect(yaml).toContain('gh release upload "$TAG" release-assets/SHA256SUMS')
    expect(yaml).toContain('Draft release verified; publish it manually after review.')
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
  })

  it('documents updater key custody, the base/tag invariant, draft verification, and no OS signing', () => {
    const releasing = readFileSync('docs/releasing.md', 'utf8')
    expect(releasing).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(releasing).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    expect(releasing).toContain('base')
    expect(releasing).toContain('draft')
    expect(releasing).toContain('unsigned')
    expect(releasing).toContain('Never publish a release from this workflow automatically')
  })
})
