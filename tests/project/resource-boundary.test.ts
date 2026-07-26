import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface TauriConfig {
  identifier?: unknown
  bundle?: {
    resources?: unknown
  }
}

interface CapabilityConfig {
  permissions?: unknown
}

interface PackageManifest {
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

describe('native foundation resource boundary', () => {
  it('limits bundled resources, native permissions, identity, and declared dependencies', () => {
    const tauriConfig = readJson<TauriConfig>('src-tauri/tauri.conf.json')
    const capabilities = readJson<CapabilityConfig>('src-tauri/capabilities/default.json')
    const packageManifest = readJson<PackageManifest>('package.json')
    const permissions = capabilities.permissions
    const dependencies = Object.keys({ ...packageManifest.dependencies, ...packageManifest.devDependencies })

    expect(tauriConfig.bundle?.resources).toEqual(['../contracts/**/*', '../examples/**/*', '../brands/**/*'])
    expect(tauriConfig.identifier).toBe('com.cmetech.workflowstudio')
    expect(permissions).toEqual(expect.any(Array))
    expect(permissions).not.toContain('fs:default')
    expect(permissions).not.toContain('fs:allow-all')
    expect(
      (permissions as unknown[]).some(
        (permission) => typeof permission === 'string' && permission.startsWith('shell:'),
      ),
    ).toBe(false)
    expect(dependencies).not.toEqual(
      expect.arrayContaining([
        'electron',
        'electron-builder',
        '@electron-forge/cli',
        'express',
        'fastify',
        'koa',
        '@hapi/hapi',
        '@nestjs/core',
        'python-shell',
        'pyodide',
      ]),
    )
  })
})
