import type { ReadableAtom } from 'nanostores'
import { applyBrandTheme } from './load-brand'
import type { BrandManifest, ThemePreference } from './types'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export function synchronizeBrandTheme(
  brandStore: ReadableAtom<BrandManifest>,
  preferenceStore: ReadableAtom<ThemePreference>,
  root: HTMLElement = document.documentElement,
  environment: Pick<Window, 'matchMedia'> = window,
): () => void {
  let brand = brandStore.get()
  let preference = preferenceStore.get()
  let systemIsDark = false
  let stopColorSchemeSubscription: (() => void) | undefined

  const applyCurrent = (): void => {
    applyBrandTheme(brand, preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference, root)
  }

  const stopBrandSubscription = brandStore.subscribe((nextBrand) => {
    brand = nextBrand
    applyCurrent()
  })
  const stopPreferenceSubscription = preferenceStore.subscribe((nextPreference) => {
    preference = nextPreference
    stopColorSchemeSubscription?.()
    stopColorSchemeSubscription = undefined

    if (preference !== 'system') {
      applyCurrent()
      return
    }

    const colorScheme = environment.matchMedia(COLOR_SCHEME_QUERY)
    const applyColorScheme = (matches: boolean): void => {
      systemIsDark = matches
      applyCurrent()
    }
    const handleColorSchemeChange = (event: MediaQueryListEvent): void => {
      applyColorScheme(event.matches)
    }

    applyColorScheme(colorScheme.matches)
    colorScheme.addEventListener('change', handleColorSchemeChange)
    stopColorSchemeSubscription = () => colorScheme.removeEventListener('change', handleColorSchemeChange)
  })

  return () => {
    stopBrandSubscription()
    stopPreferenceSubscription()
    stopColorSchemeSubscription?.()
    stopColorSchemeSubscription = undefined
  }
}
