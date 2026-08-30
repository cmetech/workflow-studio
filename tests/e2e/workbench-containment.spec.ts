import { expect, test } from '@playwright/test'

test('keeps the desktop shell and status bar inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const geometry = await page.evaluate(() => ({
    viewport: innerHeight,
    rootHeight: document.documentElement.getBoundingClientRect().height,
    rootScrollHeight: document.documentElement.scrollHeight,
    statusBottom: document.querySelector('[aria-label="Application status"]')!.getBoundingClientRect().bottom,
  }))

  expect(geometry.rootHeight).toBe(geometry.viewport)
  expect(geometry.rootScrollHeight).toBe(geometry.viewport)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.viewport)
})

test('Settings has no horizontal overflow at desktop and 512px reflow widths', async ({ page }) => {
  const sizes = [
    { width: 1024, height: 700 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 560, height: 700 },
  ]

  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Workflow Contracts' }).click()
  await expect(page.getByRole('heading', { name: 'Workflow contracts' })).toBeVisible()

  for (const size of sizes) {
    await page.setViewportSize(size)
    const geometry = await page.evaluate(() => {
      const pageRoot = document.querySelector<HTMLElement>('[data-workbench-page="settings"]')!
      return {
        pageOverflow: pageRoot.scrollWidth - pageRoot.clientWidth,
        rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rootScrollHeight: document.documentElement.scrollHeight,
        rootClientHeight: document.documentElement.clientHeight,
      }
    })
    expect(geometry.pageOverflow).toBe(0)
    expect(geometry.rootOverflow).toBe(0)
    expect(geometry.rootScrollHeight).toBe(geometry.rootClientHeight)
  }
})

test('Examples and Documentation contain long page content without horizontal overflow', async ({ page }) => {
  await page.goto('/')

  for (const activity of ['Examples', 'Documentation'] as const) {
    await page.getByRole('button', { name: activity, exact: true }).click()
    for (const size of [
      { width: 1024, height: 700 },
      { width: 560, height: 700 },
    ]) {
      await page.setViewportSize(size)
      const geometry = await page.evaluate((pageActivity) => {
        const pageRoot = document.querySelector<HTMLElement>(`[data-workbench-page="${pageActivity.toLowerCase()}"]`)!
        return {
          pageOverflow: pageRoot.scrollWidth - pageRoot.clientWidth,
          rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }, activity)
      expect(geometry.pageOverflow).toBe(0)
      expect(geometry.rootOverflow).toBe(0)
    }
  }
})
