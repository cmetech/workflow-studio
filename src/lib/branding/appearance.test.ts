import { describe, expect, it } from 'vitest'
import { loadBundledBrand } from './load-brand'
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
