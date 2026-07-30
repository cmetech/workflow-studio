import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('runtime-branding CSP', () => {
  it('allows only the exact local renderer and asset protocols required by the app', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')) as {
      app: { security: { csp: string } }
    }
    const csp = config.app.security.csp

    expect(csp).toContain("default-src 'self'")
    expect(csp).not.toMatch(/unsafe-eval|https?:\/\/(?!asset\.localhost|ipc\.localhost)|\*/i)
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("img-src 'self' blob: asset: http://asset.localhost")
    expect(csp).toContain("connect-src 'self' ipc: http://ipc.localhost")
    expect(csp).toContain("object-src 'none'")
  })
})
