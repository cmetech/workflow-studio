import { expect, test, type Locator, type Page } from '@playwright/test'
import { e2eSnapshot, replaceDefinitionYaml } from './support'

const UNSAVED_YAML = `name: Release demo
description: Unsaved responsive layout edit.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

async function openPairAt(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  if (width < 1280) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
  if (width < 1280) {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeFocused()
  }
}

function modShortcut(key: string): string {
  return `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`
}

async function tabTo(page: Page, target: Locator, browserName: string, limit = 80): Promise<void> {
  const key = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  for (
    let index = 0;
    index < limit && !(await target.evaluate((element) => element === document.activeElement));
    index += 1
  )
    await page.keyboard.press(key)
  await expect(target).toBeFocused()
}

for (const viewport of [
  { width: 1024, height: 700 },
  { width: 1180, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`keeps the authoring region usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await openPairAt(page, viewport.width, viewport.height)

    const workbench = page.locator('.workbench')
    await expect(workbench).toHaveAttribute('data-panel-presentation', viewport.width < 1280 ? 'drawers' : 'docked')
    const editorBounds = await page.getByRole('region', { name: 'Workflow workspace' }).boundingBox()
    expect(editorBounds?.width).toBeGreaterThanOrEqual(720)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    )

    if (viewport.width < 1280) {
      const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
      const inspectorPanel = page.locator('aside[aria-label="Inspector"]')
      await expect(workspacePanel).toHaveAttribute('inert', '')
      await expect(workspacePanel).toHaveAttribute('aria-hidden', 'true')
      await expect(inspectorPanel).toHaveAttribute('inert', '')
      await expect(inspectorPanel).toHaveAttribute('aria-hidden', 'true')

      const nodes = page.getByRole('button', { name: 'Nodes', exact: true })
      await nodes.click()
      await expect(workspacePanel).not.toHaveAttribute('inert')
      await page.keyboard.press('Escape')
      await expect(nodes).toBeFocused()
      await expect(workspacePanel).toHaveAttribute('inert', '')
    }
  })
}

test('effective 200% reflow keeps authoring, status, and compact Split inside the viewport', async ({ page }) => {
  await openPairAt(page, 512, 350)
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-split-presentation', 'tabs')
  await expect(page.getByRole('group', { name: 'Split pane' })).toBeVisible()

  const geometry = await page.evaluate(() => {
    const root = document.documentElement
    const status = document.querySelector<HTMLElement>('[aria-label="Application status"]')!
    return {
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      statusBottom: status.getBoundingClientRect().bottom,
      innerHeight,
    }
  })
  expect(geometry.scrollHeight).toBe(geometry.clientHeight)
  expect(geometry.scrollWidth).toBe(geometry.clientWidth)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.innerHeight)
})

test('effective 200% reflow keeps a usable canvas and every More action contained and hittable', async ({ page }) => {
  await openPairAt(page, 512, 350)
  const viewport = page.getByRole('region', { name: 'Workflow canvas viewport' })
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  const menu = page.getByRole('menu', { name: 'More canvas actions' })
  const lastAction = menu.getByRole('menuitem', { name: 'Fit Graph' })

  const initial = await page.evaluate(() => {
    const bounds = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
    const editorBounds = bounds('[aria-label="Workflow workspace"]')
    const graphBounds = bounds('[aria-label="Workflow graph"]')
    const viewportBounds = bounds('[aria-label="Workflow canvas viewport"]')
    const menuElement = document.querySelector<HTMLElement>('[role="menu"][aria-label="More canvas actions"]')!
    const menuBounds = menuElement.getBoundingClientRect()
    return {
      editor: { top: editorBounds.top, bottom: editorBounds.bottom },
      graph: { top: graphBounds.top, bottom: graphBounds.bottom },
      viewportHeight: viewportBounds.height,
      menu: { top: menuBounds.top, bottom: menuBounds.bottom },
      menuScrollHeight: menuElement.scrollHeight,
      menuClientHeight: menuElement.clientHeight,
    }
  })
  expect(initial.graph.top).toBeGreaterThanOrEqual(initial.editor.top)
  expect(initial.graph.bottom).toBeLessThanOrEqual(initial.editor.bottom)
  expect(initial.viewportHeight).toBeGreaterThanOrEqual(44)
  expect(initial.menu.top).toBeGreaterThanOrEqual(initial.graph.top)
  expect(initial.menu.bottom).toBeLessThanOrEqual(initial.graph.bottom)
  expect(initial.menuScrollHeight).toBeGreaterThan(initial.menuClientHeight)

  await lastAction.scrollIntoViewIfNeeded()
  await lastAction.focus()
  await expect(lastAction).toBeFocused()
  expect(
    await lastAction.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return (
        document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.closest('button') ===
        element
      )
    }),
  ).toBe(true)
  const [menuBox, actionBox, viewportBox] = await Promise.all([
    menu.boundingBox(),
    lastAction.boundingBox(),
    viewport.boundingBox(),
  ])
  expect(menuBox).not.toBeNull()
  expect(actionBox).not.toBeNull()
  expect(viewportBox).not.toBeNull()
  expect(actionBox!.y).toBeGreaterThanOrEqual(menuBox!.y)
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(menuBox!.y + menuBox!.height)
  expect(viewportBox!.height).toBeGreaterThanOrEqual(44)
  await lastAction.click()
  await expect(menu).toBeHidden()
})

