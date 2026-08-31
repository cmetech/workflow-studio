import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const RELEASE_VERSION = '1.0.4'
const PRE_RELEASE_COMMIT = 'd164e1609f0af52fb3fbdcdd2bb19c9c6b2ed0dc'
const CI_UNIT_COMMAND = 'npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1'
const CI_NATIVE_COMMAND = 'npx --no-install tauri build --debug --config src-tauri/tauri.ci.conf.json'

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function baseCargoLock(): string {
  const result = spawnSync('git', ['show', '53792c7:src-tauri/Cargo.lock'], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

function preReleaseFile(path: string): string {
  const result = spawnSync('git', ['show', `${PRE_RELEASE_COMMIT}:${path}`], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

describe('version one release metadata', () => {
  it('checks out full Git history before running lockfile provenance tests in CI', () => {
    const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
      jobs?: { quality?: { steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown> }> } }
    }
    const steps = workflow.jobs?.quality?.steps ?? []
    const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'))
    const versionTestsIndex = steps.findIndex((step) => step.run === CI_UNIT_COMMAND)

    expect(checkoutIndex).toBeGreaterThanOrEqual(0)
    expect(versionTestsIndex).toBeGreaterThan(checkoutIndex)
    expect(steps[checkoutIndex]?.with?.['fetch-depth']).toBe(0)
  })

  it('uses the canonical cold-run unit profile and cross-platform native Tauri invocation in CI', () => {
    const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
      jobs?: {
        quality?: { steps?: Array<{ run?: string }> }
        'native-bundle'?: {
          strategy?: { matrix?: { os?: string[] } }
          steps?: Array<{ run?: string }>
        }
      }
    }
    const qualityCommands = (workflow.jobs?.quality?.steps ?? [])
      .map((step) => step.run)
      .filter((command) => command?.startsWith('npm run test:unit -- --testTimeout'))
    expect(qualityCommands).toEqual([CI_UNIT_COMMAND])

    const native = workflow.jobs?.['native-bundle']
    expect(native?.strategy?.matrix?.os).toEqual(['macos-latest', 'windows-latest', 'ubuntu-24.04'])
    expect(native?.steps?.map((step) => step.run).filter((command) => command?.includes('tauri build'))).toEqual([
      CI_NATIVE_COMMAND,
    ])
  })

  it('gives the intentional cold Rust release-verifier hook its full ten-minute budget', () => {
    const source = readFileSync('tests/installers/install-script.test.ts', 'utf8')
    const releaseVerifierBlock = source.match(
      /describe\('release asset verification'[\s\S]*?beforeAll\([\s\S]*?\},\s*([\d_]+)\)/,
    )
    expect(releaseVerifierBlock?.[1]).toBe('600_000')
  })

  it('keeps every package and native release version synchronized at 1.0.4', () => {
    const packageManifest = json('package.json')
    const packageLock = json('package-lock.json')
    const lockPackages = packageLock.packages as Record<string, Record<string, unknown>>
    const tauriConfig = json('src-tauri/tauri.conf.json')
    const cargoManifest = readFileSync('src-tauri/Cargo.toml', 'utf8')
    const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8')

    expect(packageManifest.version).toBe(RELEASE_VERSION)
    expect(packageLock.version).toBe(RELEASE_VERSION)
    expect(lockPackages['']?.version).toBe(RELEASE_VERSION)
    expect(tauriConfig.version).toBe(RELEASE_VERSION)
    expect(cargoManifest).toMatch(/^version = "1\.0\.4"$/m)
    expect(cargoLock).toMatch(/\[\[package\]\]\nname = "workflow-studio"\nversion = "1\.0\.4"/)
  })

  it('changes the npm lockfile only for the synchronized version and pinned local Geist packages', () => {
    const expected = JSON.parse(preReleaseFile('package-lock.json')) as {
      version: string
      packages: Record<string, { version?: string; dependencies?: Record<string, string> }>
    }
    expected.version = RELEASE_VERSION
    expected.packages['']!.version = RELEASE_VERSION
    expected.packages['']!.dependencies = {
      ...expected.packages['']!.dependencies,
      '@fontsource-variable/geist': '5.3.0',
      '@fontsource-variable/geist-mono': '5.3.0',
    }
    expected.packages['node_modules/@fontsource-variable/geist'] = {
      version: '5.3.0',
      resolved: 'https://registry.npmjs.org/@fontsource-variable/geist/-/geist-5.3.0.tgz',
      integrity: 'sha512-j0m+vLQuG5XAYoHtGCVu0spvlGreR3EzpECUVzkFmI1mTVnAO38l/NEPDCFgZ177JxzYJCLSmTQibIiYPilGrA==',
      license: 'OFL-1.1',
      funding: { url: 'https://github.com/sponsors/ayuhito' },
    }
    expected.packages['node_modules/@fontsource-variable/geist-mono'] = {
      version: '5.3.0',
      resolved: 'https://registry.npmjs.org/@fontsource-variable/geist-mono/-/geist-mono-5.3.0.tgz',
      integrity: 'sha512-vBbuwDEo9AkrqADMXOrlAR3DFcJi4/JxeuU43FoiQERnNwsfXNnvxvReZG02cQKmyk4DZkZdBZX3oTDvy2zBAw==',
      license: 'OFL-1.1',
      funding: { url: 'https://github.com/sponsors/ayuhito' },
    }

    expect(json('package-lock.json')).toEqual(expected)
  })

  it('changes no Cargo lockfile package record except the workflow-studio release version', () => {
    const currentCargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8')
    const expectedCargoLock = baseCargoLock().replace(
      'name = "workflow-studio"\nversion = "1.0.0"',
      'name = "workflow-studio"\nversion = "1.0.4"',
    )

    expect(currentCargoLock).toBe(expectedCargoLock)
  })

  it('documents the v1.0.4 bootstrap contract and unsigned platform warnings', () => {
    const installing = readFileSync('docs/installing.md', 'utf8')

    expect(installing).toContain(
      "iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.4/scripts/install.ps1')",
    )
    expect(installing).toContain(
      'curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.4/scripts/install.sh | sh',
    )
    expect(installing).toContain(
      'does not have an Apple Developer ID signature, Apple notarization, or a Microsoft Authenticode signature',
    )
    expect(installing).toContain('Gatekeeper or SmartScreen warnings are expected')
    expect(installing).toContain('Linux is deferred and unsupported by the bootstrap')
    expect(installing).toContain('downloads and verifies the DMG, then opens it')
    expect(installing).toContain('drag Workflow Studio to Applications')
    expect(installing).not.toContain('install it automatically')
    expect(installing).not.toContain('v1.0.0')
    expect(installing).not.toContain('/v1.0.1/scripts/install')
    expect(installing).not.toContain('/v1.0.2/scripts/install')
  })

  it('records the recovery history and current release-verification totals', () => {
    for (const path of ['docs/releasing.md', 'docs/verification/version-1-release-acceptance.md']) {
      const document = readFileSync(path, 'utf8')
      expect(document).toMatch(/v1\.0\.1[^\n]*unpublished[^\n]*failed draft/i)
      expect(document).toMatch(/v1\.0\.2[^\n]*unpublished[^\n]*failed draft/i)
      expect(document).toMatch(/v1\.0\.3[^\n]*recovery release/i)
    }

    const acceptance = readFileSync('docs/verification/version-1-release-acceptance.md', 'utf8')
    expect(acceptance).toContain('1,142 TypeScript unit/component/integration tests')
    expect(acceptance).toContain('245 Rust unit tests')
    expect(acceptance).toContain('24 real Git integration tests')
    expect(acceptance).toContain('276 Playwright E2E tests')
  })

  it('keeps draft integrity gates before publication and clean-machine evidence after publication', () => {
    const releasing = readFileSync('docs/releasing.md', 'utf8')
    const security = readFileSync('docs/security.md', 'utf8')
    const acceptanceTemplate = readFileSync('docs/verification/release-acceptance-template.md', 'utf8')
    const publicationGate =
      'Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication.'
    const followUp =
      'Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.'

    for (const document of [releasing, security, acceptanceTemplate]) {
      expect(document).toContain(publicationGate)
      expect(document).toContain(followUp)
    }
  })
})
