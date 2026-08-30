import { expect, test, type Page } from '@playwright/test'
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

test('compact Inspector restores focus to its non-General active tab after reopening', async ({ page }) => {
  await openPairAt(page, 1024, 700)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')

  const inspector = page.locator('aside[aria-label="Inspector"]')
  const advanced = inspector.getByRole('tab', { name: 'Advanced' })
  await advanced.click()
  await expect(advanced).toHaveAttribute('aria-selected', 'true')
  await expect(advanced).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(prepare).toBeFocused()
  await prepare.press('Enter')

  await expect(inspector).not.toHaveAttribute('inert')
  await expect(advanced).toHaveAttribute('aria-selected', 'true')
  await expect(advanced).toBeFocused()
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
