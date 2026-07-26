export const THEME_TOKEN_NAMES = [
  'background',
  'surface',
  'surface-elevated',
  'text',
  'text-muted',
  'accent',
  'accent-strong',
  'accent-contrast',
  'border',
  'focus',
  'success',
  'warning',
  'error',
  'canvas',
  'grid',
  'node',
  'node-selected',
  'edge',
  'edge-selected',
  'yaml-gutter',
  'shadow',
] as const

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]
export type ThemeMode = 'light' | 'dark'
export type ThemePreference = ThemeMode | 'system'
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>

export interface BrandAssets {
  logo: string
  mark: string
  windowIcon: string
}

export interface BrandManifest {
  schemaVersion: 1
  id: string
  displayName: string
  assets: BrandAssets
  themes: Readonly<Record<ThemeMode, ThemeTokens>>
}
