import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RELEASE_VERSION = '1.0.0'

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('version one release metadata', () => {
  it('keeps every package and native release version synchronized at 1.0.0', () => {
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
    expect(cargoManifest).toMatch(/^version = "1\.0\.0"$/m)
    expect(cargoLock).toMatch(/\[\[package\]\]\nname = "workflow-studio"\nversion = "1\.0\.0"/)
  })
})
