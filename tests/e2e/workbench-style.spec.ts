import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSeededPair } from './support'

async function styleSignature(locator: Locator): Promise<{ background: string; border: string; color: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, border: style.borderColor, color: style.color }
  })
}

async function interactionSignatures(page: Page, locator: Locator) {
  const resting = await styleSignature(locator)
  await locator.hover()
  const hovered = await styleSignature(locator)
  await page.mouse.down()
  await expect.poll(() => locator.evaluate((element) => element.matches(':active'))).toBe(true)
  const active = await styleSignature(locator)
  await page.mouse.move(0, 0)
  await page.mouse.up()
  return { resting, hovered, active }
}

async function expectMono(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  const family = await locator.evaluate((element) => getComputedStyle(element).fontFamily)
  expect(family).toContain('Geist Mono Variable')
}

test('renders YAML, shortcuts, code fields, and technical metadata with bundled Geist Mono', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('group', { name: 'command node publish', exact: true }).click()

  const inspector = page.getByRole('region', { name: 'Workflow inspector' })
  await expectMono(inspector.locator('textarea.code'))
  await expectMono(page.locator('.status-bar'))

  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  await expectMono(page.locator('[aria-label="Definition YAML"] .cm-scroller'))

  await page.keyboard.press('F1')
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Keyboard Shortcuts')
  await page.keyboard.press('Enter')
  await expectMono(page.getByRole('dialog', { name: 'Keyboard shortcuts' }).locator('kbd').first())
})

for (const colorScheme of ['dark', 'light'] as const) {
  test(`exposes distinct enabled control hover and pressed states in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openSeededPair(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)

    const controls = [
      page.getByRole('button', { name: 'New Workflow' }).first(),
      page.getByRole('button', { name: 'Open Folder' }).first(),
      page.getByRole('button', { name: 'Visual', exact: true }),
      page.getByRole('button', { name: 'Add Node', exact: true }),
    ]
    await expect(controls[0]!).toHaveAttribute('data-variant', 'primary')
    await expect(controls[1]!).toHaveAttribute('data-variant', 'secondary')
    await expect(controls[2]!).toHaveAttribute('data-variant', 'ghost')
    await expect(controls[3]!).toHaveAttribute('data-variant', 'secondary')

    for (const control of controls) {
      const states = await interactionSignatures(page, control)
      expect(states.hovered).not.toEqual(states.resting)
      expect(states.active).not.toEqual(states.hovered)
    }

    await page.getByRole('group', { name: 'command node publish', exact: true }).click()
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    const danger = page.getByRole('menuitem', { name: 'Delete Selection' })
    await expect(danger).toHaveAttribute('data-variant', 'danger')
    const dangerStates = await interactionSignatures(page, danger)
    expect(dangerStates.hovered).not.toEqual(dangerStates.resting)
    expect(dangerStates.active).not.toEqual(dangerStates.hovered)
  })
}
