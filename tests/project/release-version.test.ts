import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const RELEASE_VERSION = '3.0.1'
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

describe('version three release metadata', () => {
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

  it('keeps every package and native release version synchronized at 3.0.1', () => {
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
    expect(cargoManifest).toMatch(/^version = "3\.0\.1"$/m)
    expect(cargoLock).toMatch(/\[\[package\]\]\nname = "workflow-studio"\nversion = "3\.0\.1"/)
  })

  it('changes the npm lockfile only for the synchronized version, pinned Geist packages, and the Dagre-to-ELK replacement', () => {
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
      elkjs: '0.12.0',
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

    delete expected.packages['']!.dependencies!['@dagrejs/dagre']
    delete expected.packages['node_modules/@dagrejs/dagre']
    delete expected.packages['node_modules/@dagrejs/graphlib']

    expected.packages['node_modules/elkjs'] = {
      version: '0.12.0',
      resolved: 'https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz',
      integrity: 'sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==',
      license: 'EPL-2.0 OR GPL-3.0-or-later',
    }

    expect(json('package-lock.json')).toEqual(expected)
  })

  it('changes no Cargo lockfile package record except the workflow-studio release version', () => {
    const currentCargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8')
    const expectedCargoLock = baseCargoLock().replace(
      'name = "workflow-studio"\nversion = "1.0.0"',
      'name = "workflow-studio"\nversion = "3.0.1"',
    )

    expect(currentCargoLock).toBe(expectedCargoLock)
  })

  it('retains the immutable bootstrap while documenting v3.0.1 as the published release', () => {
    const installing = readFileSync('docs/installing.md', 'utf8')

    expect(installing).toContain(
      "iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.5/scripts/install.ps1')",
    )
    expect(installing).toContain(
      'curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.5/scripts/install.sh | sh',
    )
    expect(installing).toContain(
      'does not have an Apple Developer ID signature, Apple notarization, or a Microsoft Authenticode signature',
    )
    expect(installing).toContain('install the latest published release')
    expect(installing).toContain('immutable v1.0.5 bootstrap URLs')
    expect(installing).toContain('v3.0.1 is the latest published release')
    expect(installing).toContain('v1.0.7 documentation-and-shortcuts draft')
    expect(installing).toContain('v1.0.8 loop-group visual-authoring candidate was superseded without a tag or release')
    expect(installing).toContain('v2.0.0 verified unpublished draft')
    expect(installing).toMatch(/v2\.0\.1[^\n]*superseded[^\n]*without a tag or release/i)
    expect(installing).toContain('install published v3.0.1')
    expect(installing).not.toContain('bootstrap v1.0.5 directly')
    expect(installing).toContain('Gatekeeper or SmartScreen warnings are expected')
    expect(installing).toContain('Linux is deferred and unsupported by the bootstrap')
    expect(installing).toContain('downloads and verifies the DMG, then opens it')
    expect(installing).toContain('drag Workflow Studio to Applications')
    expect(installing).not.toContain('install it automatically')
    expect(installing).not.toContain('v1.0.0')
    expect(installing).not.toContain('/v1.0.1/scripts/install')
    expect(installing).not.toContain('/v1.0.2/scripts/install')
    expect(installing).not.toContain('/v1.0.4/scripts/install')
  })

  it('preserves release history and records the published v3.0.0 boundary separately', () => {
    for (const path of ['docs/releasing.md', 'docs/verification/version-1-release-acceptance.md']) {
      const document = readFileSync(path, 'utf8')
      expect(document).toMatch(/v1\.0\.1[^\n]*unpublished[^\n]*failed draft/i)
      expect(document).toMatch(/v1\.0\.2[^\n]*unpublished[^\n]*failed draft/i)
      expect(document).toMatch(/v1\.0\.3[^\n]*recovery release/i)
      expect(document).toMatch(/v1\.0\.4[^\n]*unpublished[^\n]*failed[^\n]*empty draft/i)
      expect(document).toMatch(/v1\.0\.5[^\n]*unpublished[^\n]*no release[^\n]*33355845811/i)
      expect(document).toMatch(/v1\.0\.6[^\n]*latest published[^\n]*content-aware/i)
      expect(document).toMatch(/v1\.0\.7[^\n]*documentation-and-shortcuts[^\n]*(?:draft|candidate)/i)
      expect(document).toMatch(/v1\.0\.8[^\n]*loop-group[^\n]*candidate/i)
    }

    const versionOne = readFileSync('docs/verification/version-1-release-acceptance.md', 'utf8')
    expect(versionOne).toContain('0ecb5bd46a49cebe4037825856411d8ead5db17f')
    expect(versionOne).toContain('Recorded: 2026-09-06')
    expect(versionOne).toContain('published on 2026-08-31')
    expect(versionOne).toContain(
      "npx vitest run --exclude tests/installers/install-script.test.ts --exclude '.worktrees/**'",
    )
    expect(versionOne).toContain('1,819 tests across 159 files')
    expect(versionOne).toContain('246 Rust unit tests')
    expect(versionOne).toContain('24 Rust integration tests')
    expect(versionOne).toContain('320/320')
    expect(versionOne).toMatch(/Chromium[^\n]*WebKit/i)
    expect(versionOne).toContain('seven scoped-performance checks')
    expect(versionOne).toMatch(/format[^\n]*lint[^\n]*check[^\n]*contracts[^\n]*examples[^\n]*resources[^\n]*build/i)
    expect(versionOne).toMatch(/clean review/i)
    expect(versionOne).toContain('c42c1da424b51d99cba5eced1553360c81a2d0ee')
    expect(versionOne).toMatch(/v1\.0\.8[^\n]*superseded[^\n]*without a tag or release/i)

    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('[version 2 release acceptance record](docs/verification/version-2-release-acceptance.md)')
    expect(readme).toContain('[version 3 release acceptance record](docs/verification/version-3-release-acceptance.md)')
    const acceptance = readFileSync('docs/verification/version-2-release-acceptance.md', 'utf8')
    expect(acceptance).toContain('Version/tag: `2.0.1` / `v2.0.1`')
    expect(acceptance).toContain('7a385e41bb58cf693b83f9b6cbfae4b0539cbe32')
    expect(acceptance).toMatch(/v2\.0\.1[^\n]*tag[^\n]*does not exist/i)
    expect(acceptance).toMatch(/v2\.0\.1[^\n]*(?:draft|release)[^\n]*does not exist/i)
    expect(acceptance).toContain(
      '- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v2.0.1 draft bytes.',
    )
    expect(acceptance).toContain('- [x] No unresolved Critical/Important review finding remains.')
    expect(acceptance).toContain('- [ ] Release approved for manual publication.')
    expect(acceptance).toMatch(/Windows[^\n]*installed-app[^\n]*(?:not performed|open)/i)
    expect(acceptance).toContain('aa91baac4081f0ca585b10fb3fb65b966a7ec24c')
    expect(acceptance).toContain('34042847222')
    expect(acceptance).toMatch(/v2\.0\.0[^\n]*annotated tag/i)
    expect(acceptance).toMatch(/v2\.0\.0[^\n]*verified unpublished[^\n]*ten-asset draft/i)
    expect(acceptance).toContain('1,837 tests across 160 files')
    expect(acceptance).toContain('328/328')
    expect(acceptance).toContain('8f07bdb4bdf30b56a582ef46de00a3485f818c3fe29b11dc40bdd983078337d6')
    expect(acceptance).toContain('62258a58aec8b96874fd1f761d1ae5bb1684d91a0080aba4e74e5c39f5645141')
    expect(acceptance).toContain('docs/mockups/ui-collapsed-panels-problems.png')
    expect(acceptance).toContain('docs/mockups/ui-expanded-panels-problems.png')
    expect(acceptance).toContain('docs/mockups/ui-theme-customization.png')
    expect(acceptance).toMatch(/unresolved status blocks release tagging/i)
    expect(acceptance).toMatch(/workflow-studio-modern-workbench[^\n]*clean/i)
    expect(acceptance).toMatch(/ui-customization-recovery[^\n]*clean/i)
    expect(acceptance).toMatch(/ui-customization-panels[^\n]*superseded/i)

    const releasing = readFileSync('docs/releasing.md', 'utf8')
    expect(releasing).toMatch(/v2\.0\.0[^\n]*annotated tag[^\n]*aa91baa/i)
    expect(releasing).toMatch(/v2\.0\.0[^\n]*verified unpublished[^\n]*ten-asset draft/i)
    expect(releasing).toContain('34042847222')
    expect(releasing).toMatch(/v2\.0\.1[^\n]*superseded[^\n]*without a tag or release/i)

    const versionThree = readFileSync('docs/verification/version-3-release-acceptance.md', 'utf8')
    expect(versionThree).toContain('Version/tag: `3.0.0` / `v3.0.0`')
    expect(versionThree).toContain('5cad28d843b83456b013d076786aa52ff2259135')
    expect(versionThree).toContain('1cd6a8d323bb408bef394e5b20be5aed75bd6d12')
    expect(versionThree).toContain('34242821519')
    expect(versionThree).toContain('34245992410')
    expect(versionThree).toContain('384861987')
    expect(versionThree).toMatch(/v3\.0\.0[^\n]*annotated tag[^\n]*1cd6a8d/i)
    expect(versionThree).toMatch(/v3\.0\.0[^\n]*latest published release/i)
    expect(versionThree).toContain(
      '- [x] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v3.0.0 draft bytes.',
    )
    expect(versionThree).toContain('- [x] Verified draft is published as the latest GitHub release.')
    expect(versionThree).toContain('- [x] Public `latest.json`, checksum, and installer links resolve.')
    expect(versionThree).toContain('398 passed and 4 skipped')
    expect(versionThree).toContain('5a7d6e4da38736bfccc694020661e5773080040c5dc8656c25ecb571004b0f10')
    expect(versionThree).toContain('604792a1e83a7f88b3dbcaf1db8c6619021438fb951a3845bdfed64ffca05379')
    expect(versionThree).toContain('- [x] No unresolved Critical/Important review finding remains.')
    expect(versionThree).toContain('- [x] Release approved for publication after protected workflow verification.')
    expect(versionThree).toContain('docs/mockups/ui-collapsed-panels-problems.png')
    expect(versionThree).toContain('docs/mockups/ui-expanded-panels-problems.png')
    expect(versionThree).toContain('docs/mockups/ui-theme-customization.png')
    expect(versionThree).toContain('tests/scripts/test_whole_branch_fix_process_probe.py')
    expect(versionThree).toMatch(/release-v3\.0\.0[^\n]*post-release evidence/i)

    const currentPlan = readFileSync('docs/superpowers/plans/2026-09-08-workflow-studio-v3.0.0-release.md', 'utf8')
    expect(currentPlan).toContain('Workflow Studio v3.0.0 Full Release Plan')
    expect(currentPlan).toMatch(/approved[^\n]*2026-09-08/i)
    expect(currentPlan).toMatch(/completed[^\n]*2026-09-08/i)
    expect(currentPlan).toMatch(/publish[^\n]*after[^\n]*protected[^\n]*verification/i)

    const hotfixPlan = readFileSync('docs/superpowers/plans/2026-09-09-workflow-studio-v3.0.1-release.md', 'utf8')
    expect(hotfixPlan).toContain('Workflow Studio v3.0.1 Windows Persistence Hotfix Release Plan')
    expect(hotfixPlan).toMatch(/approved[^\n]*2026-09-09/i)
    expect(hotfixPlan).toMatch(/publish[^\n]*after[^\n]*protected[^\n]*release workflow/i)

    const hotfixAcceptance = readFileSync('docs/verification/version-3.0.1-release-acceptance.md', 'utf8')
    expect(hotfixAcceptance).toContain('Version/tag: `3.0.1` / `v3.0.1`')
    expect(hotfixAcceptance).toContain('79e04d61b7b235eaf7135f0bd9b1707117d5730c')
    expect(hotfixAcceptance).toMatch(/Windows[^\n]*error 87/i)
    expect(hotfixAcceptance).toContain('7608947b4d17e49cd064fc978d330c76aab8c281')
    expect(hotfixAcceptance).toContain('34406142397')
    expect(hotfixAcceptance).toContain('34408692126')
    expect(hotfixAcceptance).toContain('385868225')
    expect(hotfixAcceptance).toContain('500306ff03c375fbfed9a7b80d4a386d78b6c9449d96b79297379a0d0b16b3ef')
    expect(hotfixAcceptance).toContain('- [x] Verified draft is published as the latest GitHub release.')
    expect(hotfixAcceptance).toContain('- [x] Public `latest.json`, checksum, and installer links resolve.')

    expect(hotfixPlan).toMatch(/completed[^\n]*2026-09-09/i)

    expect(readFileSync('docs/superpowers/plans/2026-09-07-workflow-studio-v2.0.1-release.md', 'utf8')).toContain(
      'Workflow Studio v2.0.1 Local Release Preparation Plan',
    )
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

  it('requires a local worktree preflight before creating a release tag', () => {
    const releasing = readFileSync('docs/releasing.md', 'utf8')
    const preflightIndex = releasing.indexOf('## Local worktree preflight')
    const tagInstructionIndex = releasing.indexOf(
      '4. Create an annotated `v3.0.1` tag on a commit contained in `origin/base`, then push that exact tag.',
    )

    expect(preflightIndex).toBeGreaterThanOrEqual(0)
    expect(tagInstructionIndex).toBeGreaterThan(preflightIndex)
    expect(releasing).toContain('git worktree list --porcelain')
    expect(releasing).toContain('git -C "$WORKTREE_PATH" status --short --branch')
    expect(releasing).toContain('Run the status command for every worktree listed by `git worktree list --porcelain`.')
    expect(releasing).toContain('Unrelated dirty work may remain untouched.')
    expect(releasing).toMatch(/Stop before tagging when a dirty worktree contains intended release work\./)
    expect(releasing).toContain('Record the disposition of every listed worktree in the version acceptance document.')
  })
})
