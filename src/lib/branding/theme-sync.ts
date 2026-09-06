import type { ReadableAtom } from 'nanostores'
import { applyAppearanceTheme, type ColorThemeId } from './appearance'
import type { BrandManifest, ThemePreference } from './types'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export interface AppearanceThemeStores {
  readonly colorTheme: ReadableAtom<ColorThemeId>
  readonly customAccent: ReadableAtom<string | null>
}

export function synchronizeBrandTheme(
  brandStore: ReadableAtom<BrandManifest>,
  preferenceStore: ReadableAtom<ThemePreference>,
  root: HTMLElement = document.documentElement,
  environment: Pick<Window, 'matchMedia'> = window,
  appearance?: AppearanceThemeStores,
): () => void {
  let brand = brandStore.get()
  let preference = preferenceStore.get()
  let colorTheme = appearance?.colorTheme.get() ?? 'loop24-indigo'
  let customAccent = appearance?.customAccent.get() ?? null
  let systemIsDark = false
  let stopColorSchemeSubscription: (() => void) | undefined

  const applyCurrent = (): void => {
    applyAppearanceTheme(
      brand,
      preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference,
      colorTheme,
      customAccent,
      root,
    )
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
  const stopColorThemeSubscription = appearance?.colorTheme.subscribe((nextColorTheme) => {
    colorTheme = nextColorTheme
    applyCurrent()
  })
  const stopCustomAccentSubscription = appearance?.customAccent.subscribe((nextCustomAccent) => {
    customAccent = nextCustomAccent
    applyCurrent()
  })

  return () => {
    stopBrandSubscription()
    stopPreferenceSubscription()
    stopColorThemeSubscription?.()
    stopCustomAccentSubscription?.()
    stopColorSchemeSubscription?.()
    stopColorSchemeSubscription = undefined
  }
}
