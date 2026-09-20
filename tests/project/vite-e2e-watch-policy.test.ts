import { describe, expect, it } from 'vitest'
import { createServer, resolveConfig } from 'vite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Vite E2E watch policy', () => {
  it('watches source files but excludes generated native HTML from reload observation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-watch-'))
    const source = join(root, 'src')
    const generated = join(root, 'src-tauri', 'target', 'debug', 'build', 'fixture', 'out', 'tauri-codegen-assets')
    await mkdir(source, { recursive: true })
    await mkdir(generated, { recursive: true })
    await writeFile(join(source, 'visible.html'), '<p>source</p>')
    await writeFile(join(generated, 'generated.html'), '<p>native build output</p>')
    const config = await resolveConfig({ configFile: 'vite.config.ts', mode: 'e2e' }, 'serve')
    let ready: Promise<void> | undefined
    const server = await createServer({
      configFile: false,
      root,
      mode: 'e2e',
      server: { middlewareMode: true, watch: config.server.watch },
      optimizeDeps: { include: [], noDiscovery: true },
      plugins: [
        {
          name: 'observe-watcher-ready',
          configureServer(server) {
            ready = new Promise<void>((resolveReady) => server.watcher.once('ready', resolveReady))
          },
        },
      ],
    })
    try {
      await ready
      await expect.poll(() => server.watcher.getWatched()[source]?.includes('visible.html')).toBe(true)
      expect(server.watcher.getWatched()[generated] ?? []).not.toContain('generated.html')
    } finally {
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not watch Playwright artifacts that are written inside the repository', async () => {
    const config = await resolveConfig({ configFile: 'vite.config.ts', mode: 'e2e' }, 'serve')

    expect(config.server.watch.ignored).toEqual(
      expect.arrayContaining(['**/test-results*/**', '**/playwright-report/**']),
    )
  })
})
