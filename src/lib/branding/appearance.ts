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

type Rgb = readonly [red: number, green: number, blue: number]

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
  const blackContrast = minimumContrast('#000000', surfaces)
  const whiteContrast = minimumContrast('#FFFFFF', surfaces)
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF'
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
  if (colorTheme === 'loop24-indigo' && normalizedCustomAccent === null) return

  const palette = COLOR_THEMES.find(({ id }) => id === colorTheme) ?? COLOR_THEMES[0]
  const accent = normalizedCustomAccent ?? palette.accents[mode]
  const contrast = contrastColor(accent)
  const strongTarget = mode === 'light' ? '#000000' : '#FFFFFF'
  const selectedAmount = mode === 'light' ? 0.14 : 0.24
  const nodeSelected = mixHex(brand.themes[mode].background, accent, selectedAmount)
  const focusSurfaces = [
    brand.themes[mode].background,
    brand.themes[mode].surface,
    brand.themes[mode]['surface-elevated'],
    brand.themes[mode].canvas,
    brand.themes[mode].node,
    brand.themes[mode]['yaml-gutter'],
    nodeSelected,
  ].map(toNativeColorValue)

  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-accent-strong', mixHex(accent, strongTarget, 0.18))
  root.style.setProperty('--color-accent-contrast', contrast)
  root.style.setProperty('--color-focus', focusColor(accent, focusSurfaces))
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
