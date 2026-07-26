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

function permissionIdentifier(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    return entry
  }

  if (typeof entry === 'object' && entry !== null && 'identifier' in entry && typeof entry.identifier === 'string') {
    return entry.identifier
  }

  return undefined
}

describe('capability permission identifiers', () => {
  it.each([
    ['a string shell permission', 'shell:allow-open', 'shell:allow-open'],
    ['an object shell permission', { identifier: 'shell:allow-open' }, 'shell:allow-open'],
    ['an object broad filesystem permission', { identifier: 'fs:allow-all' }, 'fs:allow-all'],
  ])('normalizes %s', (_description, entry, expectedIdentifier) => {
    expect(permissionIdentifier(entry)).toBe(expectedIdentifier)
  })
})

describe('native foundation resource boundary', () => {
  it('limits bundled resources, native permissions, identity, and declared dependencies', () => {
    const tauriConfig = readJson<TauriConfig>('src-tauri/tauri.conf.json')
    const capabilities = readJson<CapabilityConfig>('src-tauri/capabilities/default.json')
    const packageManifest = readJson<PackageManifest>('package.json')
    const permissions = capabilities.permissions
    const permissionIdentifiers = Array.isArray(permissions)
      ? permissions.map(permissionIdentifier).filter((identifier): identifier is string => identifier !== undefined)
      : []
    const dependencies = Object.keys({ ...packageManifest.dependencies, ...packageManifest.devDependencies })

    expect(tauriConfig.bundle?.resources).toEqual(['../contracts/**/*', '../examples/**/*', '../brands/**/*'])
    expect(tauriConfig.identifier).toBe('com.cmetech.workflowstudio')
    expect(permissions).toEqual(expect.any(Array))
    expect(permissionIdentifiers).not.toContain('fs:default')
    expect(permissionIdentifiers).not.toContain('fs:allow-all')
    expect(permissionIdentifiers.some((identifier) => identifier.startsWith('shell:'))).toBe(false)
    expect(permissionIdentifiers).toContain('core:window:allow-destroy')
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
