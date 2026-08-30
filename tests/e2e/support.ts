import { expect, type Page } from '@playwright/test'

export interface ExactGeometry {
  readonly label: string
  readonly viewport: { readonly width: number; readonly height: number }
}

export const EXACT_GEOMETRIES: readonly ExactGeometry[] = [
  { label: '1024x700', viewport: { width: 1024, height: 700 } },
  { label: '1280x800', viewport: { width: 1280, height: 800 } },
  { label: '1440x900', viewport: { width: 1440, height: 900 } },
  { label: 'effective 200% (512x350 CSS viewport)', viewport: { width: 512, height: 350 } },
]

export async function expectExactWorkbenchGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement
    const status = document.querySelector<HTMLElement>('[aria-label="Application status"]')
    if (!status) throw new Error('Expected the application status bar.')
    return {
      innerWidth,
      innerHeight,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      statusBottom: status.getBoundingClientRect().bottom,
    }
  })
  expect(geometry.scrollHeight).toBe(geometry.clientHeight)
  expect(geometry.scrollWidth).toBe(geometry.clientWidth)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.innerHeight)
  expect(geometry.statusBottom).toBeGreaterThan(0)
  expect(geometry.clientWidth).toBe(geometry.innerWidth)
  expect(geometry.clientHeight).toBe(geometry.innerHeight)
}

export async function openSeededPair(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`)
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
}

export async function replaceDefinitionYaml(page: Page, text: string): Promise<void> {
  await page
    .getByRole('group', { name: 'Editor mode' })
    .locator(':scope > button')
    .filter({ hasText: /^YAML$/ })
    .click()
  const editor = page.locator('[aria-label="Definition YAML"] .cm-content')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(text)
}

export async function e2eSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    if (!window.__WORKFLOW_STUDIO_E2E__) throw new Error('E2E fixture controls were not installed.')
    return window.__WORKFLOW_STUDIO_E2E__.snapshot()
  })
}
