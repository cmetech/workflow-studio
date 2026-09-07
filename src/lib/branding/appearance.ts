import { applyBrandTheme } from './load-brand'
import type { BrandManifest, ThemeMode, ThemePreference } from './types'

export type ColorThemeId = 'loop24-indigo' | 'ocean-blue' | 'emerald'

export interface AppearancePreferences {
  readonly mode: ThemePreference
  readonly colorTheme: ColorThemeId
  readonly customAccent: string | null
}

export const APPEARANCE_STORAGE_KEY = 'workflow-studio.appearance.v1'

export const COLOR_THEMES = [
  {
    id: 'loop24-indigo',
    label: 'LOOP24 Indigo',
    description: 'The original violet-indigo workflow palette.',
    accents: { light: '#5145CD', dark: '#5B50E6' },
  },
  {
    id: 'ocean-blue',
    label: 'Ocean Blue',
    description: 'A clear blue palette with cool canvas accents.',
    accents: { light: '#0B6BCB', dark: '#5BA8FF' },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    description: 'A calm green palette for nodes and focus states.',
    accents: { light: '#087A55', dark: '#32C48D' },
  },
] as const

const DEFAULT_APPEARANCE: AppearancePreferences = Object.freeze({
  mode: 'system',
  colorTheme: 'loop24-indigo',
  customAccent: null,
})
const ACCENT_PATTERN = /^#?([\dA-F]{6})$/i
const COLOR_THEME_IDS = new Set<ColorThemeId>(COLOR_THEMES.map(({ id }) => id))
const THEME_PREFERENCES = new Set<ThemePreference>(['system', 'light', 'dark'])
const MIN_FOCUS_CONTRAST = 3
const GRAYSCALE_FOCUS_CANDIDATES = Array.from({ length: 256 }, (_, channel) => toHex([channel, channel, channel]))

type Rgb = readonly [red: number, green: number, blue: number]
interface Rgba {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly alpha: number
}

export function normalizeAccent(value: string): string | null {
  const match = ACCENT_PATTERN.exec(value.trim())
  return match?.[1] ? `#${match[1].toUpperCase()}` : null
}

function nativeColorChannel(value: string): number | null {
  const percentage = value.endsWith('%')
  const parsed = Number.parseFloat(percentage ? value.slice(0, -1) : value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(255, Math.round(percentage ? (parsed / 100) * 255 : parsed)))
}

export function toNativeColorValue(value: string): string {
  const trimmed = value.trim()
  const hex = /^#([\dA-F]{3,4}|[\dA-F]{6}|[\dA-F]{8})$/i.exec(trimmed)?.[1]
  if (hex) {
    const opaque = hex.length <= 4 ? [...hex.slice(0, 3)].map((channel) => channel.repeat(2)).join('') : hex.slice(0, 6)
    return `#${opaque.toUpperCase()}`
  }

  const rgb = /^rgba?\((.*)\)$/i.exec(trimmed)?.[1]
  if (rgb) {
    const values = rgb.replaceAll(',', ' ').replace('/', ' ').trim().split(/\s+/)
    const red = values[0] ? nativeColorChannel(values[0]) : null
    const green = values[1] ? nativeColorChannel(values[1]) : null
    const blue = values[2] ? nativeColorChannel(values[2]) : null
    if (red !== null && green !== null && blue !== null) return toHex([red, green, blue])
  }

  return '#000000'
}

function alphaChannel(value: string | undefined): number | null {
  if (value === undefined) return 1
  const percentage = value.endsWith('%')
  const parsed = Number.parseFloat(percentage ? value.slice(0, -1) : value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(1, percentage ? parsed / 100 : parsed))
}

function renderedColor(value: string): Rgba | null {
  const trimmed = value.trim()
  const hex = /^#([\dA-F]{3,4}|[\dA-F]{6}|[\dA-F]{8})$/i.exec(trimmed)?.[1]
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((channel) => channel.repeat(2)).join('') : hex
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    }
  }

  const rgb = /^rgba?\((.*)\)$/i.exec(trimmed)?.[1]?.trim()
  if (!rgb) return null
  const [colorsPart, slashAlpha] = rgb.split('/').map((part) => part.trim())
  const commaParts = colorsPart?.includes(',') ? colorsPart.split(',').map((part) => part.trim()) : undefined
  const colorParts = commaParts ?? colorsPart?.split(/\s+/)
  let alphaPart = slashAlpha
  if (commaParts?.length === 4) alphaPart = commaParts.pop()
  if (!colorParts || colorParts.length !== 3) return null
  const channels = colorParts.map(nativeColorChannel)
  const alpha = alphaChannel(alphaPart)
  if (channels.some((channel) => channel === null) || alpha === null) return null
  return { red: channels[0]!, green: channels[1]!, blue: channels[2]!, alpha }
}

function parseHex(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

function toHex([red, green, blue]: Rgb): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase()
}

function compositeColor(value: string, backdrop: string): string {
  const color = renderedColor(value)
  if (!color) return backdrop
  const background = parseHex(backdrop)
  return toHex([
    color.red * color.alpha + background[0] * (1 - color.alpha),
    color.green * color.alpha + background[1] * (1 - color.alpha),
    color.blue * color.alpha + background[2] * (1 - color.alpha),
  ])
}

function mixHex(from: string, to: string, amount: number): string {
  const ratio = Math.max(0, Math.min(1, amount))
  const source = parseHex(from)
  const target = parseHex(to)
  return toHex([
    source[0] + (target[0] - source[0]) * ratio,
    source[1] + (target[1] - source[1]) * ratio,
    source[2] + (target[2] - source[2]) * ratio,
  ])
}

