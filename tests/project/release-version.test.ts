import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RELEASE_VERSION = '1.0.1'

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('version one release metadata', () => {
  it('keeps every package and native release version synchronized at 1.0.1', () => {
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
    expect(cargoManifest).toMatch(/^version = "1\.0\.1"$/m)
    expect(cargoLock).toMatch(/\[\[package\]\]\nname = "workflow-studio"\nversion = "1\.0\.1"/)
  })

  it('documents the v1.0.1 bootstrap contract and unsigned platform warnings', () => {
    const installing = readFileSync('docs/installing.md', 'utf8')

    expect(installing).toContain(
      "iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.ps1')",
    )
    expect(installing).toContain(
      'curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.sh | sh',
    )
    expect(installing).toContain(
      'does not have an Apple Developer ID signature, Apple notarization, or a Microsoft Authenticode signature',
    )
    expect(installing).toContain('Gatekeeper or SmartScreen warnings are expected')
    expect(installing).toContain('Linux is deferred and unsupported by the bootstrap')
    expect(installing).not.toContain('v1.0.0')
  })
})
