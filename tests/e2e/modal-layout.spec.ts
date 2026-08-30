import { expect, test, type Locator, type Page } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const DIRTY_YAML = `name: Release demo
description: Unsaved modal conflict fixture.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

async function assertRealResponsiveModal(page: Page, dialog: Locator, reachableAction: Locator): Promise<void> {
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true)

  const backgroundControl = page.getByRole('button', { name: 'Explorer', exact: true })
  expect(
    await backgroundControl.evaluate((element) => {
      element.focus()
      return document.activeElement === element
    }),
  ).toBe(false)

  await page.setViewportSize({ width: 512, height: 350 })
  const body = dialog.locator('[data-modal-body]')
  await expect(body).toBeVisible()
  await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await reachableAction.scrollIntoViewIfNeeded()
  await expect(reachableAction).toBeVisible()
  const [actionBox, viewportHeight] = await Promise.all([
    reachableAction.boundingBox(),
    page.evaluate(() => innerHeight),
  ])
  expect(actionBox).not.toBeNull()
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(viewportHeight)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}

test('New Workflow is a top-layer modal with reachable actions at reflow size', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Workflow', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New Workflow' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Create Workflow' }))
})

test('Import is a top-layer modal with reachable actions at reflow size', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import workflow' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Import YAML Pair' }))
})

test('Quick Open is a top-layer modal with contained focus and scrollable results', async ({ page }) => {
  await openSeededPair(page)
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+P`)
  const dialog = page.getByRole('dialog', { name: 'Quick Open' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('option').first())
})

test('External Change is a top-layer modal with persistent conflict actions', async ({ page }) => {
  await openSeededPair(page)
  await replaceDefinitionYaml(page, DIRTY_YAML)
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(DIRTY_YAML)
  await page.evaluate(async () => window.__WORKFLOW_STUDIO_E2E__!.triggerExternalChange())
  const dialog = page.getByRole('dialog', { name: 'Workflow changed on disk' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Compare' }))
})

test('Add Node is a top-layer modal with reachable contract choices', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Add Node' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add node' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('option').first())
})

test('Add Node Escape is owned by the modal before the compact workspace drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
  const nodesActivity = page.getByRole('button', { name: 'Nodes', exact: true })
  await nodesActivity.click()
  const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
  await expect(workspacePanel).not.toHaveAttribute('inert')

  const addNodeButton = page.getByRole('button', { name: 'Add Node', exact: true })
  await addNodeButton.focus()
  await addNodeButton.evaluate((element) => (element as HTMLButtonElement).click())
  const dialog = page.getByRole('dialog', { name: 'Add node' })
  await expect(dialog).toBeVisible()
  await dialog.evaluate((element) => {
    element.addEventListener(
      'keydown',
      () => {
        document.body.dataset.modalEscapeOwned = 'true'
      },
      { capture: true, once: true },
    )
  })

  await page.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(page.locator('body')).toHaveAttribute('data-modal-escape-owned', 'true')
  await expect(workspacePanel).not.toHaveAttribute('inert')
  await expect(page.locator('.graph-canvas')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(workspacePanel).toHaveAttribute('inert', '')
  await expect(nodesActivity).toBeFocused()
})

test('Delete is a top-layer modal with persistent impact actions', async ({ page }) => {
  await openSeededPair(page)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete Selection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete selected nodes' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Delete nodes' }))
})

test('Command Palette is a top-layer modal with reachable search results', async ({ page }) => {
  await openSeededPair(page)
  await page.keyboard.press('F1')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('option').first())
})
