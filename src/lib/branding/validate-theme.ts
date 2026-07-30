import { isScalar, parseDocument, visit } from 'yaml'
import { sanitizeBrandAsset, MAX_BRAND_ASSET_BYTES, type SanitizedBrandAsset } from './sanitize-assets'
import type { BrandAssets, BrandManifest, ThemeMode, ThemeTokenName, ThemeTokens } from './types'
import { THEME_TOKEN_NAMES } from './types'

export const MAX_BRAND_PACK_BYTES = 8 * 1024 * 1024

export interface BrandValidationIssue {
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly mode: ThemeMode
}

export interface ValidatedBrandPack {
  readonly manifest: BrandManifest
  readonly assets: Readonly<Record<string, SanitizedBrandAsset>>
  readonly issues: readonly BrandValidationIssue[]
  readonly canActivate: boolean
}

interface ValidationOptions {
  readonly existingIds?: readonly string[]
}

interface Rgba {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly alpha: number
}

const BRAND_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const ROOT_KEYS = new Set(['schemaVersion', 'id', 'displayName', 'assets', 'themes'])
const ASSET_KEYS = new Set(['logo', 'mark', 'windowIcon'])
const THEME_KEYS = new Set<ThemeMode>(['light', 'dark'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, context: string): void {
  const unexpected = Object.keys(record).find((key) => !allowed.has(key))
  if (unexpected) throw new Error(`${context}.${unexpected} is not supported.`)
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${context} must be a mapping.`)
  return value
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${context}.${key} must be a non-empty string.`)
  return value.trim()
}

function safeAssetPath(value: string): boolean {
  if (value.includes('\0') || value.includes('\\') || value.includes('?') || value.includes('#')) return false
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (decoded !== value && decoded.includes('\\')) return false
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(decoded)) return false
  const segments = decoded.split('/')
  return segments.length > 0 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function parseComponent(value: string): number | null {
  if (value.endsWith('%')) {
    const percent = Number(value.slice(0, -1))
    return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round((percent * 255) / 100) : null
  }
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 255 ? Math.round(number) : null
}

function parseAlpha(value: string | undefined): number | null {
  if (value === undefined) return 255
  if (value.endsWith('%')) {
    const percent = Number(value.slice(0, -1))
    return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round((percent * 255) / 100) : null
  }
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? Math.round(number * 255) : null
}

function parseColor(source: string): Rgba | null {
  const value = source.trim()
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value)?.[1]
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
    }
  }
  const rgb = /^rgba?\((.*)\)$/i.exec(value)?.[1]?.trim()
  if (!rgb) return null
  const [colorsPart, slashAlpha] = rgb.split('/').map((part) => part.trim())
  const commaParts = colorsPart?.includes(',') ? colorsPart.split(',').map((part) => part.trim()) : undefined
  const colorParts = commaParts ?? colorsPart?.split(/\s+/)
  let alphaPart = slashAlpha
  if (commaParts?.length === 4) alphaPart = commaParts.pop()
  if (!colorParts || colorParts.length !== 3) return null
  const channels = colorParts.map(parseComponent)
  const alpha = parseAlpha(alphaPart)
  if (channels.some((channel) => channel === null) || alpha === null) return null
  return { red: channels[0]!, green: channels[1]!, blue: channels[2]!, alpha }
}

function canonicalColor(color: Rgba): string {
  const hex = [color.red, color.green, color.blue, ...(color.alpha === 255 ? [] : [color.alpha])]
    .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase())
    .join('')
  return `#${hex}`
}

function loadTheme(value: unknown, mode: ThemeMode): ThemeTokens {
  const record = requireRecord(value, `themes.${mode}`)
  assertExactKeys(record, new Set(THEME_TOKEN_NAMES), `themes.${mode}`)
  const theme = {} as Record<ThemeTokenName, string>
  for (const token of THEME_TOKEN_NAMES) {
    const source = requireString(record, token, `themes.${mode}`)
    const color = parseColor(source)
    if (!color) throw new Error(`themes.${mode}.${token} must be an allowed hex or rgb color.`)
    theme[token] = canonicalColor(color)
  }
  return theme
}

