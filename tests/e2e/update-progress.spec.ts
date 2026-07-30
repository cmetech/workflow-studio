import { expect, test } from '@playwright/test'
import { e2eSnapshot } from './support'

test('retries setup and update checks, then downloads, verifies, installs, and relaunches', async ({ page }) => {
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
  await update.getByRole('button', { name: 'Download / Install' }).click()
  await expect(update.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  await expect(update.getByRole('status')).toContainText('Verifying the signed update')
  await expect(update.getByRole('status')).toContainText('Installing update')
  await expect(update.getByRole('status')).toContainText('Update installed. Relaunch to finish')
  await update.getByRole('button', { name: 'Relaunch' }).click()

  const state = await e2eSnapshot(page)
  expect(state.setupRetries).toBe(1)
  expect(state.updateChecks).toBe(1)
  expect(state.updateInstallRequests).toBe(1)
  expect(state.updateInstalled).toBe(true)
  expect(state.updateRelaunched).toBe(true)
})

test('cancels a live download into recheck-required without installing', async ({ page }) => {
  await page.goto('/?scenario=setup-update-cancel')
  const update = page.getByRole('dialog', { name: 'Update Workflow Studio' })
  await update.getByRole('button', { name: 'Download / Install' }).click()
  await expect(update.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  await update.getByRole('button', { name: 'Cancel update' }).click()
  await expect(update.getByRole('status')).toContainText('Check again before installing')
  await expect(update.getByRole('button', { name: 'Check Again' })).toBeVisible()

  const state = await e2eSnapshot(page)
  expect(state.updateCancelled).toBe(true)
  expect(state.updateInstallRequests).toBe(1)
  expect(state.updateInstalled).toBe(false)
})
