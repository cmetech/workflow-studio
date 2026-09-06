import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair } from './support'

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
