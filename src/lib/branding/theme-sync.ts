import type { ReadableAtom } from 'nanostores'
import { applyBrandTheme } from './load-brand'
import type { BrandManifest, ThemePreference } from './types'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export function synchronizeBrandTheme(
  brand: BrandManifest,
  preferenceStore: ReadableAtom<ThemePreference>,
  root: HTMLElement = document.documentElement,
  environment: Pick<Window, 'matchMedia'> = window,
): () => void {
  let stopColorSchemeSubscription: (() => void) | undefined

  const stopPreferenceSubscription = preferenceStore.subscribe((preference) => {
    stopColorSchemeSubscription?.()
    stopColorSchemeSubscription = undefined

    if (preference !== 'system') {
      applyBrandTheme(brand, preference, root)
      return
    }

    const colorScheme = environment.matchMedia(COLOR_SCHEME_QUERY)
    const applyColorScheme = (matches: boolean): void => {
      applyBrandTheme(brand, matches ? 'dark' : 'light', root)
    }
    const handleColorSchemeChange = (event: MediaQueryListEvent): void => {
      applyColorScheme(event.matches)
    }

    applyColorScheme(colorScheme.matches)
    colorScheme.addEventListener('change', handleColorSchemeChange)
    stopColorSchemeSubscription = () => colorScheme.removeEventListener('change', handleColorSchemeChange)
  })

  return () => {
    stopPreferenceSubscription()
    stopColorSchemeSubscription?.()
    stopColorSchemeSubscription = undefined
  }
}
