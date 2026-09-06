import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_STORAGE_KEY } from '$src/lib/branding/appearance'
import {
  colorTheme,
  customAccent,
  initializeAppearancePreferences,
  resetAccent,
  setColorTheme,
  setCustomAccent,
  setThemePreference,
  themePreference,
} from './branding'

class TrackingStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null
  writes = 0

  constructor(value: string | null = null) {
    this.value = value
  }

  getItem(key: string): string | null {
    return key === APPEARANCE_STORAGE_KEY ? this.value : null
  }

  setItem(key: string, value: string): void {
    if (key !== APPEARANCE_STORAGE_KEY) return
    this.value = value
    this.writes += 1
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  initializeAppearancePreferences(new TrackingStorage())
})

describe('appearance store', () => {
  it('loads and normalizes persisted preferences during initialization', () => {
    const storage = new TrackingStorage(
      JSON.stringify({ mode: 'dark', colorTheme: 'emerald', customAccent: '#32c48d' }),
    )

    initializeAppearancePreferences(storage)

    expect(themePreference.get()).toBe('dark')
    expect(colorTheme.get()).toBe('emerald')
    expect(customAccent.get()).toBe('#32C48D')
    expect(storage.writes).toBe(1)
    expect(JSON.parse(storage.value!)).toEqual({
      mode: 'dark',
      colorTheme: 'emerald',
      customAccent: '#32C48D',
    })
  })

  it('persists one normalized record after every setter', () => {
    const storage = new TrackingStorage()
    initializeAppearancePreferences(storage)

    setThemePreference('light')
    setColorTheme('emerald')
    setCustomAccent('#32c48d')

    expect(storage.writes).toBe(4)
    expect(JSON.parse(storage.value!)).toEqual({
      mode: 'light',
      colorTheme: 'emerald',
      customAccent: '#32C48D',
    })
  })

  it('clears an explicit accent when the selected palette changes', () => {
    const storage = new TrackingStorage()
    initializeAppearancePreferences(storage)
    setCustomAccent('#123456')

    setColorTheme('ocean-blue')

    expect(customAccent.get()).toBeNull()
    expect(JSON.parse(storage.value!)).toEqual({
      mode: 'system',
      colorTheme: 'ocean-blue',
      customAccent: null,
    })
  })

  it('keeps the current accent and record when a new accent is invalid', () => {
    const storage = new TrackingStorage()
    initializeAppearancePreferences(storage)
    setCustomAccent('#123456')
    const writesBeforeInvalidValue = storage.writes

    setCustomAccent('#123')

    expect(customAccent.get()).toBe('#123456')
    expect(storage.writes).toBe(writesBeforeInvalidValue)
    expect(JSON.parse(storage.value!)).toMatchObject({ customAccent: '#123456' })
  })

  it('resets the explicit accent to the selected palette and persists it', () => {
    const storage = new TrackingStorage()
    initializeAppearancePreferences(storage)
    setCustomAccent('#123456')

    resetAccent()

    expect(customAccent.get()).toBeNull()
    expect(JSON.parse(storage.value!)).toMatchObject({ customAccent: null })
  })

  it('updates in-memory appearance when storage reads or writes fail', () => {
    initializeAppearancePreferences({
      getItem: () => {
        throw new Error('read denied')
      },
      setItem: () => {
        throw new Error('write denied')
      },
    })

    setThemePreference('light')
    setColorTheme('emerald')
    setCustomAccent('#abcdef')

    expect(themePreference.get()).toBe('light')
    expect(colorTheme.get()).toBe('emerald')
    expect(customAccent.get()).toBe('#ABCDEF')
  })

  it('uses in-memory defaults when acquiring window local storage throws', () => {
    const priorStorage = new TrackingStorage(
      JSON.stringify({ mode: 'dark', colorTheme: 'emerald', customAccent: '#123456' }),
    )
    initializeAppearancePreferences(priorStorage)
    const priorWrites = priorStorage.writes
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is unavailable.', 'SecurityError')
    })

    expect(() => initializeAppearancePreferences()).not.toThrow()
    expect(themePreference.get()).toBe('system')
    expect(colorTheme.get()).toBe('loop24-indigo')
    expect(customAccent.get()).toBeNull()

    expect(() => {
      setThemePreference('light')
      setColorTheme('emerald')
      setCustomAccent('#abcdef')
    }).not.toThrow()
    expect(themePreference.get()).toBe('light')
    expect(colorTheme.get()).toBe('emerald')
    expect(customAccent.get()).toBe('#ABCDEF')
    expect(priorStorage.writes).toBe(priorWrites)
  })
})
