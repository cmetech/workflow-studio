import { expect, test, type Page } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const SEEDED_YAML = `name: Release demo
description: Verify the complete authoring path.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

async function expectAuthoritativeYaml(page: Page, expected: string): Promise<void> {
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(expected)
}

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

test('adds, duplicates, connects, references, renames, deletes, saves, and reopens exact authoritative YAML', async ({
  page,
}) => {
  await openSeededPair(page)
  await expectAuthoritativeYaml(page, SEEDED_YAML)

  await page.getByRole('button', { name: 'Add Node' }).click()
  const addNode = page.getByRole('dialog', { name: 'Add node' })
  await addNode.getByRole('option', { name: /Command/ }).click()
  const command = page.getByRole('group', { name: 'command node command' })
  await expect(command).toBeVisible()
  const afterAdd = `${SEEDED_YAML}  - id: command
    command: ""
`
  await expectAuthoritativeYaml(page, afterAdd)

  await command.focus()
  await command.press('Enter')
  const commandField = page.getByRole('textbox', { name: /Commandrequired/i })
  await expect(commandField).toBeEnabled()
  await commandField.fill('/review')
  await page.getByRole('button', { name: 'Apply Command' }).click()
  const afterCommand = afterAdd.replace('    command: ""\n', '    command: "/review"\n')
  await expectAuthoritativeYaml(page, afterCommand)
  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()

  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  const duplicateAction = page.getByRole('button', { name: 'Duplicate Selection' })
  await expect(duplicateAction).toBeEnabled()
  await duplicateAction.click()
  const duplicate = page.getByRole('group', { name: 'prompt node prepare-2' })
  await expect(duplicate).toBeVisible()
  const afterDuplicate = `name: Release demo
description: Verify the complete authoring path.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
  - id: command
    command: "/review"
  - id: prepare-2
    prompt: Prepare the release notes.
`
  await expectAuthoritativeYaml(page, afterDuplicate)

  await duplicate.focus()
  await duplicate.press('Enter')
  await page.getByRole('button', { name: 'Create Edge' }).click()
  await page.getByRole('option', { name: 'prepare' }).click()
  const afterEdge = afterDuplicate.replace(
    '  - id: prepare\n    prompt: Prepare the release notes.\n',
    '  - id: prepare\n    prompt: Prepare the release notes.\n    depends_on:\n      - prepare-2\n',
  )
  await expectAuthoritativeYaml(page, afterEdge)

  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()
  await prepare.focus()
  await prepare.press('Enter')
  await page.getByRole('tab', { name: 'Execution' }).click()
  const whenField = page.getByRole('textbox', { name: 'When', exact: true })
  await expect(whenField).toBeEnabled()
  await whenField.fill("$prepare-2.output.status == 'ready'")
  await page.getByRole('button', { name: 'Apply When' }).click()
  const afterReference = afterEdge.replace(
    '    depends_on:\n      - prepare-2\n',
    "    depends_on:\n      - prepare-2\n    when: $prepare-2.output.status == 'ready'\n",
  )
  await expectAuthoritativeYaml(page, afterReference)

  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()
  await duplicate.focus()
  await duplicate.press('Enter')
  await page.getByRole('tab', { name: 'General' }).click()
  const idField = page.getByRole('textbox', { name: /IDrequired/i })
  await expect(idField).toBeEnabled()
  await idField.fill('collect')
  await page.getByRole('button', { name: 'Apply ID' }).click()
  const renamed = page.getByRole('group', { name: 'prompt node collect' })
  await expect(renamed).toBeVisible()
  const afterRename = afterReference
    .replace('      - prepare-2\n', '      - collect\n')
    .replace('$prepare-2.output.status', '$collect.output.status')
    .replace('  - id: prepare-2\n', '  - id: collect\n')
  await expectAuthoritativeYaml(page, afterRename)

  const bounds = await renamed.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 18)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + 80, bounds!.y + 90, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await e2eSnapshot(page)).layout).not.toBeNull()

  await command.focus()
  await command.press('Enter')
  await page.getByRole('button', { name: 'Delete Selection' }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete selected nodes' })
  await deleteDialog.getByRole('button', { name: 'Delete nodes' }).click()
  await expect(deleteDialog).toBeHidden()
  await expect(command).toHaveCount(0)
  const afterDelete = afterRename.replace('  - id: command\n    command: "/review"\n', '')
  await expectAuthoritativeYaml(page, afterDelete)

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
  await expectAuthoritativeYaml(page, afterDelete)

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page
    .getByRole('button', { name: /^Create Editable Copy:/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
  await expectAuthoritativeYaml(page, afterDelete)
  const publishAfterReopen = await page.getByRole('group', { name: 'command node publish' }).boundingBox()
  expect(publishAfterReopen).not.toBeNull()
  expect(Math.abs(publishAfterReopen!.x - publishAfterDrag!.x)).toBeLessThan(5)
  expect(Math.abs(publishAfterReopen!.y - publishAfterDrag!.y)).toBeLessThan(5)
})
