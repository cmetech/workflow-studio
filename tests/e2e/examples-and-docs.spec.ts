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
  const article = docs.getByRole('article')
  await expect(article).toBeVisible()
  await expect(article.getByRole('navigation', { name: 'Documentation breadcrumb' })).toBeVisible()
  await expect(article.getByRole('button', { name: 'Back to Results' })).toBeVisible()
})

test('replaces the example catalog with the selected preview', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()

  await page.getByRole('button', { name: 'Preview Minimal prompt' }).click()

  await expect(page.getByRole('region', { name: 'Minimal prompt preview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to Examples' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Sequential chain' })).toHaveCount(0)
})

test('reveals a preview selected from a lower card at desktop and reflow widths', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()

  for (const size of [
    { width: 1024, height: 700 },
    { width: 560, height: 700 },
  ]) {
    await page.setViewportSize(size)
    const pageBody = page.locator('[data-workbench-page="examples"] [data-page-scroll]')
    const lowerPreview = page.getByRole('button', { name: /^Preview / }).last()
    const previewName = (await lowerPreview.textContent())!.replace(/^Preview /, '')
    await lowerPreview.scrollIntoViewIfNeeded()
    const scrollBefore = await pageBody.evaluate((element) => element.scrollTop)
    expect(scrollBefore).toBeGreaterThan(0)

    await lowerPreview.click()

    const back = page.getByRole('button', { name: 'Back to Examples' })
    await expect(back).toBeFocused()
    const [bodyBox, detailBox] = await Promise.all([
      pageBody.boundingBox(),
      page.getByRole('region', { name: `${previewName} preview` }).boundingBox(),
    ])
    expect(detailBox!.y - bodyBox!.y).toBeLessThan(100)
    expect(await pageBody.evaluate((element) => element.scrollTop)).toBe(0)

    await back.click()
    await expect(lowerPreview).toBeFocused()
    await expect.poll(() => pageBody.evaluate((element) => element.scrollTop)).toBe(scrollBefore)
  }
})
