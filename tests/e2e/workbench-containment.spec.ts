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
