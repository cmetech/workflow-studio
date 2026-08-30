import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const UNSAVED_YAML = `name: Release demo
description: Unsaved activity page edit.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
${Array.from({ length: 80 }, (_, index) => `# retained scroll line ${index}\n`).join('')}`

test('preserves exact authoring state across full-workbench page navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openSeededPair(page)
  await replaceDefinitionYaml(page, UNSAVED_YAML)
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)

  await page.getByRole('button', { name: 'Split', exact: true }).click()
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
  const inspectorSelection = page.locator('aside[aria-label="Inspector"] strong').first()
  await expect(inspectorSelection).toHaveText('prepare')
  await expect.poll(async () => (await e2eSnapshot(page)).layout).not.toBeNull()
  const layoutBefore = (await e2eSnapshot(page)).layout
  const splitPane = page.getByRole('group', { name: 'Split pane' })
  await splitPane.getByRole('button', { name: 'YAML' }).click()
  const yamlScroller = page.locator('[aria-label="Definition YAML"] .cm-scroller')
  await expect(page.locator('[aria-label="Definition YAML"] .cm-content')).toContainText('# retained scroll line 79')
  const yamlGeometry = await yamlScroller.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(yamlGeometry.scrollHeight, JSON.stringify(yamlGeometry)).toBeGreaterThan(yamlGeometry.clientHeight)
  await yamlScroller.evaluate((element) => element.scrollTo({ top: 120 }))
  await expect.poll(() => yamlScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const yamlScrollBefore = await yamlScroller.evaluate((element) => element.scrollTop)

  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  await settings.click()
  await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Workflow workspace', includeHidden: true })).toHaveAttribute(
    'inert',
    '',
  )
  await expect(inspectorSelection).toHaveText('prepare')
  await page.getByRole('button', { name: 'Back to Workflow' }).click()

  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(settings).toBeFocused()
  await expect(inspectorSelection).toHaveText('prepare')
  await expect.poll(() => yamlScroller.evaluate((element) => element.scrollTop)).toBe(yamlScrollBefore)
  expect((await e2eSnapshot(page)).layout).toEqual(layoutBefore)

  await splitPane.getByRole('button', { name: 'Canvas' }).click()
  await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
  await splitPane.getByRole('button', { name: 'YAML' }).click()
  await expect.poll(() => yamlScroller.evaluate((element) => element.scrollTop)).toBe(yamlScrollBefore)
})

test('Settings exposes one responsive keyboard-operable category at a time', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const appearance = page.getByRole('tab', { name: 'Appearance' })
  await expect(appearance).toBeVisible()
  await expect(appearance).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Appearance' })).toBeVisible()

  const contracts = page.getByRole('tab', { name: 'Workflow Contracts' })
  await contracts.click()
  await expect(page.getByRole('heading', { name: 'Workflow contracts' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).toHaveCount(1)

  await contracts.press('End')
  await expect(page.getByRole('tab', { name: 'About' })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'About' })).toBeVisible()
})

test('Welcome replaces inactive authoring chrome while preserving activity access', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')

  const welcome = page.getByRole('region', { name: 'Welcome' })
  await expect(welcome).toBeVisible()
  await expect(welcome.getByRole('button', { name: 'Open Folder' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Activities' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Workflow workspace', includeHidden: true })).toHaveAttribute(
    'hidden',
    '',
  )
  await expect(page.getByRole('region', { name: 'Workflow workspace', includeHidden: true })).toHaveAttribute(
    'inert',
    '',
  )
  await expect(page.getByRole('complementary', { name: 'Inspector', includeHidden: true })).toHaveAttribute(
    'hidden',
    '',
  )
  await expect(welcome.getByRole('group', { name: 'Editor mode' })).toHaveCount(0)
})

