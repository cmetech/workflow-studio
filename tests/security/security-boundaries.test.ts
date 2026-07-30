import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeBrandAsset } from '../../src/lib/branding/sanitize-assets'
import { renderMarkdown } from '../../src/lib/docs/render-markdown'

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function allFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? allFiles(path) : [path]
  })
}

describe('release security boundaries', () => {
  it('keeps the renderer CSP local and native capabilities narrow', () => {
    const config = json('src-tauri/tauri.conf.json')
    const csp = ((config.app as Record<string, unknown>).security as Record<string, unknown>).csp
    const capabilities = json('src-tauri/capabilities/default.json')
    const permissions = capabilities.permissions as unknown[]
    const identifiers = permissions.map((entry) =>
      typeof entry === 'string' ? entry : (entry as { identifier?: string }).identifier,
    )

    expect(csp).toEqual(expect.any(String))
    expect(csp).not.toMatch(/unsafe-eval|https?:\/\/(?!asset\.localhost|ipc\.localhost)|\*/i)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(identifiers.some((id) => id?.startsWith('shell:'))).toBe(false)
    expect(identifiers).not.toEqual(expect.arrayContaining(['fs:default', 'fs:allow-all', 'core:default:*']))
  })

  it('registers only typed product commands and keeps arbitrary process execution unavailable', () => {
    const nativeRoot = readFileSync('src-tauri/src/lib.rs', 'utf8')
    const handlerBlock = nativeRoot.match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? ''
    const handlers = [...handlerBlock.matchAll(/^\s*([\w:]+),?$/gm)].map((match) => match[1]!)
    const dangerous = handlers.filter((handler) => /(?:run|exec|spawn|shell|command)/i.test(handler))

    expect(handlers.length).toBeGreaterThan(50)
    expect(dangerous).toEqual([
      'commands::health::host_health',
      'contracts::contract_run_hermes_cli',
      'contracts::contract_choose_hermes_executable',
    ])
    expect(handlers).not.toEqual(
      expect.arrayContaining(['run_command', 'exec_command', 'spawn_process', 'shell_execute']),
    )
    const contractRunner = readFileSync('src-tauri/src/contracts.rs', 'utf8')
    expect(contractRunner).toContain('.remove(path)')
    expect(contractRunner).toContain('verify_granted(')
    expect(contractRunner).toContain('.args([\n            "workflow",\n            "schema",')
    expect(contractRunner).not.toMatch(/\.args\(request|\.args\(args|shell\s*=|sh -c|cmd \/c/i)
  })

  it('keeps Git local-only and release updates bound to a non-test public key', () => {
    const gitRunner = readFileSync('src-tauri/src/git/runner.rs', 'utf8')
    const gitMutations = readFileSync('src-tauri/src/git/mutate.rs', 'utf8')
    const keySource = readFileSync('src-tauri/src/updater_key.rs', 'utf8')
    const testKey = keySource.match(/TEST_UPDATER_PUBLIC_KEY: &str = "([^"]+)"/)?.[1]
    const config = json('src-tauri/tauri.conf.json')
    const publicKey = ((config.plugins as Record<string, unknown>).updater as Record<string, unknown>).pubkey as string

    expect(`${gitRunner}\n${gitMutations}`).not.toMatch(/"(?:push|pull|fetch|remote|merge|rebase|reset|cherry-pick)"/)
    expect(publicKey.length).toBeGreaterThan(100)
    expect(publicKey).not.toBe(testKey)
    expect(readFileSync('src-tauri/build.rs', 'utf8')).toContain('validate_public_key(key, false)')
  })

  it('declares no telemetry and keeps private records bounded under application data', () => {
    const manifest = json('package.json')
    const dependencies = Object.keys({
      ...((manifest.dependencies as Record<string, unknown>) ?? {}),
      ...((manifest.devDependencies as Record<string, unknown>) ?? {}),
    })
    expect(dependencies).not.toEqual(
      expect.arrayContaining(['@sentry/browser', '@sentry/svelte', 'posthog-js', 'mixpanel-browser', 'amplitude-js']),
    )
    const productionSources = allFiles('src')
      .filter((path) => /\.(?:ts|svelte)$/.test(path) && !/\.(?:test|spec)\.ts$/.test(path) && !path.includes('/e2e/'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(productionSources).not.toMatch(/navigator\.sendBeacon|posthog|mixpanel|amplitude|google-analytics/i)

    const recovery = readFileSync('src-tauri/src/recovery.rs', 'utf8')
    const layout = readFileSync('src-tauri/src/layout.rs', 'utf8')
    const recents = readFileSync('src-tauri/src/startup.rs', 'utf8')
    expect(recovery).toContain('const MAX_CONTENT_BYTES: usize = 8 * 1024 * 1024;')
    expect(recovery).toContain('app.path().app_data_dir()')
    expect(layout).toContain('const MAX_LAYOUT_BYTES: u64 = 8 * 1024 * 1024;')
    expect(layout).toContain('app.path().app_data_dir()')
    expect(recents).toContain('const MAX_RECENT_BYTES: u64 = 64 * 1024;')
    expect(recents).toContain('app.path().app_data_dir()')
  })

  it('neutralizes the malicious theme and Markdown corpora', () => {
    const maliciousSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://bad.test/x"/><path onload="alert(2)" style="fill:url(https://bad.test/y)"/></svg>',
    )
    expect(() => sanitizeBrandAsset('logo.svg', maliciousSvg)).toThrow()

    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src="https://bad.test/x">\n\n[unsafe](javascript:alert(1)) [external](https://docs.example.test)',
    )
    expect(html).not.toMatch(/<script|<img|javascript:/i)
    expect(html).toContain('data-external-url="https://docs.example.test/"')
  })

  it('does not ship E2E fixture controls in a production renderer build', () => {
    const output = mkdtempSync(join(tmpdir(), 'workflow-studio-production-'))
    try {
      execFileSync(
        process.execPath,
        ['node_modules/vite/bin/vite.js', 'build', '--mode', 'production', '--outDir', output],
        {
          stdio: 'pipe',
        },
      )
      const javascript = allFiles(output)
        .filter((path) => path.endsWith('.js'))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n')
      expect(javascript).not.toContain('__WORKFLOW_STUDIO_E2E__')
      expect(javascript).not.toContain('Resource digest mismatch in deterministic fixture.')
      expect(javascript).not.toContain('/e2e/workspace')
    } finally {
      rmSync(output, { recursive: true, force: true })
    }
  })
})
