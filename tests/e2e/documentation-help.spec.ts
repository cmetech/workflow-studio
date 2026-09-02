import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectExactWorkbenchGeometry, openSeededPair } from './support'

const platformModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function openDocumentation(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Documentation', exact: true }).click()
  const documentation = page.getByRole('region', { name: 'Offline documentation' })
  await expect(documentation).toBeVisible()
  return documentation
}

async function openSeededPairFromCompactWorkbench(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
}

async function assertReachable(locator: Locator, viewportHeight: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeVisible()
  const bounds = await locator.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewportHeight)
}

test('documentation, repeated reference fields, shortcut help, and session state remain available offline', async ({
  page,
}) => {
  await openSeededPair(page)
  const documentation = await openDocumentation(page)

  await expect(documentation.getByRole('heading', { name: 'Start here' })).toBeVisible()
  await expect(documentation.getByText('Context', { exact: true })).toHaveCount(0)

  const quickStart = documentation.getByRole('button', { name: 'Quick Start', exact: true })
  await quickStart.click()
  await expect(documentation.getByRole('article', { name: 'Quick Start' })).toBeVisible()
  await documentation.getByRole('button', { name: 'Back to Results' }).click()
  await expect(quickStart).toBeFocused()

  await documentation.getByRole('tab', { name: 'Reference' }).click()
  const commonSettings = documentation.getByRole('button', { name: 'Common node settings, reference group' })
  await expect(commonSettings).toHaveAttribute('aria-expanded', 'true')
  const contextGroup = documentation.getByRole('button', { name: 'Context, used by 7 node types' })
  await contextGroup.click()
  await documentation.getByRole('button', { name: 'Context, Prompt node' }).click()
  const promptArticle = documentation.getByRole('article', { name: 'Context' })
  await expect(promptArticle.getByRole('navigation', { name: 'Documentation breadcrumb' })).toContainText(
    'Common node settings',
  )
  await expect(promptArticle.getByRole('definition').filter({ hasText: /^Prompt$/ })).toBeVisible()

  await documentation.getByRole('button', { name: 'Back to Results' }).click()
  const documentationSearch = documentation.getByRole('searchbox', { name: 'Search documentation' })
  await documentationSearch.fill('context bash')
  await expect(documentation.getByRole('status')).toHaveText('1 result for “context bash”.')
  await documentation.getByRole('button', { name: 'Context, Bash node' }).click()
  const bashArticle = documentation.getByRole('article', { name: 'Context' })
  await expect(bashArticle.getByRole('navigation', { name: 'Documentation breadcrumb' })).toContainText(
    'Common node settings',
  )
  await expect(bashArticle.getByRole('definition').filter({ hasText: /^Bash$/ })).toBeVisible()

  await documentation.getByRole('button', { name: 'Back to Results' }).click()
  await documentationSearch.fill('')
  await documentation.getByRole('tab', { name: 'Overview' }).click()
  await documentation.getByRole('button', { name: /Work faster with keyboard shortcuts/i }).click()
  const shortcutArticle = documentation.getByRole('article', { name: 'Keyboard shortcuts' })
  await expect(shortcutArticle.getByText('Save Workflow Pair', { exact: true })).toBeVisible()
  await expect(shortcutArticle.getByText('Space + drag', { exact: true })).toBeVisible()
  await expect(shortcutArticle.getByText('N C', { exact: true })).toBeVisible()

  const shortcutSearch = shortcutArticle.getByRole('searchbox', { name: 'Search keyboard shortcuts' })
  await shortcutSearch.focus()
  await page.keyboard.press(`${platformModifier}+/`)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Space + drag', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(shortcutSearch).toBeFocused()

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await expect(page.locator('[data-workbench-page="examples"]')).toBeVisible()
  await page.getByRole('button', { name: 'Documentation', exact: true }).click()
  await expect(shortcutArticle).toBeVisible()

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === new URL(page.url()).origin) void route.continue()
    else void route.abort('blockedbyclient')
  })
  await shortcutArticle.getByRole('button', { name: 'Back to Results' }).click()
  await documentation.getByRole('button', { name: 'Quick Start', exact: true }).click()
  await expect(documentation.getByRole('article', { name: 'Quick Start' })).toBeVisible()
  await documentation.getByRole('button', { name: 'Back to Results' }).click()
  await documentation.getByRole('tab', { name: 'Reference' }).click()
  await expect(commonSettings).toBeVisible()
})

for (const viewport of [
  { width: 1024, height: 700, label: '1024x700' },
  { width: 512, height: 350, label: 'effective 200% (512x350 CSS viewport)' },
]) {
  test(`documentation controls and scrolling remain contained at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openSeededPairFromCompactWorkbench(page)
    const documentation = await openDocumentation(page)

    for (const name of ['Overview', 'Guides', 'Reference'])
      await assertReachable(documentation.getByRole('tab', { name }), viewport.height)
    await expectExactWorkbenchGeometry(page)

    await documentation.getByRole('button', { name: 'Quick Start', exact: true }).click()
    const back = documentation.getByRole('button', { name: 'Back to Results' })
    await assertReachable(back, viewport.height)
    const containedScroller = await page.locator('[data-workbench-page="documentation"]').evaluate((activity) => {
      const candidates = [
        activity.querySelector<HTMLElement>('[data-page-scroll]'),
        activity.querySelector<HTMLElement>('[data-testid="documentation-navigation"]'),
        activity.querySelector<HTMLElement>('article'),
      ].filter((candidate): candidate is HTMLElement => candidate !== null)
      return candidates.some((candidate) => {
        const overflow = getComputedStyle(candidate).overflowY
        return /auto|scroll/.test(overflow) && candidate.scrollHeight > candidate.clientHeight
      })
    })
    expect(containedScroller).toBe(true)
    await expectExactWorkbenchGeometry(page)

    await back.click()
    for (const name of ['Overview', 'Guides', 'Reference'])
      await assertReachable(documentation.getByRole('tab', { name }), viewport.height)
    await expectExactWorkbenchGeometry(page)
  })
}

test('forced colors preserve selected, expanded, and focused documentation states', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await openSeededPair(page)
  const documentation = await openDocumentation(page)
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)

  const overview = documentation.getByRole('tab', { name: 'Overview' })
  await expect(overview).toHaveAttribute('aria-selected', 'true')
  expect(
    await overview.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.borderStyle !== 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    }),
  ).toBe(true)

  await documentation.getByRole('tab', { name: 'Reference' }).click()
  const commonSettings = documentation.getByRole('button', { name: 'Common node settings, reference group' })
  await expect(commonSettings).toHaveAttribute('aria-expanded', 'true')
  expect(await commonSettings.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px')

  const context = documentation.getByRole('button', { name: 'Context, used by 7 node types' })
  await context.focus()
  expect(await context.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe('0px')
  expect(await context.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s')
})
