import { expect, type Page } from '@playwright/test'

export async function openPackages(page: Page, scenario = 'package-authoring') {
  await page.goto('/?scenario=' + scenario)
  await expect.poll(() => page.evaluate(() => Boolean(window.__WORKFLOW_STUDIO_PACKAGE_E2E__))).toBe(true)
  await page.getByRole('button', { name: 'Open Folder', exact: true }).first().click()
  await page.getByRole('button', { name: 'Packages', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New Package', exact: true })).toBeVisible()
}
export async function packageFiles(page: Page) {
  return page.evaluate(() => {
    if (!window.__WORKFLOW_STUDIO_PACKAGE_E2E__) throw new Error('Package fixture controls are not installed')
    return window.__WORKFLOW_STUDIO_PACKAGE_E2E__.files()
  })
}
export async function selectLaptop(page: Page) {
  await page.getByRole('treeitem', { name: /laptop-diagnostic package/ }).click()
}
export async function reviewLaptop(page: Page) {
  await selectLaptop(page)
  await page.getByRole('button', { name: 'Validate Package', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Prepare Package', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Prepare Package', exact: true }).click()
  await page.getByRole('button', { name: 'Review version and commit', exact: true }).click()
  await page.getByLabel('Version', { exact: true }).fill('1.0.1')
  await page.getByLabel('Commit message', { exact: true }).fill('Prepare diagnostic package')
}
