import { expect, test } from '@playwright/test'
import { openPackages, packageFiles } from './package-support'

test('creates and edits a node script while preserving its workflow and return focus', async ({ page }) => {
  await openPackages(page)
  await page.getByRole('treeitem', { name: 'workflows/laptop-diagnostic.yaml', exact: true }).click()
  await page.getByRole('group', { name: /node analyze-cpu$/ }).click()
  const actions = page.getByRole('group', { name: 'Package resource actions', exact: true })
  await actions.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByLabel('Resource name', { exact: true }).fill('custom-analysis')
  await page.getByLabel('Initial content', { exact: true }).fill('print("created")\n')
  await page.getByRole('button', { name: 'Preview change', exact: true }).click()
  await page.getByRole('button', { name: 'Create and update workflow', exact: true }).click()
  const path = 'packages/laptop-diagnostic/scripts/custom-analysis.py'
  const editor = page.getByRole('textbox', { name: path, exact: true })
  await expect(editor).toContainText('print("created")')
  await editor.fill('print("edited")\n')
  await editor.press('ControlOrMeta+s')
  await expect.poll(async () => (await packageFiles(page))[path]).toBe('print("edited")\n')
  expect((await packageFiles(page))['packages/laptop-diagnostic/workflows/laptop-diagnostic.yaml']).toContain(
    'script: custom-analysis',
  )
  await page.getByRole('button', { name: 'Back to Workflow', exact: true }).click()
  await expect(actions.getByRole('button', { name: 'Create', exact: true })).toBeFocused()
  const calls = await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.calls())
  expect(calls.filter((call) => /execute|spawn|push|fetch|pull/i.test(call))).toEqual([])
})

test('replaces a binary resource through a chosen file without offering text editing', async ({ page }) => {
  await openPackages(page, 'package-binary')
  await page.getByRole('treeitem', { name: 'assets/sample.bin', exact: true }).click()
  const resource = page.getByRole('region', { name: 'Binary resource' })
  await expect(resource).toContainText('2 bytes')
  await expect(resource.getByRole('textbox')).toHaveCount(0)
  await resource.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(resource).toContainText('3 bytes')
  const calls = await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.calls())
  expect(calls).toContain('chooseImportArtifact')
  expect(calls).toContain('workspaceReplaceArtifact')
  expect(calls.filter((call) => /execute|spawn|push|fetch|pull/i.test(call))).toEqual([])
})

test('creates a package and a script as local files without executing content', async ({ page }) => {
  await openPackages(page)
  await page.getByRole('button', { name: 'New Package', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New Package' })
  for (const [label, value] of Object.entries({
    'Package ID': 'new-support',
    'Display name': 'New support',
    Description: 'Local support',
    License: 'MIT',
    Publisher: 'local',
    'Tags (comma separated)': 'support',
    'Destination folder': 'packages/new-support',
  }))
    await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Create Package', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New support', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add Artifact', exact: true }).click()
  await page.getByLabel('Package-relative filename').fill('scripts/local.py')
  await page.getByLabel('Initial text').fill('print("authored, never executed")\n')
  await page.getByRole('button', { name: 'Create text artifact', exact: true }).click()
  await expect
    .poll(async () => (await packageFiles(page))['packages/new-support/scripts/local.py'])
    .toBe('print("authored, never executed")\n')
  const calls = await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.calls())
  expect(calls).toContain('workspaceApplyTransaction')
  expect(calls.filter((call) => /execute|spawn|push|fetch|pull|terminal/i.test(call))).toEqual([])
})

test('keeps separate package workflows and copies complete bundled resources', async ({ page }) => {
  await openPackages(page)
  const before = await packageFiles(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByRole('button', { name: 'Create Editable Copy: Shared support workflows', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Package overview' })
      .getByRole('heading', { name: 'Shared support workflows', exact: true }),
  ).toBeVisible()
  const after = await packageFiles(page)
  for (const [path, text] of Object.entries(before)) expect(after[path]).toBe(text)
  const copied = Object.keys(after).filter((path) => path.startsWith('packages/multi-workflow-support/'))
  expect(copied).toContain('packages/multi-workflow-support/digests.json')
  expect(copied.filter((path) => path.endsWith('.py'))).toHaveLength(1)
  await expect(page.getByRole('button', { name: /Open Workflow:/ })).toHaveCount(2)
})

test('supports package dialog and tree keyboard navigation with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPackages(page)
  const create = page.getByRole('button', { name: 'New Package', exact: true })
  await create.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Package ID', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(create).toBeFocused()
  const tree = page.getByRole('tree', { name: 'Packages', exact: true })
  await tree.getByRole('treeitem').first().focus()
  await page.keyboard.press('End')
  await expect(tree.getByRole('treeitem').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tree.getByRole('treeitem').first()).toBeFocused()
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
})
