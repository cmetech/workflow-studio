import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import { loadBundledBrand } from './load-brand'
import { contrastRatio, validateBrandPack } from './validate-theme'
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceTheme,
  loadAppearancePreferences,
  normalizeAccent,
  saveAppearancePreferences,
  toNativeColorValue,
} from './appearance'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')

function validatedImportedBrand(themeOverrides: Record<string, string>) {
  const source = structuredClone(loadBundledBrand()) as unknown as {
    id: string
    displayName: string
    themes: { dark: Record<string, string> }
  }
  source.id = 'transparent-surfaces'
  source.displayName = 'Transparent Surfaces'
  Object.assign(source.themes.dark, themeOverrides)
  const validated = validateBrandPack(stringify(source), {
    'logo.svg': SVG_BYTES,
    'mark.svg': SVG_BYTES,
  })
  expect(validated.canActivate).toBe(true)
  return validated.manifest
}

describe('appearance preferences', () => {
  it.each([
    ['#32c48d', '#32C48D'],
    ['32c48d', '#32C48D'],
    ['#123', null],
    ['rgb(1, 2, 3)', null],
  ])('normalizes the six-digit hexadecimal accent %s', (input, expected) => {
    expect(normalizeAccent(input)).toBe(expected)
  })

  it.each([
    ['#abc', '#AABBCC'],
    ['#abcd', '#AABBCC'],
    ['#12345678', '#123456'],
    ['rgb(17, 34, 51)', '#112233'],
    ['rgba(17, 34, 51, 0.5)', '#112233'],
    ['rgb(100% 0% 50% / 50%)', '#FF0080'],
    ['transparent', '#000000'],
  ])('converts the brand fallback %s for a native color input', (input, expected) => {
    expect(toNativeColorValue(input)).toBe(expected)
  })

  it('applies the selected palette after the active brand theme', () => {
    const root = document.createElement('div')

    applyAppearanceTheme(loadBundledBrand(), 'light', 'ocean-blue', null, root)

    expect(root.dataset.brand).toBe('loop24')
    expect(root.dataset.theme).toBe('light')
    expect(root.style.getPropertyValue('--color-accent')).toBe('#0B6BCB')
    expect(root.style.getPropertyValue('--color-accent-contrast')).toBe('#FFFFFF')
    expect(root.style.getPropertyValue('--color-accent-strong')).not.toBe('#0B6BCB')
    expect(root.style.getPropertyValue('--color-node-selected')).not.toBe('#0B6BCB')
  })

  it('leaves the active brand accents intact for the default palette', () => {
    const root = document.createElement('div')
    const bundled = loadBundledBrand()
    const brand = {
      ...bundled,
      themes: {
        ...bundled.themes,
        light: {
          ...bundled.themes.light,
          accent: '#AABBCC',
          'accent-strong': '#112233',
          'node-selected': '#445566',
          'edge-selected': '#223344',
        },
      },
    }

    applyAppearanceTheme(brand, 'light', 'loop24-indigo', null, root)

    expect(root.style.getPropertyValue('--color-accent')).toBe('#AABBCC')
    expect(root.style.getPropertyValue('--color-accent-strong')).toBe('#112233')
    expect(root.style.getPropertyValue('--color-node-selected')).toBe('#445566')
    expect(root.style.getPropertyValue('--color-edge-selected')).toBe('#223344')
  })

  it('uses WCAG luminance to choose custom-accent contrast', () => {
    const root = document.createElement('div')
    const brand = loadBundledBrand()

    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)
    expect(root.style.getPropertyValue('--color-accent-contrast')).toBe('#000000')

    applyAppearanceTheme(brand, 'dark', 'emerald', '#000000', root)
    expect(root.style.getPropertyValue('--color-accent-contrast')).toBe('#FFFFFF')
  })

  it.each([
    ['light', '#FFFFFF'],
    ['dark', '#000000'],
  ] as const)(
    'derives readable semantic canvas and primary-control colors in %s mode for the %s preference',
    (mode, customAccent) => {
      const root = document.createElement('div')
      const brand = loadBundledBrand()

      applyAppearanceTheme(brand, mode, 'ocean-blue', customAccent, root)

      const token = (name: string) => root.style.getPropertyValue(name)
      const theme = brand.themes[mode]
      expect(token('--color-accent')).toBe(customAccent)
      expect(contrastRatio(token('--color-edge-selected'), theme.canvas)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(token('--color-node-kind'), theme.node)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(token('--color-node-kind-selected'), token('--color-node-selected'))).toBeGreaterThanOrEqual(
        4.5,
      )
      for (const surface of ['page', 'panel', 'rail']) {
        expect(
          contrastRatio(token(`--color-selection-${surface}-foreground`), token(`--color-selection-${surface}`)),
        ).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(token('--color-accent-on-background'), theme.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(token('--color-accent-on-surface'), theme.surface)).toBeGreaterThanOrEqual(4.5)
      for (const [backgroundToken, foregroundToken] of [
        ['--color-primary', '--color-primary-contrast'],
        ['--color-primary-hover', '--color-primary-hover-contrast'],
        ['--color-primary-active', '--color-primary-active-contrast'],
      ] as const) {
        expect(contrastRatio(token(foregroundToken), token(backgroundToken))).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it('derives independent 4.5:1 node-kind foregrounds for incompatible imported node surfaces', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#000000',
      'surface-elevated': '#000000',
      text: '#FFFFFF',
      accent: '#FFFFFF',
      'accent-contrast': '#000000',
      'accent-strong': '#777777',
      canvas: '#000000',
      node: '#434343',
      'node-selected': '#B1B1B1',
      'edge-selected': '#777777',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'loop24-indigo', null, root)

    const normal = root.style.getPropertyValue('--color-node-kind')
    const selected = root.style.getPropertyValue('--color-node-kind-selected')
    expect(normal).not.toBe(selected)
    expect(contrastRatio(normal, '#434343')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(selected, '#B1B1B1')).toBeGreaterThanOrEqual(4.5)
  })

  it('derives semantic accent foregrounds from each composited consumer surface', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#FFFFFF',
      surface: 'rgba(0, 0, 0, 0.2)',
      'surface-elevated': 'rgba(0, 0, 0, 0.2)',
      text: '#000000',
      accent: '#000000',
      'accent-strong': 'rgba(0, 0, 0, 0.2)',
      'accent-contrast': '#FFFFFF',
      focus: '#000000',
      error: '#000000',
      canvas: '#FFFFFF',
      node: 'rgba(0, 0, 0, 0.2)',
      'node-selected': 'rgba(0, 0, 0, 0.2)',
      'edge-selected': '#000000',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'loop24-indigo', null, root)

    expect(
      contrastRatio(root.style.getPropertyValue('--color-accent-on-background'), '#FFFFFF'),
    ).toBeGreaterThanOrEqual(4.5)
    for (const token of ['--color-accent-on-surface', '--color-accent-strong-on-surface']) {
      expect(contrastRatio(root.style.getPropertyValue(token), '#CCCCCC')).toBeGreaterThanOrEqual(4.5)
    }
    for (const [surface, expectedBackground] of [
      ['page', '#CCCCCC'],
      ['panel', '#A3A3A3'],
      ['rail', '#000000'],
    ] as const) {
      const background = root.style.getPropertyValue(`--color-selection-${surface}`)
      expect(background).toBe(expectedBackground)
      expect(
        contrastRatio(root.style.getPropertyValue(`--color-selection-${surface}-foreground`), background),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['light', '#FFFFFF', '#000000'],
    ['light', '#F5F7FB', '#000000'],
    ['light', '#000000', '#000000'],
    ['dark', '#000000', '#FFFFFF'],
    ['dark', '#11141C', '#FFFFFF'],
    ['dark', '#FFFFFF', '#FFFFFF'],
  ] as const)('keeps focus visible in %s mode when the requested accent is %s', (mode, customAccent, expectedFocus) => {
    const root = document.createElement('div')

    applyAppearanceTheme(loadBundledBrand(), mode, 'ocean-blue', customAccent, root)

    expect(root.style.getPropertyValue('--color-accent')).toBe(customAccent)
    expect(root.style.getPropertyValue('--color-focus')).toBe(expectedFocus)
  })

  it.each([
    ['light', 'ocean-blue', '#0B6BCB'],
    ['light', 'emerald', '#087A55'],
    ['dark', 'ocean-blue', '#5BA8FF'],
    ['dark', 'emerald', '#32C48D'],
  ] as const)('keeps the safe %s %s palette accent as its focus color', (mode, colorTheme, expectedFocus) => {
    const root = document.createElement('div')

    applyAppearanceTheme(loadBundledBrand(), mode, colorTheme, null, root)

    expect(root.style.getPropertyValue('--color-focus')).toBe(expectedFocus)
  })

  it.each([
    ['light', '#5145CD'],
    ['dark', '#5BA8FF'],
  ] as const)('keeps a safe custom accent unchanged for focus in %s mode', (mode, accent) => {
    const root = document.createElement('div')

    applyAppearanceTheme(loadBundledBrand(), mode, 'emerald', accent, root)

    expect(root.style.getPropertyValue('--color-accent')).toBe(accent)
    expect(root.style.getPropertyValue('--color-focus')).toBe(accent)
  })

  it.each([
    ['transparent hex', '#FFFFFF00', '#000000'],
    ['translucent rgba', 'rgba(255, 255, 255, 0.1)', '#1A1A1A'],
  ])('composites an imported %s focus surface against its semantic backdrop', (_case, surface, effectiveSurface) => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#000000',
      'surface-elevated': surface,
      canvas: '#000000',
      node: '#000000',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)

    const focus = root.style.getPropertyValue('--color-focus')
    expect(root.style.getPropertyValue('--color-accent')).toBe('#FFFFFF')
    expect(focus).toBe('#FFFFFF')
    expect(contrastRatio(focus, effectiveSurface)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(focus, '#000000')).toBeGreaterThanOrEqual(3)
  })

  it('models the final CodeMirror surface through both translucent editor wrappers', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#FFFFFF66',
      'surface-elevated': '#FFFFFF33',
      text: '#767676',
      canvas: '#000000',
      node: '#000000',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)

    const focus = root.style.getPropertyValue('--color-focus')
    const focusContrast = root.style.getPropertyValue('--color-focus-contrast')
    expect(root.style.getPropertyValue('--color-accent')).toBe('#FFFFFF')
    expect(Math.min(contrastRatio(focus, '#B6B6B6'), contrastRatio(focus, '#000000'))).toBeLessThan(3)
    for (const host of ['#B6B6B6', '#000000']) {
      expect(Math.max(contrastRatio(focus, host), contrastRatio(focusContrast, host))).toBeGreaterThanOrEqual(3)
    }
  })

  it('selects a deterministic gray that clears 3:1 against mixed black and white focus hosts', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#000000',
      'surface-elevated': '#000000',
      canvas: '#000000',
      node: '#FFFFFF',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)
    const firstFocus = root.style.getPropertyValue('--color-focus')
    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)

    expect(root.style.getPropertyValue('--color-accent')).toBe('#FFFFFF')
    expect(root.style.getPropertyValue('--color-focus')).toBe(firstFocus)
    expect(firstFocus).not.toBe('#000000')
    expect(firstFocus).not.toBe('#FFFFFF')
    expect(contrastRatio(firstFocus, '#000000')).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(firstFocus, '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })

  it('uses deterministic max-min contrast when no focus color can clear 3:1 across every host', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#000000',
      'surface-elevated': '#000000',
      canvas: '#777777',
      node: '#FFFFFF',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)
    const firstFocus = root.style.getPropertyValue('--color-focus')
    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)
    const contrasts = ['#000000', '#777777', '#FFFFFF'].map((surface) => contrastRatio(firstFocus, surface))

    expect(root.style.getPropertyValue('--color-focus')).toBe(firstFocus)
    expect(Math.min(...contrasts)).toBeLessThan(3)
    expect(Math.min(...contrasts)).toBeGreaterThan(1)
  })

  it('publishes a two-tone focus pair for incompatible active-line and elevated toolbar hosts', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#000000',
      'surface-elevated': 'rgba(255, 255, 255, 0.65)',
      canvas: '#000000',
      node: '#FFFFFF',
      'yaml-gutter': '#000000',
    })

    applyAppearanceTheme(brand, 'dark', 'emerald', '#FFFFFF', root)

    const primary = root.style.getPropertyValue('--color-focus')
    const secondary = root.style.getPropertyValue('--color-focus-contrast')
    const activeLine = root.style.getPropertyValue('--color-node-selected')
    const toolbar = '#A6A6A6'

    expect(root.style.getPropertyValue('--color-accent')).toBe('#FFFFFF')
    expect(['#000000', '#FFFFFF']).toContain(secondary)
    expect(contrastRatio(primary, secondary)).toBeGreaterThanOrEqual(3)
    for (const host of [activeLine, toolbar]) {
      expect(Math.max(contrastRatio(primary, host), contrastRatio(secondary, host))).toBeGreaterThanOrEqual(3)
    }
  })

  it('derives the default imported focus pair against every modeled host surface', () => {
    const root = document.createElement('div')
    const brand = validatedImportedBrand({
      background: '#000000',
      surface: '#000000',
      'surface-elevated': '#333333',
      focus: '#777777',
      canvas: '#333333',
      node: '#000000',
      'yaml-gutter': '#333333',
    })

    applyAppearanceTheme(brand, 'dark', 'loop24-indigo', null, root)

    const primary = root.style.getPropertyValue('--color-focus')
    const secondary = root.style.getPropertyValue('--color-focus-contrast')
    for (const host of ['#000000', '#333333']) {
      expect(Math.max(contrastRatio(primary, host), contrastRatio(secondary, host))).toBeGreaterThanOrEqual(3)
    }
  })

  it('saves and loads one normalized preference record', () => {
    const storage = new MemoryStorage()

    saveAppearancePreferences(storage, {
      mode: 'dark',
      colorTheme: 'emerald',
      customAccent: '#123456',
    })

    expect(JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY)!)).toEqual({
      mode: 'dark',
      colorTheme: 'emerald',
      customAccent: '#123456',
    })
    expect(loadAppearancePreferences(storage)).toEqual({
      mode: 'dark',
      colorTheme: 'emerald',
      customAccent: '#123456',
    })
  })

  it.each([
    ['malformed JSON', '{'],
    ['unsupported mode', JSON.stringify({ mode: 'sepia', colorTheme: 'emerald', customAccent: null })],
    ['unsupported palette', JSON.stringify({ mode: 'dark', colorTheme: 'sunset', customAccent: null })],
    ['invalid accent', JSON.stringify({ mode: 'dark', colorTheme: 'emerald', customAccent: '#123' })],
  ])('returns the immutable default for %s', (_case, storedValue) => {
    const storage = new MemoryStorage()
    storage.setItem(APPEARANCE_STORAGE_KEY, storedValue)

    const preferences = loadAppearancePreferences(storage)

    expect(preferences).toEqual({
      mode: 'system',
      colorTheme: 'loop24-indigo',
      customAccent: null,
    })
    expect(Object.isFrozen(preferences)).toBe(true)
  })

  it('returns the immutable default when storage cannot be read', () => {
    const preferences = loadAppearancePreferences({
      getItem: () => {
        throw new Error('storage denied')
      },
    })

    expect(preferences).toEqual({
      mode: 'system',
      colorTheme: 'loop24-indigo',
      customAccent: null,
    })
    expect(Object.isFrozen(preferences)).toBe(true)
  })
})
