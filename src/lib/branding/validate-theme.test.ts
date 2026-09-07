import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { loadBundledBrand } from './load-brand'
import { validateBrandPack } from './validate-theme'

type MutableBrand = {
  schemaVersion: 1
  id: string
  displayName: string
  assets: { logo: string; mark: string; windowIcon: string }
  themes: { light: Record<string, string>; dark: Record<string, string> }
}

function mutableBrand(): MutableBrand {
  return structuredClone(loadBundledBrand()) as unknown as MutableBrand
}

function manifest(overrides: Record<string, unknown> = {}): string {
  return stringify({ ...structuredClone(loadBundledBrand()), id: 'acme', displayName: 'Acme Studio', ...overrides })
}

function assets(extra: Record<string, Uint8Array> = {}): Readonly<Record<string, Uint8Array>> {
  return {
    'logo.svg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'),
    'mark.svg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>'),
    ...extra,
  }
}

describe('validateBrandPack', () => {
  it('normalizes supported hex and rgb colors and accepts a complete local pack', () => {
    const value = mutableBrand()
    value.id = 'acme'
    value.displayName = 'Acme Studio'
    value.themes.dark.background = 'rgb(11 13 18)'
    value.themes.dark.surface = '#11141cff'

    const result = validateBrandPack(stringify(value), assets())

    expect(result.canActivate).toBe(true)
    expect(result.manifest.themes.dark.background).toBe('#0B0D12')
    expect(result.manifest.themes.dark.surface).toBe('#11141C')
    expect(result.issues).toEqual([])
  })

  it('rejects duplicate YAML keys, duplicate pack IDs, and unknown executable or style sections', () => {
    const duplicateKey = `${manifest()}\nid: shadowed\n`
    expect(() => validateBrandPack(duplicateKey, assets())).toThrow(/duplicate/i)
    expect(() => validateBrandPack(manifest(), assets(), { existingIds: ['acme'] })).toThrow(/already exists/i)
    expect(() => validateBrandPack(manifest({ scripts: ['launch.js'] }), assets())).toThrow(/scripts/i)
    expect(() => validateBrandPack(manifest({ css: 'body { display: none }' }), assets())).toThrow(/css/i)
    expect(() => validateBrandPack(manifest({ harmlessLookingExtension: true }), assets())).toThrow(
      /harmlessLookingExtension/i,
    )
  })

  it('rejects aliases, merge keys, recursive documents, and non-mapping values', () => {
    const brand = mutableBrand()
    brand.id = 'acme'
    const base = stringify(brand)
    expect(() =>
      validateBrandPack(
        base.replace('logo: logo.svg\n  mark: mark.svg', 'logo: &logo logo.svg\n  mark: *logo'),
        assets(),
      ),
    ).toThrow(/alias|supported/i)
    expect(() => validateBrandPack(`&root\nself: *root\n`, assets())).toThrow(/alias|recursive|supported/i)
    expect(() => validateBrandPack(`defaults: &defaults\n  logo: logo.svg\n<<: *defaults\n${base}`, assets())).toThrow(
      /alias|merge|supported/i,
    )
    expect(() => validateBrandPack('null\n', assets())).toThrow(/mapping/i)
    expect(() => validateBrandPack('- brand\n', assets())).toThrow(/mapping/i)
  })

  it.each([
    '../outside.svg',
    '%2e%2e/outside.svg',
    '/absolute.svg',
    'C:\\outside.svg',
    '\\\\server\\share.svg',
    'https://example.com/logo.svg',
    'data:image/svg+xml,evil',
    'nested\\..\\outside.svg',
    'logo.svg\0.png',
  ])('rejects confused, escaping, or remote asset path %s', (path) => {
    const value = mutableBrand()
    value.id = 'acme'
    value.assets.logo = path
    expect(() => validateBrandPack(stringify(value), assets())).toThrow(/safe relative asset path/i)
  })

  it('rejects missing assets, per-file limits, and aggregate pack limits', () => {
    expect(() => validateBrandPack(manifest(), { 'logo.svg': assets()['logo.svg']! })).toThrow(/mark\.svg.*missing/i)

    const tooLarge = new Uint8Array(2 * 1024 * 1024 + 1)
    expect(() => validateBrandPack(manifest(), { ...assets(), 'logo.svg': tooLarge })).toThrow(/2 MiB/i)

    const value = mutableBrand()
    value.id = 'acme'
    value.assets = { logo: 'a.png', mark: 'b.png', windowIcon: 'c.png' }
    expect(() =>
      validateBrandPack(stringify(value), {
        'a.png': new Uint8Array(2 * 1024 * 1024),
        'b.png': new Uint8Array(2 * 1024 * 1024),
        'c.png': new Uint8Array(2 * 1024 * 1024),
        'unused-a.bin': new Uint8Array(2 * 1024 * 1024),
        'unused-b.bin': new Uint8Array(1),
      }),
    ).toThrow(/8 MiB/i)
  })

  it('blocks operational contrast failures while retaining decorative contrast as preview warnings', () => {
    const blocked = mutableBrand()
    blocked.id = 'blocked'
    blocked.themes.dark.text = '#101010'
    expect(validateBrandPack(stringify(blocked), assets()).issues).toContainEqual(
      expect.objectContaining({ code: 'brand_contrast_text_background', severity: 'error' }),
    )

    const warning = mutableBrand()
    warning.id = 'warning'
    warning.themes.dark.grid = warning.themes.dark.canvas!
    const result = validateBrandPack(stringify(warning), assets())
    expect(result.canActivate).toBe(true)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'brand_contrast_grid_canvas', severity: 'warning' }),
    )
  })

  it('rejects semantic foregrounds that disappear on their accepted production surfaces', () => {
    const blocked = mutableBrand()
    blocked.id = 'surface-contrast-blocked'
    Object.assign(blocked.themes.dark, {
      background: '#FFFFFF',
      surface: '#FFFFFF',
      'surface-elevated': '#000000',
      text: '#000000',
      'text-muted': '#000000',
      success: '#000000',
      warning: '#FFFFFF',
      node: '#000000',
      'node-selected': '#000000',
      'yaml-gutter': '#000000',
      focus: '#000000',
      error: '#000000',
    })

    const result = validateBrandPack(stringify(blocked), assets())

    expect(result.canActivate).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'brand_contrast_text_surface_elevated', severity: 'error' }),
        expect.objectContaining({ code: 'brand_contrast_text_node', severity: 'error' }),
        expect.objectContaining({ code: 'brand_contrast_text_muted_surface_elevated', severity: 'error' }),
        expect.objectContaining({ code: 'brand_contrast_warning_surface', severity: 'error' }),
      ]),
    )
  })

  it('checks translucent editor surfaces against their canvas ancestry', () => {
    const blocked = mutableBrand()
    blocked.id = 'canvas-surface-contrast-blocked'
    Object.assign(blocked.themes.dark, {
      background: '#FFFFFF',
      surface: '#FFFFFF00',
      'surface-elevated': '#FFFFFF',
      text: '#000000',
      'text-muted': '#000000',
      canvas: '#000000',
      node: '#FFFFFF',
      'node-selected': '#FFFFFF',
      'yaml-gutter': '#FFFFFF',
      focus: '#000000',
      warning: '#000000',
      error: '#000000',
    })

    const result = validateBrandPack(stringify(blocked), assets())

    expect(result.canActivate).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'brand_contrast_text_surface', severity: 'error' }),
        expect.objectContaining({ code: 'brand_contrast_text_muted_surface', severity: 'error' }),
      ]),
    )
  })

  it('checks the nested CodeMirror gutter through its surface and elevated wrappers', () => {
    const blocked = mutableBrand()
    blocked.id = 'codemirror-gutter-contrast-blocked'
    Object.assign(blocked.themes.dark, {
      background: '#D8D8D8',
      surface: 'rgba(152, 152, 152, 0.1)',
      'surface-elevated': 'rgba(112, 112, 112, 0.8)',
      text: '#000000',
      'text-muted': '#000000',
      canvas: '#E9E9E9',
      node: '#D8D8D8',
      'node-selected': '#D8D8D8',
      'yaml-gutter': 'rgba(7, 7, 7, 0.3)',
      focus: '#000000',
      warning: '#000000',
      error: '#000000',
    })

    const result = validateBrandPack(stringify(blocked), assets())

    expect(result.canActivate).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'brand_contrast_text_yaml_gutter', severity: 'error' }),
        expect.objectContaining({ code: 'brand_contrast_text_muted_yaml_gutter', severity: 'error' }),
      ]),
    )
  })

  it('does not block imported packs on the built-in mark accent pair', () => {
    const imported = mutableBrand()
    imported.id = 'independent-image-assets'
    imported.themes.dark.accent = '#777777'
    imported.themes.dark['accent-contrast'] = '#777777'

    const result = validateBrandPack(stringify(imported), assets())

    expect(result.canActivate).toBe(true)
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'brand_contrast_accent_contrast_accent' }))
  })

  it('rejects incomplete token maps and CSS-capable color payloads', () => {
    const missing = mutableBrand() as unknown as {
      id: string
      themes: { dark: Record<string, string> }
    }
    missing.id = 'missing'
    delete missing.themes.dark.focus
    expect(() => validateBrandPack(stringify(missing), assets())).toThrow(/focus.*non-empty/i)

    const injected = mutableBrand()
    injected.id = 'injected'
    injected.themes.dark.background = 'url(https://example.com/pixel)'
    expect(() => validateBrandPack(stringify(injected), assets())).toThrow(/color/i)

    const extraToken = mutableBrand() as unknown as {
      id: string
      themes: { dark: Record<string, string> }
    }
    extraToken.id = 'extra-token'
    extraToken.themes.dark.remoteFont = 'https://example.com/font.woff2'
    expect(() => validateBrandPack(stringify(extraToken), assets())).toThrow(/remoteFont/i)
  })
})
