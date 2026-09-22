import { expect, test } from '@playwright/test'
import { openPackages, packageFiles, selectLaptop } from './package-support'

test('restores a malformed script recovery draft without changing the saved file', async ({ page }) => {
  await openPackages(page, 'package-recovery')
  const path = 'packages/laptop-diagnostic/scripts/analyze-snapshot.py'
  const before = (await packageFiles(page))[path]
  await page.getByRole('treeitem', { name: 'scripts/analyze-snapshot.py', exact: true }).click()
  await page.getByRole('button', { name: 'Restore artifact draft', exact: true }).click()
  await expect(page.getByRole('textbox', { name: path, exact: true })).toContainText('def recovered(:')
  expect((await packageFiles(page))[path]).toBe(before)
  await selectLaptop(page)
  await page.getByRole('button', { name: 'Validate Package', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Prepare Package', exact: true })).toBeDisabled()
})

test('saves malformed script text but blocks package preparation', async ({ page }) => {
  await openPackages(page)
  await page.getByRole('treeitem', { name: /scripts\/analyze-snapshot.py/ }).click()
  const editor = page.getByRole('textbox', {
    name: 'packages/laptop-diagnostic/scripts/analyze-snapshot.py',
    exact: true,
  })
  await editor.fill('# retain context\ndef broken(:\n')
  await editor.press('ControlOrMeta+s')
  await expect
    .poll(async () => (await packageFiles(page))['packages/laptop-diagnostic/scripts/analyze-snapshot.py'])
    .toBe('# retain context\ndef broken(:\n')
  await selectLaptop(page)
  await page.getByRole('button', { name: 'Validate Package', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Prepare Package', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Package overview' })).toContainText('scripts/analyze-snapshot.py')
  await page
    .getByRole('button', { name: /^Open scripts\/analyze-snapshot.py:2:/ })
    .first()
    .click()
  await expect(editor).toBeFocused()
  await expect(page.locator('.cm-activeLine')).toContainText('def broken(:')
})

test('shows external artifact changes and preserves unsaved text for an explicit choice', async ({ page }) => {
  await openPackages(page)
  await page.getByRole('treeitem', { name: /scripts\/analyze-snapshot.py/ }).click()
  const editor = page.getByRole('textbox', {
    name: 'packages/laptop-diagnostic/scripts/analyze-snapshot.py',
    exact: true,
  })
  await editor.fill('print("my draft")\n')
  await page.evaluate(() =>
    window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.change(
      'packages/laptop-diagnostic/scripts/analyze-snapshot.py',
      'print("disk")\n',
    ),
  )
  await expect(page.getByRole('button', { name: 'Keep Mine', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep Mine', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Compare artifact versions', exact: true }).click()
  await page.getByRole('button', { name: 'Keep Mine', exact: true }).click()
  await expect(editor).toContainText('my draft')
  await editor.press('ControlOrMeta+s')
  await expect
    .poll(async () => (await packageFiles(page))['packages/laptop-diagnostic/scripts/analyze-snapshot.py'])
    .toBe('print("my draft")\n')
})
