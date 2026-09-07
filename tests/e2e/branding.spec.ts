import { expect, test, type Locator } from '@playwright/test'
import { e2eSnapshot, openSeededPair } from './support'

async function paintedContrast(element: Locator): Promise<number> {
  return element.evaluate((target) => {
    const parse = (value: string): readonly number[] =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => Number(channel))
    const luminance = (value: string): number => {
      const channels = parse(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const style = getComputedStyle(target)
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
}

async function paintedContrastPair(foreground: Locator, surface: Locator): Promise<number> {
  const [foregroundColor, backgroundColor] = await Promise.all([
    foreground.evaluate((target) => getComputedStyle(target).color),
    surface.evaluate((target) => getComputedStyle(target).backgroundColor),
  ])
  const luminance = (value: string): number => {
    const channels = (value.match(/[\d.]+/g) ?? [])
      .slice(0, 3)
      .map((channel) => Number(channel) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const foregroundLuminance = luminance(foregroundColor)
  const backgroundLuminance = luminance(backgroundColor)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

async function expectPaintedContrast(element: Locator, minimum = 4.5): Promise<void> {
  await expect.poll(() => paintedContrast(element)).toBeGreaterThanOrEqual(minimum)
}

async function expectPaintedContrastPair(foreground: Locator, surface: Locator, minimum = 4.5): Promise<void> {
  await expect.poll(() => paintedContrastPair(foreground, surface)).toBeGreaterThanOrEqual(minimum)
}

test('keeps a malicious brand inspectable but inactive, then previews and activates a valid pack', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByText('Advanced brand packs', { exact: true }).click()

  await page.getByRole('button', { name: 'Import brand pack' }).click()
  await expect(page.getByRole('list', { name: 'Rejected brand pack reports' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Preview Rejected brand pack/i })).toHaveCount(0)

  await page.getByRole('button', { name: 'Import brand pack' }).click()
  await page.getByRole('button', { name: 'Preview Northstar Studio' }).click()
  const preview = page.getByRole('dialog', { name: 'Preview Northstar Studio' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Activate Northstar Studio' }).click()
  await expect.poll(async () => (await e2eSnapshot(page)).activeBrandId).toBe('northstar')
  await expect(page.locator('.brand-lockup img')).toHaveAttribute('src', /^blob:/)
  await expect(page.locator('.brand-lockup [data-loop24-mark]')).toHaveCount(0)
})

test('applies and persists brightness, palette, and a custom accent through the built-in mark', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('radio', { name: 'Light' }).click()
  await page.getByRole('radio', { name: 'Ocean Blue' }).click()

  await page.getByRole('button', { name: 'Choose custom accent' }).click()
  await page.getByRole('textbox', { name: 'Hex accent' }).fill('#FAD22D')
  await page.getByRole('button', { name: 'Apply accent' }).click()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement
        const tile = document.querySelector<SVGElement>('[data-loop24-tile]')
        const glyph = document.querySelector<SVGElement>('[data-loop24-glyph]')
        if (!tile || !glyph) throw new Error('Expected the built-in LOOP24 mark.')
        return {
          accent: root.style.getPropertyValue('--color-accent'),
          tile: getComputedStyle(tile).fill,
          glyph: getComputedStyle(glyph).fill,
        }
      }),
    )
    .toEqual({ accent: '#FAD22D', tile: 'rgb(0, 0, 0)', glyph: 'rgb(250, 210, 45)' })

  await page.reload()
  await expect(page.locator('[data-loop24-mark]').first()).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => ({
        accent: document.documentElement.style.getPropertyValue('--color-accent'),
        preferences: JSON.parse(localStorage.getItem('workflow-studio.appearance.v1') ?? '{}'),
      })),
    )
    .toEqual({
      accent: '#FAD22D',
      preferences: { mode: 'light', colorTheme: 'ocean-blue', customAccent: '#FAD22D' },
    })
})

test('keeps semantic canvas selection readable when the chosen accent matches the canvas', async ({ page }) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('radio', { name: 'Light' }).click()
  await page.getByRole('button', { name: 'Choose custom accent' }).click()
  await page.getByRole('textbox', { name: 'Hex accent' }).fill('#FFFFFF')
  await page.getByRole('button', { name: 'Apply accent' }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--color-accent')))
    .toBe('#FFFFFF')

  await page.getByRole('button', { name: 'Choose custom accent' }).click()
  const themedApply = page.getByRole('button', { name: 'Apply accent' })
  await expectPaintedContrast(themedApply)
  await themedApply.hover()
  await expectPaintedContrast(themedApply)
  await page.mouse.down()
  await expectPaintedContrast(themedApply)
  await page.mouse.move(0, 0)
  await page.mouse.up()
  await page.keyboard.press('Escape')

  await expectPaintedContrast(page.getByRole('tab', { name: 'Appearance' }))
  await expectPaintedContrast(page.locator('.activity-rail button[data-activity="settings"]'))
  await page.getByRole('button', { name: 'Back to Workflow' }).click()

  await expectPaintedContrast(page.locator('.activity-rail button[data-activity="explorer"]'))
  const visualTab = page.locator('.editor-tabs button.active').filter({ hasText: 'Visual' })
  await expectPaintedContrast(visualTab)
  await visualTab.hover()
  await expectPaintedContrast(visualTab)
  await page.mouse.down()
  await expectPaintedContrast(visualTab)
  await page.mouse.move(0, 0)
  await page.mouse.up()
  await expectPaintedContrast(page.getByRole('treeitem', { selected: true }))

  const node = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const nodeSurface = page.locator('.workflow-node[data-node-id="prepare"]')
  const nodeKind = nodeSurface.locator('.kind')
  await expectPaintedContrastPair(nodeKind, nodeSurface)

  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })
  const selectedPath = dependency.locator('path.workflow-edge')
  await dependency.focus()
  await dependency.press('Enter')
  await expect(selectedPath).toHaveClass(/selected/)

  await node.focus()
  await expect(selectedPath).toHaveClass(/selected/)
  await expectPaintedContrastPair(nodeKind, nodeSurface)

  const contrast = await page.evaluate(() => {
    const parse = (value: string): readonly number[] =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => Number(channel))
    const luminance = (value: string): number => {
      const channels = parse(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const ratio = (first: string, second: string): number => {
      const lighter = Math.max(luminance(first), luminance(second))
      const darker = Math.min(luminance(first), luminance(second))
      return (lighter + 0.05) / (darker + 0.05)
    }
    const path = document.querySelector<SVGPathElement>('path.workflow-edge.selected')
    const nodeKind = document.querySelector<HTMLElement>('.workflow-node[data-node-id="prepare"] .kind')
    const nodeBody = document.querySelector<HTMLElement>('.workflow-node[data-node-id="prepare"]')
    const canvas = document.querySelector<HTMLElement>('.graph-canvas')
    if (!path || !nodeKind || !nodeBody || !canvas) throw new Error('Expected painted canvas consumers.')
    return {
      accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
      selectedEdge: ratio(getComputedStyle(path).stroke, getComputedStyle(canvas).backgroundColor),
      nodeKind: ratio(getComputedStyle(nodeKind).color, getComputedStyle(nodeBody).backgroundColor),
    }
  })

  expect(contrast.accent).toBe('#FFFFFF')
  expect(contrast.selectedEdge).toBeGreaterThanOrEqual(3)
  expect(contrast.nodeKind).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  const definitionTab = page.getByRole('tab', { name: 'Definition YAML' })
  await expectPaintedContrast(definitionTab)
  await definitionTab.hover()
  await expectPaintedContrast(definitionTab)
  await page.mouse.down()
  await expectPaintedContrast(definitionTab)
  await page.mouse.up()
})
