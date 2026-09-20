import { fileURLToPath, URL } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

function normalizeElkRuntimeModule(id: string): string | null {
  const normalized = id.replaceAll('\\', '/').split('?')[0]!
  const marker = '/node_modules/elkjs/'
  const index = normalized.toLowerCase().lastIndexOf(marker)
  if (index < 0) return null
  return `node_modules/elkjs/${normalized.slice(index + marker.length)}`
}

function elkModuleProvenance(): Plugin {
  return {
    name: 'workflow-studio-elk-module-provenance',
    apply: 'build',
    generateBundle(_options, bundle) {
      const discovered: Record<string, string[]> = {}
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        const modules = [
          ...new Set(Object.keys(output.modules).map(normalizeElkRuntimeModule).filter((id) => id !== null)),
        ].sort()
        if (modules.length > 0) discovered[output.fileName.replaceAll('\\', '/')] = modules
      }
      for (const [fileName, modules] of Object.entries(discovered).sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const metadataName = fileName.replaceAll(/[^a-z0-9.-]+/gi, '_')
        this.emitFile({
          type: 'asset',
          fileName: `.vite/elk-provenance/${metadataName}.json`,
          source: `${JSON.stringify({ version: 1, chunks: { [fileName]: modules } }, null, 2)}\n`,
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), elkModuleProvenance()],
  resolve: {
    conditions: ['browser'],
    alias: {
      $src: fileURLToPath(new URL('./src', import.meta.url)),
      '$runtime-bootstrap': fileURLToPath(
        new URL(mode === 'e2e' ? './src/e2e/bootstrap.ts' : './src/bootstrap/runtime.ts', import.meta.url)
      )
    }
  },
  build: { manifest: true },
  worker: { plugins: () => [elkModuleProvenance()] },
  optimizeDeps: {
    // Arrange Graph starts these nested workers lazily. Pre-bundle their runtime
    // imports so a cold dev server does not reload the editor on first use.
    include: ['elkjs/lib/elk-api.js', 'elkjs/lib/elk-worker.min.js'],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/test-results*/**', '**/playwright-report/**', '**/src-tauri/target/**'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**']
  }
}))
