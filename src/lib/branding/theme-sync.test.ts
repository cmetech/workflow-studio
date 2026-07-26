import { atom } from 'nanostores'
import { describe, expect, it } from 'vitest'
import type { ThemePreference } from './types'
import { loadBundledBrand } from './load-brand'
import { synchronizeBrandTheme } from './theme-sync'

class ControllableColorScheme {
  matches: boolean
  readonly media = '(prefers-color-scheme: dark)'
  readonly onchange = null
  private readonly listeners = new Set<(event: MediaQueryListEvent) => void>()

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    if (type === 'change') {
      this.listeners.add(listener)
    }
  }

  removeEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    if (type === 'change') {
      this.listeners.delete(listener)
    }
  }

  dispatchEvent(): boolean {
    return true
  }

  addListener(): void {}

  removeListener(): void {}

  listenerCount(): number {
    return this.listeners.size
  }

  setDark(matches: boolean): void {
    this.matches = matches
    const event = new Event('change') as MediaQueryListEvent
    Object.defineProperty(event, 'matches', { value: matches })
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

describe('brand theme synchronization', () => {
  it('follows live system changes only while the preference is system', () => {
    const preference = atom<ThemePreference>('system')
    const root = document.createElement('div')
    const colorScheme = new ControllableColorScheme(false)
    const environment = { matchMedia: () => colorScheme as MediaQueryList }

    const stop = synchronizeBrandTheme(loadBundledBrand(), preference, root, environment)

    expect(root.dataset.theme).toBe('light')
    expect(colorScheme.listenerCount()).toBe(1)

    colorScheme.setDark(true)
    expect(root.dataset.theme).toBe('dark')

    preference.set('light')
    expect(root.dataset.theme).toBe('light')
    expect(colorScheme.listenerCount()).toBe(0)

    colorScheme.setDark(true)
    expect(root.dataset.theme).toBe('light')

    preference.set('system')
    expect(root.dataset.theme).toBe('dark')
    expect(colorScheme.listenerCount()).toBe(1)

    stop()
    expect(colorScheme.listenerCount()).toBe(0)

    preference.set('light')
    colorScheme.setDark(false)
    expect(root.dataset.theme).toBe('dark')
  })

  it('does not subscribe to color-scheme changes for an explicit initial preference', () => {
    const preference = atom<ThemePreference>('dark')
    const root = document.createElement('div')
    const colorScheme = new ControllableColorScheme(false)

    const stop = synchronizeBrandTheme(loadBundledBrand(), preference, root, {
      matchMedia: () => colorScheme as MediaQueryList,
    })

    expect(root.dataset.theme).toBe('dark')
    expect(colorScheme.listenerCount()).toBe(0)

    stop()
  })
})