for (const width of [1024, 1280]) {
  test(`keeps both Explorer actions inside the workspace panel at ${width}px`, async ({ page }) => {
    await openPairAt(page, width, 700)
    const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
    if (width < 1280) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await expect.poll(async () => (await workspacePanel.boundingBox())?.x).toBe(48)

    const panelBox = await workspacePanel.boundingBox()
    expect(panelBox).not.toBeNull()
    if (width < 1280) expect(panelBox!.width).toBe(320)
    for (const name of ['New Workflow', 'Import']) {
      const action = workspacePanel.getByRole('button', { name, exact: true })
      await expect(action).toHaveAttribute('title', name)
      await expect(action.locator('svg')).toHaveCount(1)
      const actionBox = await action.boundingBox()
      expect(actionBox).not.toBeNull()
      expect(actionBox!.x).toBeGreaterThanOrEqual(panelBox!.x)
      expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)
      expect(actionBox!.y).toBeGreaterThanOrEqual(panelBox!.y)
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height)
    }
  })
}

test('scrolls and focuses the last node kind without leaving the contextual drawer', async ({ page }) => {
  await openPairAt(page, 1024, 700)
  await page.getByRole('button', { name: 'Nodes', exact: true }).click()

  const panel = page.locator('aside[aria-label="Workspace panel"]')
  const kinds = panel.locator('[data-node-palette-scroll]').getByRole('button')
  const lastKind = kinds.last()
  await lastKind.scrollIntoViewIfNeeded()
  await lastKind.focus()
  await expect(lastKind).toBeFocused()

  const [panelBox, kindBox] = await Promise.all([panel.boundingBox(), lastKind.boundingBox()])
  expect(panelBox).not.toBeNull()
  expect(kindBox).not.toBeNull()
  expect(kindBox!.y).toBeGreaterThanOrEqual(panelBox!.y)
  expect(kindBox!.y + kindBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height)
})

