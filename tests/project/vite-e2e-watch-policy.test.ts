import { describe, expect, it } from 'vitest'
import { resolveConfig } from 'vite'

describe('Vite E2E watch policy', () => {
  it('does not watch Playwright artifacts that are written inside the repository', async () => {
    const config = await resolveConfig({ configFile: 'vite.config.ts', mode: 'e2e' }, 'serve')

    expect(config.server.watch.ignored).toEqual(
      expect.arrayContaining(['**/test-results*/**', '**/playwright-report/**']),
    )
  })
})
