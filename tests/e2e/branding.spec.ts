import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair } from './support'

test('keeps a malicious brand inspectable but inactive, then previews and activates a valid pack', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  await page.getByRole('button', { name: 'Import brand pack' }).click()
  await expect(page.getByRole('list', { name: 'Rejected brand pack reports' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Preview Rejected brand pack/i })).toHaveCount(0)

  await page.getByRole('button', { name: 'Import brand pack' }).click()
  await page.getByRole('button', { name: 'Preview Northstar Studio' }).click()
  const preview = page.getByRole('dialog', { name: 'Preview Northstar Studio' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Activate Northstar Studio' }).click()
  await expect.poll(async () => (await e2eSnapshot(page)).activeBrandId).toBe('northstar')
})
