import { defineConfig, devices } from '@playwright/test'

const DEFAULT_E2E_PORT = 1420
const configuredPort = process.env.WORKFLOW_STUDIO_E2E_PORT
const e2ePort = configuredPort === undefined ? DEFAULT_E2E_PORT : Number(configuredPort)
if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
  throw new Error('WORKFLOW_STUDIO_E2E_PORT must be an integer from 1024 through 65535.')
}
const e2eUrl = `http://127.0.0.1:${e2ePort}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: process.env.CI ? 30_000 : 15_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: e2eUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --mode e2e --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: e2eUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
