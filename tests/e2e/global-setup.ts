import { chromium, type BrowserContext, type FullConfig, type Page } from '@playwright/test'

const WARMUP_ATTEMPTS = 2
const WARMUP_ATTEMPT_TIMEOUT_MS = 60_000
const DEFERRED_SURFACE_MODULES = [
  '/src/features/settings/SettingsPage.svelte',
  '/src/features/settings/ContractSettingsHost.svelte',
  '/src/features/settings/UpdateSettings.svelte',
  '/src/features/settings/AboutView.svelte',
  '/src/features/branding/AppearanceSettings.svelte',
  '/src/features/branding/BrandSettings.svelte',
  '/src/features/branding/BrandPreview.svelte',
  '/src/features/documentation/DocumentationView.svelte',
  '/src/features/examples/ExampleGallery.svelte',
  '/src/features/version-control/GitView.svelte',
  '/src/features/canvas/GraphCanvas.svelte',
  '/src/features/editor/EditorModes.svelte',
  '/src/features/inspector/Inspector.svelte',
  '/src/features/workspace/Explorer.svelte',
  '/src/features/canvas/NodePalette.svelte',
  '/src/features/workspace/QuickOpen.svelte',
  '/src/features/workspace/NewWorkflowDialog.svelte',
  '/src/features/workspace/ImportExportDialog.svelte',
  '/src/features/commands/CommandPalette.svelte',
  '/src/features/commands/KeyboardShortcuts.svelte',
  '/src/features/documents/ProblemsPanel.svelte',
  '/src/features/documents/AuxiliaryPanel.svelte',
  '/src/features/documents/ExternalChangeDialog.svelte',
  '/src/features/canvas/AddNodePicker.svelte',
  '/src/features/canvas/DeleteImpactDialog.svelte',
  '/src/features/canvas/LoopGroupScopeBar.svelte',
  '/src/features/canvas/GraphScopeHeader.svelte',
  '/src/features/updates/UpdateOverlay.svelte',
] as const

async function warmEntryPage(context: BrowserContext, baseURL: string): Promise<Page> {
  const failures: string[] = []
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1) {
    const diagnostics: string[] = []
    const page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        diagnostics.push(`console ${message.type()}: ${message.text()}`)
      }
    })
    page.on('pageerror', (error) => diagnostics.push(`page error: ${error.message}`))
    page.on('requestfailed', (request) => {
      diagnostics.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown error'})`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400) diagnostics.push(`response ${response.status()}: ${response.url()}`)
    })

    try {
      await page.goto(baseURL, { waitUntil: 'load', timeout: WARMUP_ATTEMPT_TIMEOUT_MS })
      await page.locator('[data-viewport-shell]').waitFor({ state: 'attached', timeout: WARMUP_ATTEMPT_TIMEOUT_MS })
      return page
    } catch (error) {
      const body = await page
        .locator('body')
        .innerText({ timeout: 1_000 })
        .catch(() => '<body unavailable>')
      const reason = error instanceof Error ? error.message : String(error)
      failures.push(
        `Warm-up attempt ${attempt} failed: ${reason}\nURL: ${page.url()}\nBody: ${body.slice(0, 1_000)}\n${diagnostics.join('\n')}`,
      )
      await page.close()
    }
  }

  throw new Error(`Playwright E2E warm-up failed after ${WARMUP_ATTEMPTS} attempts.\n${failures.join('\n\n')}`)
}

export default async function warmE2eEntryGraph(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Playwright E2E warm-up requires a string baseURL.')

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    try {
      const page = await warmEntryPage(context, baseURL)
      await page.evaluate(
        async (modulePaths) => Promise.all(modulePaths.map((modulePath) => import(modulePath))).then(() => undefined),
        DEFERRED_SURFACE_MODULES,
      )
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