test('compact drawer cycles preserve unsaved YAML and node selection', async ({ page }) => {
  await openPairAt(page, 1024, 700)
  await replaceDefinitionYaml(page, UNSAVED_YAML)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()

  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(inspector.getByRole('tab', { selected: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(prepare).toBeFocused()

  const explorer = page.getByRole('button', { name: 'Explorer', exact: true })
  await explorer.click()
  await page.keyboard.press('Escape')
  await explorer.click()
  await page.keyboard.press('Escape')

  await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)
})

test('Workflow context menu consumes Escape before its Explorer drawer', async ({ page }) => {
  await openPairAt(page, 1024, 700)

  const explorer = page.getByRole('button', { name: 'Explorer', exact: true })
  const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
  await explorer.click()
  await expect(workspacePanel).not.toHaveAttribute('inert')

  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await pair.click({ button: 'right' })
  const contextMenu = page.getByRole('menu', { name: 'Workflow actions' })
  await expect(contextMenu).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(contextMenu).toBeHidden()
  await expect(workspacePanel).not.toHaveAttribute('inert')
  await expect(pair).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(workspacePanel).toHaveAttribute('inert', '')
  await expect(explorer).toBeFocused()
})

test('Canvas More menu consumes Escape before its Inspector drawer', async ({ page }) => {
  await openPairAt(page, 1024, 700)

  const inspector = page.locator('aside[aria-label="Inspector"]')
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await expect(inspector).not.toHaveAttribute('inert')

  const more = page.getByRole('button', { name: 'More canvas actions' })
  await more.focus()
  await expect(more).toBeFocused()
  await page.keyboard.press('Space')
  const moreMenu = page.getByRole('menu', { name: 'More canvas actions' })
  await expect(moreMenu).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(moreMenu).toBeHidden()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toBeFocused()
  await expect(inspector).not.toHaveAttribute('inert')

  await page.keyboard.press('Escape')
  await expect(inspector).toHaveAttribute('inert', '')
  await expect(prepare).toHaveClass(/selected/)
  await expect(prepare).toBeFocused()
})

test('keyboard edge picker consumes Escape before its Inspector drawer', async ({ page }) => {
  await openPairAt(page, 1024, 700)

  const inspector = page.locator('aside[aria-label="Inspector"]')
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await expect(inspector).not.toHaveAttribute('inert')

  const createEdge = page.getByRole('button', { name: 'Create Edge' })
  await expect(createEdge).toBeEnabled()
  await createEdge.focus()
  await expect(createEdge).toBeFocused()
  await page.keyboard.press('Space')
  const edgePicker = page.getByText('Create edge from prepare', { exact: true })
  await expect(edgePicker).toBeVisible()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(edgePicker).toBeHidden()
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveText('Edge creation cancelled.')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(prepare).toHaveClass(/selected/)
  await expect(createEdge).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Workflow inspector' })).toContainText('prepare')

  await page.keyboard.press('Escape')
  await expect(inspector).toHaveAttribute('inert', '')
  await expect(prepare).toHaveClass(/selected/)
  await expect(prepare).toBeFocused()
})

test('dependency ports retain descriptive names without claiming keyboard button behavior', async ({ page }) => {
  await openPairAt(page, 1024, 700)

  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  for (const name of ['Dependencies entering prepare', 'Dependencies leaving prepare']) {
    const port = prepare.locator(`[aria-label="${name}"]`)
    await expect(port).toHaveAccessibleName(name)
    await expect(port).not.toHaveAttribute('role', 'button')
    await expect(port).not.toHaveAttribute('tabindex', '0')
  }
})

test('Inspector disclosure can consume Escape before the next event closes its drawer', async ({ page }) => {
  await openPairAt(page, 1024, 700)

  const inspector = page.locator('aside[aria-label="Inspector"]')
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const inspectorTrigger = page.getByRole('button', { name: 'Inspector for prepare' })
  await inspectorTrigger.focus()
  await inspectorTrigger.press('Enter')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'true')

  await inspectorTrigger.evaluate((element) => {
    element.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return
        element.setAttribute('data-escape-consumed', 'true')
        event.preventDefault()
        event.stopPropagation()
      },
      { once: true },
    )
  })
  await inspectorTrigger.focus()
  await expect(inspectorTrigger).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(inspectorTrigger).toHaveAttribute('data-escape-consumed', 'true')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'true')
  await expect(prepare).toHaveClass(/selected/)
  await expect(inspectorTrigger).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(inspector).toHaveAttribute('inert', '')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(inspectorTrigger).toBeFocused()
})

test('real viewport resize keeps focus in Explorer and Inspector when docked panels become drawers', async ({
  page,
}) => {
  await openPairAt(page, 1440, 900)

  const workbench = page.locator('.workbench')
  const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await pair.focus()
  await page.setViewportSize({ width: 1180, height: 800 })
  await expect(workbench).toHaveAttribute('data-panel-presentation', 'drawers')
  await expect(workspacePanel).not.toHaveAttribute('inert')
  await expect(pair).toBeFocused()

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(workbench).toHaveAttribute('data-panel-presentation', 'docked')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  const advanced = inspector.getByRole('tab', { name: 'Advanced' })
  await advanced.focus()
  await page.setViewportSize({ width: 1180, height: 800 })
  await expect(workbench).toHaveAttribute('data-panel-presentation', 'drawers')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(advanced).toBeFocused()
})

