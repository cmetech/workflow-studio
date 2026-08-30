import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const UNSAVED_YAML = `name: Release demo
description: Unsaved activity page edit.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
${Array.from({ length: 80 }, (_, index) => `# retained scroll line ${index}\n`).join('')}`

test('preserves exact authoring state across full-workbench page navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openSeededPair(page)
  await replaceDefinitionYaml(page, UNSAVED_YAML)
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)

  await page.getByRole('button', { name: 'Split', exact: true }).click()
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
  const inspectorSelection = page.locator('aside[aria-label="Inspector"] strong').first()
  await expect(inspectorSelection).toHaveText('prepare')
  await expect.poll(async () => (await e2eSnapshot(page)).layout).not.toBeNull()
  const layoutBefore = (await e2eSnapshot(page)).layout
  const yamlScroller = page.locator('[aria-label="Definition YAML"] .cm-scroller')
  await yamlScroller.evaluate((element) => {
    element.style.maxHeight = '12rem'
    element.style.overflowY = 'auto'
    element.scrollTop = 120
  })
  const yamlScrollBefore = await yamlScroller.evaluate((element) => element.scrollTop)
  expect(yamlScrollBefore).toBeGreaterThan(0)

  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  await settings.click()
  await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Workflow workspace', includeHidden: true }),
  ).toHaveAttribute('inert', '')
  await expect(inspectorSelection).toHaveText('prepare')
  await page.getByRole('button', { name: 'Back to Workflow' }).click()

  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)
  await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(settings).toBeFocused()
  await expect.poll(() => yamlScroller.evaluate((element) => element.scrollTop)).toBe(yamlScrollBefore)
  expect((await e2eSnapshot(page)).layout).toEqual(layoutBefore)
})
