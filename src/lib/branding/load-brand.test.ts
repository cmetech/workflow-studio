import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { activeBrand, themePreference } from '$src/stores/branding'
import {
  applyBrandTheme,
  getBundledBrandAssetUrl,
  loadBrandManifest,
  loadBundledBrand,
  REQUIRED_THEME_TOKENS,
} from './load-brand'

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

  it('uses the approved LOOP24 identity with the modern operational palette', () => {
    const brand = loadBundledBrand()

    expect(brand.id).toBe('loop24')
    expect(brand.displayName).toBe('LOOP24 Workflow Studio')
    expect(brand.themes.dark).toMatchObject({
      background: '#0B0D12',
      accent: '#5B50E6',
      'accent-contrast': '#FFFFFF',
      'node-selected': '#252143',
      'edge-selected': '#8A80FF',
    })
    expect(brand.themes.light).toMatchObject({
      background: '#F5F7FB',
      accent: '#5145CD',
      'accent-contrast': '#FFFFFF',
      'node-selected': '#EFEDFF',
      'edge-selected': '#5145CD',
    })
  })

  it('keeps bundled assets relative and free of path traversal', () => {
    const brand = loadBundledBrand()

    for (const path of Object.values(brand.assets)) {
      expect(path).not.toMatch(/^(?:[a-z]+:|\/|\\)/i)
      expect(path.split(/[\\/]/)).not.toContain('..')
    }
  })

  it('resolves the asset path selected by the validated manifest', () => {
    const brand = structuredClone(loadBundledBrand())
    const logoUrl = getBundledBrandAssetUrl(brand, 'logo')
    brand.assets.mark = brand.assets.logo

    expect(logoUrl).toEqual(expect.any(String))
    expect(getBundledBrandAssetUrl(brand, 'mark')).toBe(logoUrl)
  })

  it('rejects a validated manifest path missing from bundled resources', () => {
    const brand = structuredClone(loadBundledBrand())
    brand.assets.mark = 'missing.svg'

    expect(() => getBundledBrandAssetUrl(brand, 'mark')).toThrow(
      'Bundled brand asset assets.mark (missing.svg) was not found',
    )
  })

  it.each(['constructor', 'toString', '__proto__'])('rejects inherited object key path %s', (path) => {
    const brand = structuredClone(loadBundledBrand())
    brand.assets.mark = path

    expect(() => getBundledBrandAssetUrl(brand, 'mark')).toThrow(
      `Bundled brand asset assets.mark (${path}) was not found`,
    )
  })

  it.each([
    '../outside.svg',
    '%2e%2e/outside.svg',
    'assets/%2E%2E/outside.svg',
    '%2e./outside.svg',
    '/absolute.svg',
    'https://example.com/logo.svg',
  ])('rejects unsafe asset path %s', (path) => {
    const manifest = structuredClone(loadBundledBrand())
    manifest.assets.logo = path

    expect(() => loadBrandManifest(stringify(manifest))).toThrow(/asset path/i)
  })

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
    expect(root.style.getPropertyValue('--color-background')).toBe('#0B0D12')
    expect(root.style.getPropertyValue('--color-node-selected')).toBe('#252143')
    expect(root.style.getPropertyValue('--color-yaml-gutter')).toBe('#0E1118')
  })

  it('starts with only the active brand ID and system theme preference in shared state', () => {
    expect(activeBrand.get()).toBe('loop24')
    expect(themePreference.get()).toBe('system')
  })
})