test('resize-created Inspector drawer restores focus to the currently selected node', async ({ page }) => {
  await openPairAt(page, 1024, 700)

  const workbench = page.locator('.workbench')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await expect(inspector).not.toHaveAttribute('inert')

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(workbench).toHaveAttribute('data-panel-presentation', 'docked')
  const publish = page.getByRole('group', { name: 'command node publish', exact: true })
  await publish.click()
  await expect(publish).toHaveClass(/selected/)
  await expect(prepare).not.toHaveClass(/selected/)

  const activeInspectorTab = inspector.getByRole('tab', { selected: true })
  await activeInspectorTab.focus()
  await expect(activeInspectorTab).toBeFocused()
  await page.setViewportSize({ width: 1180, height: 800 })
  await expect(workbench).toHaveAttribute('data-panel-presentation', 'drawers')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(activeInspectorTab).toBeFocused()

  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('command node publish')
  await expect(publish).toBeFocused()
  await expect(publish).toHaveClass(/selected/)
})

test('resize-created Inspector Escape preserves the current keyboard-selected node instead of its stale owner', async ({
  browserName,
  page,
}) => {
  await openPairAt(page, 1440, 900)

  const workbench = page.locator('.workbench')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  const publish = page.getByRole('group', { name: 'command node publish', exact: true })
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await publish.click()
  await expect(publish).toHaveClass(/selected/)

  const activeInspectorTab = inspector.getByRole('tab', { selected: true })
  await activeInspectorTab.focus()
  await page.setViewportSize({ width: 1180, height: 800 })
  await expect(workbench).toHaveAttribute('data-panel-presentation', 'drawers')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(activeInspectorTab).toBeFocused()

  await tabTo(page, prepare, browserName)
  await page.keyboard.press('Space')
  await expect(prepare).toHaveClass(/selected/)
  await expect(publish).not.toHaveClass(/selected/)
  await expect(prepare).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(inspector).toHaveAttribute('inert', '')
  await expect(prepare).toHaveClass(/selected/)
  await expect(prepare).toBeFocused()
})

test('real viewport resize activates the focused YAML or Canvas surface in compact Split', async ({ page }) => {
  await openPairAt(page, 1440, 900)
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  const workbench = page.locator('.workbench')
  const canvas = page.getByRole('region', { name: 'Workflow graph' })
  const yaml = page.getByRole('textbox', { name: 'Definition YAML' })

  await yaml.focus()
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(workbench).toHaveAttribute('data-split-presentation', 'tabs')
  let splitPane = page.getByRole('group', { name: 'Split pane' })
  await expect(splitPane.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
  await expect(yaml).toBeFocused()

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(workbench).toHaveAttribute('data-split-presentation', 'side-by-side')
  await canvas.focus()
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(workbench).toHaveAttribute('data-split-presentation', 'tabs')
  splitPane = page.getByRole('group', { name: 'Split pane' })
  await expect(splitPane.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toBeFocused()
})

test('Split uses two 360px panes only at the true 721px usable editor boundary', async ({ page }) => {
  await openPairAt(page, 1440, 900)
  await page.getByRole('button', { name: 'Split', exact: true }).click()

  const workbench = page.locator('.workbench')
  const editor = page.getByRole('region', { name: 'Workflow workspace' })
  await editor.evaluate((element) => (element.style.width = '720px'))
  await expect(workbench).toHaveAttribute('data-split-presentation', 'tabs')
  await expect(page.getByRole('group', { name: 'Split pane' })).toBeVisible()

  await editor.evaluate((element) => (element.style.width = '721px'))
  await expect(workbench).toHaveAttribute('data-split-presentation', 'side-by-side')
  const [canvasBox, yamlBox] = await Promise.all([
    page.locator('.canvas-pane').boundingBox(),
    page.locator('.yaml-pane').boundingBox(),
  ])
  expect(canvasBox?.width).toBeGreaterThanOrEqual(360)
  expect(yamlBox?.width).toBeGreaterThanOrEqual(360)
})

test('compact Inspector restores focus to its non-General active tab after reopening', async ({ page }) => {
  await openPairAt(page, 1024, 700)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await expect(prepare).not.toHaveAttribute('aria-expanded')
  const inspectorTrigger = page.getByRole('button', { name: /Inspector for prepare$/ })
  await expect(inspectorTrigger).toHaveAttribute('aria-controls', 'workflow-inspector')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'false')
  await prepare.focus()
  await prepare.press('Enter')

  const inspector = page.locator('aside[aria-label="Inspector"]')
  await expect(inspector).toHaveAttribute('id', 'workflow-inspector')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'true')
  await expect(inspectorTrigger).toMatchAriaSnapshot('- button "Inspector for prepare" [expanded]')
  const advanced = inspector.getByRole('tab', { name: 'Advanced' })
  await advanced.click()
  await expect(advanced).toHaveAttribute('aria-selected', 'true')
  await expect(advanced).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(prepare).toBeFocused()
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'false')
  await inspectorTrigger.click()

  await expect(inspector).not.toHaveAttribute('inert')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'true')
  await expect(advanced).toHaveAttribute('aria-selected', 'true')
  await expect(advanced).toBeFocused()

  const publish = page.getByRole('group', { name: 'command node publish', exact: true })
  const publishInspectorTrigger = page.getByRole('button', { name: /Inspector for publish$/ })
  await expect(publishInspectorTrigger).toHaveAttribute('aria-expanded', 'false')
  await publishInspectorTrigger.focus()
  await publishInspectorTrigger.press('Enter')
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(publish).toHaveClass(/selected/)
  await expect(prepare).not.toHaveClass(/selected/)
  await expect(publishInspectorTrigger).toHaveAttribute('aria-expanded', 'true')
  await expect(inspectorTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(advanced).toBeFocused()

  await publishInspectorTrigger.focus()
  await publishInspectorTrigger.press('Enter')
  await expect(inspector).toHaveAttribute('inert', '')
  await expect(inspector).toHaveAttribute('aria-hidden', 'true')
  await expect(publishInspectorTrigger).toBeFocused()
  await expect(publishInspectorTrigger).toHaveAttribute('aria-expanded', 'false')
})

