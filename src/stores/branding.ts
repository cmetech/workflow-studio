import { atom } from 'nanostores'
import type { ThemePreference } from '$src/lib/branding/types'

export const activeBrand = atom('loop24')
export const themePreference = atom<ThemePreference>('system')

export function selectBrand(id: string): void {
  activeBrand.set(id)
}

export function selectTheme(preference: ThemePreference): void {
  themePreference.set(preference)
}
