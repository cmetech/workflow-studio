import { fileURLToPath, URL } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
    alias: {
      $src: fileURLToPath(new URL('./src', import.meta.url)),
      '$runtime-bootstrap': fileURLToPath(
        new URL(mode === 'e2e' ? './src/e2e/bootstrap.ts' : './src/bootstrap/runtime.ts', import.meta.url)
      )
    }
  },
  server: {
    port: 1420,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**']
  }
}))