function relativeLuminance(value: string): number {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function contrastColor(accent: string): '#000000' | '#FFFFFF' {
  const blackContrast = contrastRatio(accent, '#000000')
  const whiteContrast = contrastRatio(accent, '#FFFFFF')
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF'
}

function minimumContrast(color: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)))
}

function focusColor(accent: string, surfaces: readonly string[]): string {
  if (minimumContrast(accent, surfaces) >= MIN_FOCUS_CONTRAST) return accent
  const candidates = [accent, '#000000', '#FFFFFF', ...GRAYSCALE_FOCUS_CANDIDATES]
  let best = candidates[0]!
  let bestContrast = minimumContrast(best, surfaces)
  for (const candidate of candidates.slice(1)) {
    const candidateContrast = minimumContrast(candidate, surfaces)
    if (candidateContrast > bestContrast) {
      best = candidate
      bestContrast = candidateContrast
    }
  }
  return best
}

function minimumIndicatorContrast(primary: string, secondary: string, surfaces: readonly string[]): number {
  return Math.min(
    ...surfaces.map((surface) => Math.max(contrastRatio(primary, surface), contrastRatio(secondary, surface))),
  )
}

function focusColors(accent: string, surfaces: readonly string[]): readonly [primary: string, secondary: string] {
  const optimizedPrimary = focusColor(accent, surfaces)
  const optimizedSecondary = contrastColor(optimizedPrimary)
  if (minimumIndicatorContrast(optimizedPrimary, optimizedSecondary, surfaces) >= MIN_FOCUS_CONTRAST) {
    return [optimizedPrimary, optimizedSecondary]
  }

  const candidates = [accent, '#000000', '#FFFFFF', ...GRAYSCALE_FOCUS_CANDIDATES]
  let bestPrimary = candidates[0]!
  let bestSecondary = contrastColor(bestPrimary)
  let bestContrast = minimumIndicatorContrast(bestPrimary, bestSecondary, surfaces)
  for (const candidate of candidates.slice(1)) {
    const secondary = contrastColor(candidate)
    const candidateContrast = minimumIndicatorContrast(candidate, secondary, surfaces)
    if (candidateContrast > bestContrast) {
      bestPrimary = candidate
      bestSecondary = secondary
      bestContrast = candidateContrast
    }
  }
  return [bestPrimary, bestSecondary]
}

function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && COLOR_THEME_IDS.has(value as ColorThemeId)
}

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.has(value as ThemePreference)
}

function normalizePreferences(value: unknown): AppearancePreferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isThemePreference(record.mode) || !isColorThemeId(record.colorTheme)) return null
  if (record.customAccent !== null && typeof record.customAccent !== 'string') return null
  const customAccent = record.customAccent === null ? null : normalizeAccent(record.customAccent)
  if (record.customAccent !== null && customAccent === null) return null
  return Object.freeze({ mode: record.mode, colorTheme: record.colorTheme, customAccent })
}

export function applyAppearanceTheme(
  brand: BrandManifest,
  mode: ThemeMode,
  colorTheme: ColorThemeId,
  customAccent: string | null,
  root: HTMLElement = document.documentElement,
): void {
  applyBrandTheme(brand, mode, root)
  const normalizedCustomAccent = customAccent === null ? null : normalizeAccent(customAccent)
  const theme = brand.themes[mode]
  const background = compositeColor(theme.background, '#FFFFFF')
  const surface = compositeColor(theme.surface, background)
  const surfaceElevated = compositeColor(theme['surface-elevated'], surface)
  if (colorTheme === 'loop24-indigo' && normalizedCustomAccent === null) {
    root.style.setProperty('--color-focus-contrast', contrastColor(compositeColor(theme.focus, background)))
    return
  }

  const palette = COLOR_THEMES.find(({ id }) => id === colorTheme) ?? COLOR_THEMES[0]
  const accent = normalizedCustomAccent ?? palette.accents[mode]
  const contrast = contrastColor(accent)
  const strongTarget = mode === 'light' ? '#000000' : '#FFFFFF'
  const selectedAmount = mode === 'light' ? 0.14 : 0.24
  const canvas = compositeColor(theme.canvas, background)
  const node = compositeColor(theme.node, canvas)
  const editorSurface = compositeColor(theme.surface, surfaceElevated)
  const yamlGutter = compositeColor(theme['yaml-gutter'], editorSurface)
  const nodeSelected = mixHex(background, accent, selectedAmount)
  const focusSurfaces = [background, surfaceElevated, canvas, node, editorSurface, yamlGutter, nodeSelected]
  const [focus, focusContrast] = focusColors(accent, focusSurfaces)

  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-accent-strong', mixHex(accent, strongTarget, 0.18))
  root.style.setProperty('--color-accent-contrast', contrast)
  root.style.setProperty('--color-focus', focus)
  root.style.setProperty('--color-focus-contrast', focusContrast)
  root.style.setProperty('--color-node-selected', nodeSelected)
  root.style.setProperty('--color-edge-selected', accent)
}

export function loadAppearancePreferences(storage: Pick<Storage, 'getItem'>): AppearancePreferences {
  try {
    const stored = storage.getItem(APPEARANCE_STORAGE_KEY)
    if (stored === null) return DEFAULT_APPEARANCE
    return normalizePreferences(JSON.parse(stored)) ?? DEFAULT_APPEARANCE
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function saveAppearancePreferences(storage: Pick<Storage, 'setItem'>, preferences: AppearancePreferences): void {
  const normalized = normalizePreferences(preferences) ?? DEFAULT_APPEARANCE
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Appearance remains usable in memory when storage is unavailable.
  }
}
