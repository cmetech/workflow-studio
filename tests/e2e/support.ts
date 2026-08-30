import { expect, type Page } from '@playwright/test'

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
