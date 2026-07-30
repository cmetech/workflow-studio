import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

test('opens a seeded workflow pair before authoring begins', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()

  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect(page.getByText('prepare', { exact: true }).first()).toBeVisible()
})

test('updates the graph from authoritative YAML and saves the exact text', async ({ page }) => {
  const yaml = `name: YAML authored release
description: The graph is derived from this exact text.
nodes:
  - id: yaml_node
    prompt: Confirm the release.
`
  await openSeededPair(page)
  await replaceDefinitionYaml(page, yaml)
  await page.getByRole('button', { name: 'Split', exact: true }).click()

  await expect(page.getByRole('group', { name: 'prompt node yaml_node' })).toBeVisible()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(yaml)
})

test('duplicates, connects, renames, deletes, saves, and persists canvas layout through the visual surface', async ({
  page,
}) => {
  await openSeededPair(page)

  const prepare = page.getByRole('group', { name: 'prompt node prepare' })
  await prepare.focus()
  await prepare.press('Enter')
  const duplicateAction = page.getByRole('button', { name: 'Duplicate Selection' })
  await expect(duplicateAction).toBeEnabled()
  await duplicateAction.click()
  const duplicate = page.getByRole('group', { name: 'prompt node prepare-2' })
  await expect(duplicate).toBeVisible()

  await duplicate.focus()
  await duplicate.press('Enter')
  await page.getByRole('button', { name: 'Create Edge' }).click()
  await page.getByRole('option', { name: 'publish' }).click()

  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()
  await duplicate.focus()
  await duplicate.press('Enter')
  const idField = page.getByRole('textbox', { name: /IDrequired/i })
  await expect(idField).toBeEnabled()
  await idField.fill('verify')
  await page.getByRole('button', { name: 'Apply ID' }).click()
  const renamed = page.getByRole('group', { name: 'prompt node verify' })
  await expect(renamed).toBeVisible()

  const bounds = await renamed.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 18)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + 80, bounds!.y + 90, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await e2eSnapshot(page)).layout).not.toBeNull()

  await renamed.focus()
  await renamed.press('Enter')
  await page.getByRole('button', { name: 'Delete Selection' }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete selected nodes' })
  await deleteDialog.getByRole('button', { name: 'Delete nodes' }).click()
  await expect(deleteDialog).toBeHidden()
  await expect(renamed).toHaveCount(0)

  const publish = page.getByRole('group', { name: 'command node publish' })
  const publishBefore = await publish.boundingBox()
  expect(publishBefore).not.toBeNull()
  await page.mouse.move(publishBefore!.x + publishBefore!.width / 2, publishBefore!.y + 40)
  await page.mouse.down()
  await page.mouse.move(publishBefore!.x + 110, publishBefore!.y + 120, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await e2eSnapshot(page)).layout).not.toBeNull()
  const publishAfterDrag = await publish.boundingBox()
  expect(publishAfterDrag).not.toBeNull()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).not.toContain('id: verify')

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page
    .getByRole('button', { name: /^Create Editable Copy:/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
  const publishAfterReopen = await page.getByRole('group', { name: 'command node publish' }).boundingBox()
  expect(publishAfterReopen).not.toBeNull()
  expect(Math.abs(publishAfterReopen!.x - publishAfterDrag!.x)).toBeLessThan(5)
  expect(Math.abs(publishAfterReopen!.y - publishAfterDrag!.y)).toBeLessThan(5)
})
