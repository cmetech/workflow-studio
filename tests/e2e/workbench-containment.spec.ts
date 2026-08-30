import { expect, test } from '@playwright/test'
import { replaceDefinitionYaml } from './support'

const REPEATED_DIAGNOSTICS_YAML = `name: Repeated diagnostics
description: Exercise bounded Problems rendering.
nodes:
${Array.from({ length: 40 }, (_, index) => `  - id: duplicate\n    prompt: Diagnostic ${index + 1}.\n`).join('')}`

async function openSeededAuthoringPair(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
}

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

test('keeps Git and Updates visible while narrow status detail stays contained', async ({ page }) => {
  await page.setViewportSize({ width: 512, height: 350 })
  await page.goto('/')

  const status = page.getByRole('status', { name: 'Application status' })
  await expect(status.getByText('Git: no workspace')).toBeVisible()
  await expect(status.getByText('Updates: Current')).toBeVisible()
  const disclosure = status.getByText('More application status', { exact: true })
  await expect(disclosure).toBeVisible()
  await disclosure.click()
  await expect(status.getByText('YAML: pending')).toBeVisible()
  await expect(status.getByText('DAG: pending')).toBeVisible()

  const geometry = await page.evaluate(() => {
    const root = document.documentElement
    const statusBar = document.querySelector<HTMLElement>('[aria-label="Application status"]')!
    const items = [...statusBar.children].map((item) => item.getBoundingClientRect())
    return {
      rootWidth: root.scrollWidth,
      viewportWidth: root.clientWidth,
      rootHeight: root.scrollHeight,
      viewportHeight: root.clientHeight,
      statusBottom: statusBar.getBoundingClientRect().bottom,
      visibleItemsContained: items.every((item) => item.left >= 0 && item.right <= innerWidth),
    }
  })
  expect(geometry.rootWidth).toBe(geometry.viewportWidth)
  expect(geometry.rootHeight).toBe(geometry.viewportHeight)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.viewportHeight)
  expect(geometry.visibleItemsContained).toBe(true)
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

test('Inspector and Problems keep their final controls reachable inside the bounded authoring shell', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await openSeededAuthoringPair(page)

  await page.getByRole('group', { name: 'prompt node prepare', exact: true }).click()
  const inspector = page.locator('aside[aria-label="Inspector"]')
  await inspector.getByRole('tab', { name: 'Advanced' }).click()
  const inspectorBody = inspector.locator('[data-scroll-owner="inspector"]')
  const finalInspectorControl = inspectorBody.locator('button, input, textarea, select').last()
  await finalInspectorControl.scrollIntoViewIfNeeded()
  await finalInspectorControl.focus()
  await expect(finalInspectorControl).toBeFocused()

  const [inspectorBodyBox, inspectorControlBox] = await Promise.all([
    inspectorBody.boundingBox(),
    finalInspectorControl.boundingBox(),
  ])
  expect(inspectorBodyBox).not.toBeNull()
  expect(inspectorControlBox).not.toBeNull()
  expect(inspectorControlBox!.y).toBeGreaterThanOrEqual(inspectorBodyBox!.y)
  expect(inspectorControlBox!.y + inspectorControlBox!.height).toBeLessThanOrEqual(
    inspectorBodyBox!.y + inspectorBodyBox!.height,
  )

  await replaceDefinitionYaml(page, REPEATED_DIAGNOSTICS_YAML)
  const problems = page.getByRole('region', { name: 'Problems' })
  await expect(problems.getByRole('button')).toHaveCount(39)
  const problemsGroups = problems.locator('[data-scroll-owner="problems"]')
  const finalIssue = problems.getByRole('button').last()
  await finalIssue.scrollIntoViewIfNeeded()
  await finalIssue.focus()
  await expect(finalIssue).toBeFocused()

  const [groupsBox, issueBox] = await Promise.all([problemsGroups.boundingBox(), finalIssue.boundingBox()])
  expect(groupsBox).not.toBeNull()
  expect(issueBox).not.toBeNull()
  expect(issueBox!.y).toBeGreaterThanOrEqual(groupsBox!.y)
  expect(issueBox!.y + issueBox!.height).toBeLessThanOrEqual(groupsBox!.y + groupsBox!.height)

  const geometry = await page.evaluate(() => ({
    viewport: innerHeight,
    rootHeight: document.documentElement.getBoundingClientRect().height,
    statusBottom: document.querySelector('[aria-label="Application status"]')!.getBoundingClientRect().bottom,
  }))
  expect(geometry.rootHeight).toBe(geometry.viewport)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.viewport)
  expect(pageErrors.filter((message) => message.includes('each_key_duplicate'))).toEqual([])
})
