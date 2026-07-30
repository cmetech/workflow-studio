import { expect, test } from '@playwright/test'
import { e2eSnapshot } from './support'

test('renders deterministic setup failure logs, retries, then defers a failed update safely', async ({ page }) => {
  await page.goto('/?scenario=setup-update')
  const setup = page.getByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })
  await expect(setup.getByRole('alert')).toContainText('Bundled resource verification failed')
  await expect(setup.getByLabel('Setup output')).toHaveValue(/Resource digest mismatch/)
  await setup.getByRole('button', { name: 'Retry' }).click()

  const update = page.getByRole('dialog', { name: 'Update Workflow Studio' })
  await expect(update.getByRole('alert')).toContainText('signature verification failed')
  await expect(update.getByLabel('Update output')).toHaveValue(/rejected before installation/)
  await update.getByRole('button', { name: 'Retry' }).click()
  await expect(update.getByText(/Version 0\.2\.0/)).toBeVisible()
  await update.getByRole('button', { name: 'Later' }).click()

  const state = await e2eSnapshot(page)
  expect(state.setupRetries).toBe(1)
  expect(state.updateChecks).toBe(1)
  expect(state.updateDeferred).toBe(true)
})
