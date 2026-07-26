import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { activeBrand, themePreference } from '$src/stores/branding'
import { applyBrandTheme, loadBrandManifest, loadBundledBrand, REQUIRED_THEME_TOKENS } from './load-brand'

const ALLOWED_COLOR = /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i

describe('LOOP24 bundled brand', () => {
  it('loads the complete semantic token contract for light and dark modes', () => {
    const brand = loadBundledBrand()

    for (const mode of ['light', 'dark'] as const) {
      expect(Object.keys(brand.themes[mode]).sort()).toEqual([...REQUIRED_THEME_TOKENS].sort())
      for (const value of Object.values(brand.themes[mode])) {
        expect(value).toMatch(ALLOWED_COLOR)
      }
    }
  })

  it('uses the approved default identity and LOOP24 accent family', () => {
    const brand = loadBundledBrand()

    expect(brand.id).toBe('loop24')
    expect(brand.displayName).toBe('LOOP24 Workflow Studio')
    expect(brand.themes.dark.accent).toBe('#FAD22D')
    expect(brand.themes.dark['accent-contrast']).toBe('#0C0C0C')
  })

  it('keeps bundled assets relative and free of path traversal', () => {
    const brand = loadBundledBrand()

    for (const path of Object.values(brand.assets)) {
      expect(path).not.toMatch(/^(?:[a-z]+:|\/|\\)/i)
      expect(path.split(/[\\/]/)).not.toContain('..')
    }
  })

  it.each(['../outside.svg', '/absolute.svg', 'https://example.com/logo.svg'])(
    'rejects unsafe asset path %s',
    (path) => {
      const manifest = structuredClone(loadBundledBrand())
      manifest.assets.logo = path

      expect(() => loadBrandManifest(stringify(manifest))).toThrow(/asset path/i)
    },
  )

  it('rejects values that could inject CSS instead of a color', () => {
    const brand = loadBundledBrand()
    const manifest = {
      ...brand,
      themes: {
        ...brand.themes,
        dark: { ...brand.themes.dark, background: 'url(https://example.com/pixel)' },
      },
    }

    expect(() => loadBrandManifest(stringify(manifest))).toThrow(/color/i)
  })

  it('projects one selected theme to semantic CSS custom properties', () => {
    const root = document.createElement('div')
    const brand = loadBundledBrand()

    applyBrandTheme(brand, 'dark', root)

    expect(root.dataset.brand).toBe('loop24')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.getPropertyValue('--color-background')).toBe('#090A0D')
    expect(root.style.getPropertyValue('--color-node-selected')).toBe('#2B260D')
    expect(root.style.getPropertyValue('--color-yaml-gutter')).toBe('#0D0F14')
  })

  it('starts with only the active brand ID and system theme preference in shared state', () => {
    expect(activeBrand.get()).toBe('loop24')
    expect(themePreference.get()).toBe('system')
  })
})