test('keyboard-only compact drawers and Split subtabs restore focus and expose named icon controls', async ({
  browserName,
  page,
}) => {
  await openPairAt(page, 1024, 700)
  const canvas = page.getByRole('region', { name: 'Workflow graph' })
  await canvas.focus()

  await page.keyboard.press(modShortcut('B'))
  const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
  const closeWorkspace = page.getByRole('button', { name: 'Close workspace panel' })
  await expect(workspacePanel).not.toHaveAttribute('inert')
  await expect(closeWorkspace).toBeFocused()
  await expect(closeWorkspace).toHaveAttribute('title', 'Close workspace panel')
  await expect(closeWorkspace.locator('svg')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(canvas).toBeFocused()
  await expect(workspacePanel).toHaveAttribute('inert', '')

  await page.keyboard.press(modShortcut('B'))
  const explorer = page.getByRole('button', { name: 'Explorer' })
  await explorer.click()
  await expect(workspacePanel).toHaveAttribute('inert', '')
  await explorer.click()
  await expect(workspacePanel).not.toHaveAttribute('inert')
  await closeWorkspace.click()
  await expect(explorer).toBeFocused()

  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await page.keyboard.press('Enter')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  const closeInspector = page.getByRole('button', { name: 'Close inspector' })
  await expect(inspector).not.toHaveAttribute('inert')
  await expect(closeInspector).toHaveAttribute('title', 'Close inspector')
  await expect(closeInspector.locator('svg')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(prepare).toBeFocused()

  await expect(page.getByRole('button', { name: 'More canvas actions' })).toHaveAccessibleName('More canvas actions')
  await expect(page.locator('[aria-label="Dependencies entering prepare"]')).toHaveAccessibleName(
    'Dependencies entering prepare',
  )
  await expect(page.locator('[aria-label="Dependencies leaving prepare"]')).toHaveAccessibleName(
    'Dependencies leaving prepare',
  )

  const workbench = page.locator('.workbench')
  await workbench.evaluate((element) =>
    element.setAttribute('style', `${element.getAttribute('style') ?? ''};width:748px`),
  )
  await page.keyboard.press(modShortcut('2'))
  const splitPane = page.getByRole('group', { name: 'Split pane' })
  const canvasSubtab = splitPane.getByRole('button', { name: 'Canvas' })
  const yamlSubtab = splitPane.getByRole('button', { name: 'YAML' })
  await expect(canvasSubtab).toHaveAttribute('aria-pressed', 'true')
  await canvasSubtab.focus()
  await expect(canvasSubtab).toBeFocused()
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
  await expect(yamlSubtab).toBeFocused()
  await page.keyboard.press('Space')
  await expect(yamlSubtab).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('reduced motion removes workbench durations and forced colors preserve focus outlines', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPairAt(page, 1024, 700)
  await page.keyboard.press(modShortcut('B'))

  const workbench = page.locator('.workbench')
  await workbench.evaluate((element) =>
    element.setAttribute('style', `${element.getAttribute('style') ?? ''};width:748px`),
  )
  await page.keyboard.press(modShortcut('2'))
  const splitPane = page.getByRole('group', { name: 'Split pane' })
  const reducedMotionTargets = [
    page.locator('aside[aria-label="Workspace panel"]'),
    splitPane.getByRole('button', { name: 'Canvas' }),
    page.locator('.workflow-node').first(),
    page.getByRole('button', { name: 'More canvas actions' }),
  ]
  for (const target of reducedMotionTargets) {
    await expect(target).toBeAttached()
    expect(
      await target.evaluate((element) => {
        const style = getComputedStyle(element)
        return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration }
      }),
    ).toEqual({ animationDuration: '0s', transitionDuration: '0s' })
  }

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  for (const control of [
    page.getByRole('button', { name: 'Close workspace panel' }),
    splitPane.getByRole('button', { name: 'Canvas' }),
  ]) {
    await control.focus()
    const outline = await control.evaluate((element) => {
      const style = getComputedStyle(element)
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThan(0)
  }
})

test('compact Split switches mounted surfaces without changing Split mode or scroll state', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  await page.addInitScript(() => {
    const resizeErrors: string[] = []
    Object.defineProperty(window, '__WORKBENCH_RESIZE_ERRORS__', { value: resizeErrors })
    window.addEventListener('error', (event) => {
      if (/ResizeObserver loop/i.test(event.message)) resizeErrors.push(event.message)
    })
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await openPairAt(page, 1024, 700)
  await replaceDefinitionYaml(
    page,
    `${UNSAVED_YAML}${Array.from({ length: 80 }, (_, index) => `# line ${index}\n`).join('')}`,
  )
  await page.getByRole('button', { name: 'Split', exact: true }).click()

  const workbench = page.locator('.workbench')
  await workbench.evaluate((element) =>
    element.setAttribute('style', `${element.getAttribute('style') ?? ''};width:748px`),
  )
  const splitPane = page.getByRole('group', { name: 'Split pane' })
  await expect(splitPane).toBeVisible()

  const canvas = page.locator('[aria-label="Workflow graph"]')
  const yaml = page.locator('[role="tabpanel"]').first()
  await canvas.evaluate((element) => (element.dataset.testInstance = 'original-canvas'))
  await yaml.evaluate((element) => (element.dataset.testInstance = 'original-yaml'))
  await splitPane.getByRole('button', { name: 'YAML' }).click()
  const yamlScroller = yaml.locator('.cm-scroller')
  await yamlScroller.evaluate((element) => (element.scrollTop = 120))
  const yamlScroll = await yamlScroller.evaluate((element) => element.scrollTop)
  const viewportBefore = (await e2eSnapshot(page)).layout

  await splitPane.getByRole('button', { name: 'Canvas' }).click()
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await splitPane.getByRole('button', { name: 'YAML' }).click()

  await expect(canvas).toHaveAttribute('data-test-instance', 'original-canvas')
  await expect(yaml).toHaveAttribute('data-test-instance', 'original-yaml')
  expect(await yamlScroller.evaluate((element) => element.scrollTop)).toBe(yamlScroll)
  expect((await e2eSnapshot(page)).layout).toEqual(viewportBefore)
  const resizeErrors = await page.evaluate(
    () => (window as unknown as { __WORKBENCH_RESIZE_ERRORS__: string[] }).__WORKBENCH_RESIZE_ERRORS__,
  )
  expect(
    [...pageErrors, ...consoleErrors, ...resizeErrors].filter((message) => /ResizeObserver loop/i.test(message)),
  ).toEqual([])
})
