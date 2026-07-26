import { parse } from 'yaml'
import brandManifestText from '../../../brands/loop24/brand.yaml?raw'
import type { BrandAssets, BrandManifest, ThemeMode, ThemePreference, ThemeTokenName, ThemeTokens } from './types'
import { THEME_TOKEN_NAMES } from './types'

export const REQUIRED_THEME_TOKENS = THEME_TOKEN_NAMES

const BUNDLED_ASSET_URLS: Readonly<Record<string, string>> = {
  'logo.svg': new URL('../../../brands/loop24/logo.svg', import.meta.url).href,
  'mark.svg': new URL('../../../brands/loop24/mark.svg', import.meta.url).href,
}

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const RGB_COLOR = /^rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}.${key} must be a non-empty string`)
  }
  return value
}

function isAllowedColor(value: string): boolean {
  return HEX_COLOR.test(value) || RGB_COLOR.test(value)
}

function loadTheme(value: unknown, mode: ThemeMode): ThemeTokens {
  if (!isRecord(value)) {
    throw new Error(`themes.${mode} must be a token mapping`)
  }

  const actualTokens = Object.keys(value)
  const unexpectedToken = actualTokens.find((token) => !THEME_TOKEN_NAMES.includes(token as ThemeTokenName))
  if (unexpectedToken) {
    throw new Error(`themes.${mode}.${unexpectedToken} is not a supported semantic token`)
  }

  const tokens = {} as Record<ThemeTokenName, string>
  for (const token of THEME_TOKEN_NAMES) {
    const color = requireString(value, token, `themes.${mode}`)
    if (!isAllowedColor(color)) {
      throw new Error(`themes.${mode}.${token} must be an allowed hex or rgb color`)
    }
    tokens[token] = color
  }
  return tokens
}

function isSafeAssetPath(path: string): boolean {
  let normalizedPath: string
  try {
    normalizedPath = decodeURIComponent(path).replaceAll('\\', '/')
  } catch {
    return false
  }

  if (
    /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(normalizedPath) ||
    normalizedPath.includes('?') ||
    normalizedPath.includes('#')
  ) {
    return false
  }
  return !normalizedPath.split('/').includes('..')
}

function loadAssets(value: unknown): BrandAssets {
  if (!isRecord(value)) {
    throw new Error('assets must be a mapping')
  }

  const assets: BrandAssets = {
    logo: requireString(value, 'logo', 'assets'),
    mark: requireString(value, 'mark', 'assets'),
    windowIcon: requireString(value, 'windowIcon', 'assets'),
  }
  for (const [name, path] of Object.entries(assets)) {
    if (!isSafeAssetPath(path)) {
      throw new Error(`assets.${name} must be a safe relative asset path`)
    }
  }
  return assets
}

export function loadBrandManifest(source: string): BrandManifest {
  const value: unknown = parse(source, { uniqueKeys: true })
  if (!isRecord(value)) {
    throw new Error('brand manifest must be a mapping')
  }
  if (value.schemaVersion !== 1) {
    throw new Error('brand manifest schemaVersion must be 1')
  }
  if (!isRecord(value.themes)) {
    throw new Error('themes must be a mapping')
  }

  return {
    schemaVersion: 1,
    id: requireString(value, 'id', 'brand'),
    displayName: requireString(value, 'displayName', 'brand'),
    assets: loadAssets(value.assets),
    themes: {
      light: loadTheme(value.themes.light, 'light'),
      dark: loadTheme(value.themes.dark, 'dark'),
    },
  }
}

let bundledBrand: BrandManifest | undefined

export function loadBundledBrand(): BrandManifest {
  if (!bundledBrand) {
    const brand = loadBrandManifest(brandManifestText)
    for (const asset of ['logo', 'mark', 'windowIcon'] as const) {
      getBundledBrandAssetUrl(brand, asset)
    }
    bundledBrand = brand
  }
  return bundledBrand
}

export function getBundledBrandAssetUrl(brand: BrandManifest, asset: keyof BrandAssets): string {
  const path = brand.assets[asset]
  const url = BUNDLED_ASSET_URLS[path]
  if (!url) {
    throw new Error(`Bundled brand asset assets.${asset} (${path}) was not found`)
  }
  return url
}

export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  if (preference !== 'system') {
    return preference
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyBrandTheme(
  brand: BrandManifest,
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.brand = brand.id
  root.dataset.theme = mode
  root.style.colorScheme = mode
  for (const token of THEME_TOKEN_NAMES) {
    root.style.setProperty(`--color-${token}`, brand.themes[mode][token])
  }
}