test('Examples and Documentation reveal selected detail immediately and keep the last result reachable', async ({
  page,
}) => {
  await openSeededPair(page)
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByRole('button', { name: 'Preview Minimal prompt' }).click()

  const exampleBody = page.locator('[data-workbench-page="examples"] [data-page-scroll]')
  const exampleDetail = page.getByRole('region', { name: 'Minimal prompt preview' })
  const [exampleBodyBox, exampleDetailBox] = await Promise.all([exampleBody.boundingBox(), exampleDetail.boundingBox()])
  expect(exampleDetailBox!.y - exampleBodyBox!.y).toBeLessThan(100)

  await page.setViewportSize({ width: 560, height: 700 })
  const narrowExampleGeometry = await page.evaluate(() => {
    const pageRoot = document.querySelector<HTMLElement>('[data-workbench-page="examples"]')!
    const pageBody = pageRoot.querySelector<HTMLElement>('[data-page-scroll]')!
    const detail = pageRoot.querySelector<HTMLElement>('[aria-label$=" preview"]')!
    return {
      detailOffset: detail.getBoundingClientRect().top - pageBody.getBoundingClientRect().top,
      pageOverflow: pageRoot.scrollWidth - pageRoot.clientWidth,
    }
  })
  expect(narrowExampleGeometry.detailOffset).toBeLessThan(100)
  expect(narrowExampleGeometry.pageOverflow).toBe(0)

  await page.setViewportSize({ width: 1024, height: 700 })
  await page.getByRole('button', { name: 'Documentation', exact: true }).click()
  const results = page.getByRole('listbox', { name: 'Documentation results' }).getByRole('option')
  const lastResult = results.last()
  await lastResult.scrollIntoViewIfNeeded()
  await lastResult.focus()
  await expect(lastResult).toBeFocused()
  await results.first().click()

  const documentationBody = page.locator('[data-workbench-page="documentation"] [data-page-scroll]')
  const article = page.getByRole('article')
  const [documentationBodyBox, articleBox] = await Promise.all([documentationBody.boundingBox(), article.boundingBox()])
  expect(articleBox!.y - documentationBodyBox!.y).toBeLessThan(100)
  expect(
    await page.getByTestId('documentation-navigation').evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe('auto')
  expect(await article.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')

  await page.setViewportSize({ width: 560, height: 700 })
  await expect(page.getByRole('button', { name: 'Back to Results' })).toBeVisible()
  const narrowGeometry = await page.evaluate(() => {
    const pageRoot = document.querySelector<HTMLElement>('[data-workbench-page="documentation"]')!
    const pageBody = pageRoot.querySelector<HTMLElement>('[data-page-scroll]')!
    const detail = pageRoot.querySelector<HTMLElement>('article')!
    return {
      detailOffset: detail.getBoundingClientRect().top - pageBody.getBoundingClientRect().top,
      pageOverflow: pageRoot.scrollWidth - pageRoot.clientWidth,
      pageBodyOverflow: getComputedStyle(pageBody).overflowY,
      detailOverflow: getComputedStyle(detail).overflowY,
    }
  })
  expect(narrowGeometry.detailOffset).toBeLessThan(100)
  expect(narrowGeometry.pageOverflow).toBe(0)
  expect(narrowGeometry.pageBodyOverflow).toBe('auto')
  expect(narrowGeometry.detailOverflow).toBe('visible')

  await page.getByRole('button', { name: 'Back to Results' }).click()
  await lastResult.scrollIntoViewIfNeeded()
  await lastResult.focus()
  await expect(lastResult).toBeFocused()
})

test('active Example page owns pointer hit testing after long authoring and page navigation', async ({ page }) => {
  await openSeededPair(page)
  await page.setViewportSize({ width: 1024, height: 700 })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Workflow Contracts' }).click()
  await page.getByRole('button', { name: 'Documentation', exact: true }).click()
  await page.setViewportSize({ width: 512, height: 350 })
  await page.getByRole('button', { name: 'Examples', exact: true }).click()

  const createCopy = page.getByRole('button', { name: /^Create Editable Copy:/ }).first()
  await createCopy.scrollIntoViewIfNeeded()
  const hitTarget = await createCopy.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return (
      document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.closest('button') ===
      element
    )
  })
  expect(hitTarget).toBe(true)

  const before = (await e2eSnapshot(page)).workspacePaths
  await createCopy.click()
  await expect.poll(async () => (await e2eSnapshot(page)).workspacePaths).not.toEqual(before)
})

test('Documentation moves keyboard focus into narrow detail and restores the result', async ({ page }) => {
  await openSeededPair(page)
  await page.setViewportSize({ width: 560, height: 700 })
  await page.getByRole('button', { name: 'Documentation', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search documentation' })
  await search.fill('Workflow definition')
  await search.focus()
  const resultId = await search.getAttribute('aria-activedescendant')

  await search.press('Enter')

  const back = page.getByRole('button', { name: 'Back to Results' })
  await expect(back).toBeFocused()
  await back.press('Enter')
  await expect(page.locator(`[id="${resultId}"]`)).toBeFocused()
})

test('Git is a contained full-workbench page and falls back to unified diff when narrow', async ({ page }) => {
  await openSeededPair(page, '?scenario=long-git')
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.getByRole('button', { name: 'Git', exact: true }).click()

  const gitPage = page.locator('[data-workbench-page="git"]')
  const gitPageBody = gitPage.locator('[data-page-scroll]')
  await expect(gitPage).toBeVisible()
  await expect(page.locator('.left-panel .git-view')).toHaveCount(0)
  await expect(gitPage.locator('.repository-root')).toContainText(/C:\\workspaces\\release/)
  const renamedPairPath = gitPage.getByText(
    /release-demo-with-an-exceptionally-long-name\.yaml → workflows\/release-demo\.yaml/i,
  )
  await expect(renamedPairPath).toBeVisible()
  await expect(renamedPairPath).toHaveCSS('overflow-wrap', 'anywhere')
  await expect(
    page.getByRole('button', { name: /Document the exceptionally long Windows release workflow subject/ }),
  ).toBeVisible()
  expect(await gitPageBody.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)

  await page.getByRole('button', { name: 'Side-by-side diff' }).click()
  const sideBySideCells = page.getByRole('table', { name: 'Working tree side-by-side diff' }).getByRole('columnheader')
  await expect(sideBySideCells).toHaveCount(2)
  for (const cell of await sideBySideCells.all()) {
    expect((await cell.boundingBox())?.width).toBeGreaterThanOrEqual(360)
  }

  await page.setViewportSize({ width: 560, height: 700 })
  await page.getByRole('button', { name: 'Side-by-side diff' }).click()
  await expect(page.getByRole('button', { name: 'Unified diff' })).toHaveAttribute('aria-pressed', 'true')
  await expect(gitPage.getByRole('status')).toContainText('Side-by-side diff needs more horizontal space')
  expect(await gitPageBody.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
})

test('Git contains an adversarial unbroken repository ref', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/?scenario=unbroken-git-ref')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Git', exact: true }).click()

  const gitPage = page.locator('[data-workbench-page="git"]')
  const repositoryRef = gitPage.getByText(/^Branch: r{200}$/)
  await expect(repositoryRef).toBeVisible()
  await expect(repositoryRef).toHaveCSS('min-width', '0px')
  await expect(repositoryRef).toHaveCSS('overflow-wrap', 'anywhere')
  expect(
    await gitPage.locator('[data-page-scroll]').evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBe(0)
})
