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
`

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

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Workflow workspace', includeHidden: true }),
  ).toHaveAttribute('inert', '')
  await expect(inspectorSelection).toHaveText('prepare')
  await page.getByRole('button', { name: 'Back to Workflow' }).click()

  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)
  await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await e2eSnapshot(page)).layout).toEqual(layoutBefore)
})
