import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair } from './support'

test('creates a pair-only local version and preserves an unrelated staged change', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await expect(page.getByText('Branch: base')).toBeVisible()
  await page.getByRole('button', { name: 'Create version…' }).click()
  await page.getByLabel('Version message').fill('Verify release workflow')
  await page.getByRole('button', { name: 'Create version', exact: true }).click()

  await expect.poll(async () => (await e2eSnapshot(page)).pairVersioned).toBe(true)
  const state = await e2eSnapshot(page)
  expect(state.unrelatedChangePresent).toBe(true)
})
