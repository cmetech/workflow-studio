import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const VALID_RECOVERY = `name: Recovered release
description: The valid projection returns after syntax recovery.
nodes:
  - id: recovered
    prompt: Continue safely.
`

test('keeps the last graph read-only, blocks save, and recovers from invalid YAML', async ({ page }) => {
  await openSeededPair(page)
  await replaceDefinitionYaml(page, 'name: [broken')
  await page.getByRole('button', { name: 'Split', exact: true }).click()

  await expect(page.getByText(/Last valid graph shown read-only/i)).toBeVisible()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect(page.getByRole('alert').filter({ hasText: /Save blocked/i })).toBeVisible()

  await replaceDefinitionYaml(page, VALID_RECOVERY)
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(page.getByText(/Last valid graph shown read-only/i)).toBeHidden()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(VALID_RECOVERY)
})
