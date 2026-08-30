import { expect, test, type Locator, type Page } from '@playwright/test'
import { EXACT_GEOMETRIES, expectExactWorkbenchGeometry } from './support'

const LONG_WINDOWS_ROOT = 'C:\\workspaces\\release\\nested\\workflow-studio-with-a-long-workspace-identity'
const LONG_WINDOWS_PATH =
  'C:\\workspaces\\release\\nested\\workflow-definitions\\international\\release-demo-with-an-exceptionally-long-name.yaml'

async function expectLastControlReachable(page: Page, selector: Locator): Promise<void> {
  await selector.scrollIntoViewIfNeeded()
  await expect(selector).toBeVisible()
  const bounds = await selector.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
  await expectExactWorkbenchGeometry(page)
}

async function openPairForGeometry(page: Page, query: string, width: number, expectGraph = true): Promise<void> {
  await page.goto(`/${query}`)
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  if (width < 1280) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  if (expectGraph) await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
}

for (const geometry of EXACT_GEOMETRIES) {
  test(`covers every workbench surface at exact geometry ${geometry.label}`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(geometry.viewport)
    await page.goto('/?scenario=long-settings')

    const welcome = page.getByRole('region', { name: 'Welcome' })
    await expectLastControlReachable(page, welcome.getByRole('button', { name: 'Open Folder' }).last())

    await page.getByRole('button', { name: 'Open Folder' }).first().click()
    if (geometry.viewport.width < 1280) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
    await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
    if (geometry.viewport.width < 1280) await page.keyboard.press('Escape')
    await expectLastControlReachable(page, page.getByRole('button', { name: 'More canvas actions' }))

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Workflow Contracts' }).click()
    const lastContractAction = page
      .getByRole('list', { name: 'Available contracts' })
      .getByRole('listitem')
      .last()
      .getByRole('button', { name: /^Remove / })
    await expectLastControlReachable(page, lastContractAction)

    await page.getByRole('button', { name: 'Examples', exact: true }).click()
    await expectLastControlReachable(page, page.getByRole('button', { name: /^Create Editable Copy:/ }).last())

    await page.getByRole('button', { name: 'Documentation', exact: true }).click()
    await expectLastControlReachable(
      page,
      page.getByRole('listbox', { name: 'Documentation results' }).getByRole('option').last(),
    )

    await page.setViewportSize(geometry.viewport)
    await openPairForGeometry(page, '?scenario=long-git', geometry.viewport.width)
    if (geometry.viewport.width < 1280) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Git', exact: true }).click()
    await expect(page.locator('[data-workbench-page="git"] .repository-root')).toHaveText(LONG_WINDOWS_ROOT)
    await expect(page.locator('[data-workbench-page="git"] .status-path')).toContainText(
      `${LONG_WINDOWS_PATH} → workflows/release-demo.yaml`,
    )
    await expectLastControlReachable(
      page,
      page.getByRole('button', {
        name: /Document the exceptionally long Windows release workflow subject/,
      }),
    )

    await page.setViewportSize(geometry.viewport)
    await openPairForGeometry(page, '?scenario=advanced-inspector', geometry.viewport.width)
    if (geometry.viewport.width < 1280) await page.keyboard.press('Escape')
    const prepareNode = page.getByRole('group', { name: 'prompt node prepare', exact: true })
    await prepareNode.focus()
    await prepareNode.press('Enter')
    const inspector = page.locator('aside[aria-label="Inspector"]')
    await inspector.getByRole('tab', { name: 'Advanced' }).click()
    await expectLastControlReachable(
      page,
      inspector
        .locator(
          '[data-scroll-owner="inspector"] button, [data-scroll-owner="inspector"] input, [data-scroll-owner="inspector"] textarea, [data-scroll-owner="inspector"] select',
        )
        .last(),
    )

    await page.setViewportSize(geometry.viewport)
    await openPairForGeometry(page, '?scenario=repeated-diagnostics', geometry.viewport.width, false)
    if (geometry.viewport.width < 1280) await page.keyboard.press('Escape')
    const finalIssue = page.getByRole('region', { name: 'Problems' }).getByRole('button').last()
    await expectLastControlReachable(page, finalIssue)
  })
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

  const [yamlBox, dagBox] = await Promise.all([
    status.getByText('YAML: pending').boundingBox(),
    status.getByText('DAG: pending').boundingBox(),
  ])
  expect(yamlBox).not.toBeNull()
  expect(dagBox).not.toBeNull()
  expect(yamlBox!.y + yamlBox!.height).toBeLessThanOrEqual(dagBox!.y)

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

test('keeps a long dismissible application notice action visible at narrow height', async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 350 })
  await page.goto('/?scenario=long-application-notice')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()

  const notices = page.getByRole('region', { name: 'Application notices' })
  const notice = notices.locator('.application-notice')
  const message = notice.locator('[data-notice-scroll]')
  const dismiss = notice.getByRole('button', { name: 'Dismiss' })
  await expect(message).toContainText('Could not open the selected workspace')
  await expect(dismiss).toBeVisible()

  const geometry = await Promise.all([notice.boundingBox(), message.boundingBox(), dismiss.boundingBox()])
  const [noticeBox, messageBox, dismissBox] = geometry
  expect(noticeBox).not.toBeNull()
  expect(messageBox).not.toBeNull()
  expect(dismissBox).not.toBeNull()
  expect(dismissBox!.y).toBeGreaterThanOrEqual(noticeBox!.y)
  expect(dismissBox!.y + dismissBox!.height).toBeLessThanOrEqual(noticeBox!.y + noticeBox!.height)
  expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(dismissBox!.y)
  expect(await message.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await dismiss.click()
  await expect(notice).toBeHidden()
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
    await expectExactWorkbenchGeometry(page)
  }
})

test('many contracts and brand packs retain a reachable final action at every approved geometry', async ({ page }) => {
  await page.goto('/?scenario=long-settings')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  for (const size of [
    { width: 1024, height: 700 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 512, height: 350 },
  ]) {
    await page.setViewportSize(size)
    await page.getByRole('tab', { name: 'Appearance' }).click()
    const brandActions = page.getByRole('list', { name: 'Available brand packs' }).getByRole('button')
    expect(await brandActions.count()).toBeGreaterThanOrEqual(37)
    const lastBrandAction = brandActions.last()
    await lastBrandAction.scrollIntoViewIfNeeded()
    await expect(lastBrandAction).toBeVisible()
    await expectExactWorkbenchGeometry(page)

    await page.getByRole('tab', { name: 'Workflow Contracts' }).click()
    const contracts = page.getByRole('list', { name: 'Available contracts' }).getByRole('listitem')
    expect(await contracts.count()).toBeGreaterThanOrEqual(14)
    const lastContractAction = contracts.last().getByRole('button', { name: /^Remove / })
    await lastContractAction.scrollIntoViewIfNeeded()
    await expect(lastContractAction).toBeVisible()
    await expectExactWorkbenchGeometry(page)
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
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?scenario=advanced-inspector')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()

  await page.getByRole('group', { name: 'prompt node prepare', exact: true }).click()
  const inspector = page.locator('aside[aria-label="Inspector"]')
  await inspector.getByRole('tab', { name: 'Advanced' }).click()
  const inspectorBody = inspector.locator('[data-scroll-owner="inspector"]')
  expect(await inspectorBody.locator('button, input, textarea, select').count()).toBeGreaterThanOrEqual(12)
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

  await page.goto('/?scenario=repeated-diagnostics')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
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
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