export function parseBrandManifest(source: string, options: ValidationOptions = {}): BrandManifest {
  const document = parseDocument(source, { version: '1.2', uniqueKeys: true })
  if (document.errors.length > 0) {
    const duplicate = document.errors.find(({ code }) => code === 'DUPLICATE_KEY')
    throw new Error(
      duplicate ? `Brand manifest has a duplicate key: ${duplicate.message}` : document.errors[0]!.message,
    )
  }
  let hasAlias = false
  let hasMerge = false
  visit(document, {
    Alias: () => {
      hasAlias = true
      return visit.BREAK
    },
    Pair: (_key, pair) => {
      if (isScalar(pair.key) && pair.key.value === '<<') hasMerge = true
    },
  })
  if (hasAlias) throw new Error('Brand manifests cannot contain YAML aliases.')
  if (hasMerge) throw new Error('Brand manifests cannot contain YAML merge keys.')
  let value: unknown
  try {
    value = document.toJS({ maxAliasCount: 0 })
  } catch {
    throw new Error('Brand manifest aliases or recursive values are not supported.')
  }
  const root = requireRecord(value, 'brand manifest')
  assertExactKeys(root, ROOT_KEYS, 'brand')
  if (root.schemaVersion !== 1) throw new Error('brand.schemaVersion must be 1.')
  const id = requireString(root, 'id', 'brand')
  if (!BRAND_ID.test(id)) throw new Error('brand.id must be a lowercase identifier using letters, digits, and hyphens.')
  if (options.existingIds?.includes(id)) throw new Error(`Brand ID ${id} already exists.`)
  const assetSource = requireRecord(root.assets, 'assets')
  assertExactKeys(assetSource, ASSET_KEYS, 'assets')
  const assets = {} as Record<keyof BrandAssets, string>
  for (const name of ASSET_KEYS) {
    const path = requireString(assetSource, name, 'assets')
    if (!safeAssetPath(path)) throw new Error(`assets.${name} must be a safe relative asset path.`)
    if (!/\.(?:svg|png)$/i.test(path)) throw new Error(`assets.${name} must reference a supported SVG or PNG asset.`)
    assets[name as keyof BrandAssets] = path
  }
  const themesSource = requireRecord(root.themes, 'themes')
  assertExactKeys(themesSource, THEME_KEYS, 'themes')
  return {
    schemaVersion: 1,
    id,
    displayName: requireString(root, 'displayName', 'brand'),
    assets,
    themes: { light: loadTheme(themesSource.light, 'light'), dark: loadTheme(themesSource.dark, 'dark') },
  }
}

function srgb(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function opaque(color: Rgba, background: Rgba): Rgba {
  const alpha = color.alpha / 255
  return {
    red: Math.round(color.red * alpha + background.red * (1 - alpha)),
    green: Math.round(color.green * alpha + background.green * (1 - alpha)),
    blue: Math.round(color.blue * alpha + background.blue * (1 - alpha)),
    alpha: 255,
  }
}

export function contrastRatio(foreground: string, background: string): number {
  const rawBackground = parseColor(background)
  const rawForeground = parseColor(foreground)
  if (!rawBackground || !rawForeground) throw new Error('Contrast requires canonical colors.')
  const backdrop = opaque(rawBackground, { red: 255, green: 255, blue: 255, alpha: 255 })
  const front = opaque(rawForeground, backdrop)
  const luminance = (color: Rgba) => 0.2126 * srgb(color.red) + 0.7152 * srgb(color.green) + 0.0722 * srgb(color.blue)
  const light = Math.max(luminance(front), luminance(backdrop))
  const dark = Math.min(luminance(front), luminance(backdrop))
  return (light + 0.05) / (dark + 0.05)
}

function contrastIssues(manifest: BrandManifest): BrandValidationIssue[] {
  const issues: BrandValidationIssue[] = []
  const required = [
    ['text', 'background', 4.5],
    ['text', 'surface', 4.5],
    ['accent-contrast', 'accent', 4.5],
    ['focus', 'background', 3],
    ['error', 'background', 4.5],
  ] as const
  for (const mode of THEME_KEYS) {
    const theme = manifest.themes[mode]
    for (const [foreground, background, minimum] of required) {
      if (contrastRatio(theme[foreground], theme[background]) + Number.EPSILON < minimum) {
        issues.push({
          code: `brand_contrast_${foreground.replaceAll('-', '_')}_${background.replaceAll('-', '_')}`,
          severity: 'error',
          message: `${mode} ${foreground}/${background} contrast must be at least ${minimum}:1.`,
          mode,
        })
      }
    }
    if (contrastRatio(theme.grid, theme.canvas) < 1.1) {
      issues.push({
        code: 'brand_contrast_grid_canvas',
        severity: 'warning',
        message: `${mode} grid contrast is too subtle for some users.`,
        mode,
      })
    }
  }
  return issues
}

export function validateBrandPack(
  manifestSource: string,
  assetSources: Readonly<Record<string, Uint8Array>>,
  options: ValidationOptions = {},
): ValidatedBrandPack {
  const manifestBytes = new TextEncoder().encode(manifestSource).byteLength
  let totalBytes = manifestBytes
  for (const [path, bytes] of Object.entries(assetSources)) {
    if (bytes.byteLength > MAX_BRAND_ASSET_BYTES) throw new Error(`${path} exceeds the 2 MiB per-file limit.`)
    totalBytes += bytes.byteLength
  }
  if (totalBytes > MAX_BRAND_PACK_BYTES) throw new Error('The brand pack exceeds the 8 MiB total limit.')
  const manifest = parseBrandManifest(manifestSource, options)
  const sanitized: Record<string, SanitizedBrandAsset> = {}
  for (const path of new Set(Object.values(manifest.assets))) {
    const bytes = Object.hasOwn(assetSources, path) ? assetSources[path] : undefined
    if (!bytes) throw new Error(`Required brand asset ${path} is missing.`)
    sanitized[path] = sanitizeBrandAsset(path, bytes)
  }
  const issues = contrastIssues(manifest)
  return {
    manifest,
    assets: sanitized,
    issues,
    canActivate: !issues.some(({ severity }) => severity === 'error'),
  }
}
