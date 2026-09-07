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
        },
      },
    }

    applyAppearanceTheme(brand, 'light', 'loop24-indigo', null, root)

    expect(root.style.getPropertyValue('--color-accent')).toBe('#AABBCC')
    expect(root.style.getPropertyValue('--color-accent-strong')).toBe('#112233')
    expect(root.style.getPropertyValue('--color-node-selected')).toBe('#445566')
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
    expect(root.style.getPropertyValue('--color-accent')).toBe('#FFFFFF')
    expect(contrastRatio(focus, '#B6B6B6')).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(focus, '#000000')).toBeGreaterThanOrEqual(3)
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
