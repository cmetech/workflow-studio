import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair } from './support'

test('creates an editable copy from every bundled example and opens contextual offline documentation', async ({
  page,
}) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()

  const copyButtons = page.getByRole('button', { name: /^Create Editable Copy:/ })
  const total = await copyButtons.count()
  expect(total).toBeGreaterThanOrEqual(10)
  for (let index = total - 1; index >= 0; index -= 1) await copyButtons.nth(index).click()

  await expect
    .poll(
      async () =>
        ((await e2eSnapshot(page)).workspacePaths as string[]).filter(
          (path) => path.endsWith('.yaml') && !path.endsWith('.hermes.yaml'),
        ).length,
    )
    .toBe(11)
  await page
    .getByRole('button', { name: /^Open documentation:/ })
    .first()
    .click()
  const docs = page.getByRole('region', { name: 'Offline documentation' })
  await expect(docs).toBeVisible()
  await expect(docs.getByRole('article')).toBeVisible()
})

test('replaces the example catalog with the selected preview', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()

  await page.getByRole('button', { name: 'Preview Minimal prompt' }).click()

  await expect(page.getByRole('region', { name: 'Minimal prompt preview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to Examples' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Sequential chain' })).toHaveCount(0)
})
