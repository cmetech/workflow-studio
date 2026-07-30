import { stringify } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBundledBrand } from '$src/lib/branding/load-brand'
import { synchronizeBrandTheme } from '$src/lib/branding/theme-sync'
import type { BrandNativeBridge, StoredBrandPack } from '$src/lib/native/types'
import { activeBrand, activeBrandManifest, createBrandController, themePreference } from './branding'

afterEach(() => {
  activeBrand.set('loop24')
  activeBrandManifest.set(loadBundledBrand())
  themePreference.set('system')
})

function native(overrides: Partial<BrandNativeBridge> = {}): BrandNativeBridge {
  return {
    hostHealth: async () => ({ appVersion: 'test', os: 'browser', arch: 'test' }),
    brandChooseSource: async () => null,
    brandReadSourceAssets: async () => [],
    brandRevokeSourceGrant: async () => undefined,
    brandImport: async (request) => ({ id: request.manifest.id, displayName: request.manifest.displayName }),
    brandActivate: async (id) => ({ id, pack: null }),
    brandRemove: async () => ({ activeId: 'loop24', removed: true, warning: null }),
    brandLoadActive: async () => ({ id: 'loop24', pack: null, recovered: false, warning: null }),
    brandListPacks: async () => ({ packs: [], warnings: [] }),
    brandLoadPack: async () => {
      throw new Error('missing pack')
    },
    setWindowIcon: async () => ({ status: 'unsupported' }),
    ...overrides,
  }
}

const SVG_BYTES = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')]
const PNG_BYTES = [
  ...Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
    (value) => value.charCodeAt(0),
  ),
]

function stored(
  manifest = loadBundledBrand(),
  revision = `sha256:${manifest.id.padEnd(64, '0').slice(0, 64)}`,
): StoredBrandPack {
  return {
    manifest,
    revision,
    assets: [...new Set(Object.values(manifest.assets))].map((path) => ({ path, bytes: SVG_BYTES })),
  }
}

describe('brand controller', () => {
  it('keeps preference and system color-scheme changes on the active runtime manifest', async () => {
    const root = document.createElement('div')
    const bundled = loadBundledBrand()
    const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()
    const colorScheme = {
      matches: false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaListeners.delete(listener),
    } as unknown as MediaQueryList
    const stop = synchronizeBrandTheme(activeBrandManifest, themePreference, root, { matchMedia: () => colorScheme })
    const custom = {
      ...bundled,
      id: 'custom',
      themes: {
        light: { ...bundled.themes.light, background: '#FFFFFF' },
        dark: { ...bundled.themes.dark, background: '#000000' },
      },
    }
    const controller = createBrandController(
      native({ brandActivate: async () => ({ id: custom.id, pack: stored(custom) }) }),
      root,
    )
    controller.registerForTest(custom)

    await controller.activate('custom')
    themePreference.set('light')

    expect(root.dataset.brand).toBe('custom')
    expect(root.style.getPropertyValue('--color-background')).toBe('#FFFFFF')

    themePreference.set('system')
    for (const listener of mediaListeners) {
      listener({ matches: true } as MediaQueryListEvent)
    }
    expect(root.dataset.brand).toBe('custom')
    expect(root.style.getPropertyValue('--color-background')).toBe('#000000')
    stop()
  })

  it('keeps a sanitized low-contrast import preview-only without persisting or activating it', async () => {
    const bundled = loadBundledBrand()
    const value = {
      ...bundled,
      id: 'preview-only',
      displayName: 'Preview Only',
      themes: {
        ...bundled.themes,
        dark: { ...bundled.themes.dark, text: bundled.themes.dark.background },
      },
    }
    const importPack = vi.fn(async () => ({ id: value.id, displayName: value.displayName }))
    const revoke = vi.fn(async () => undefined)
    const activate = vi.fn(async (id: string) => ({ id, pack: null }))
    const remove = vi.fn(async () => ({ activeId: 'loop24', removed: true, warning: null }))
    const controller = createBrandController(
      native({
        brandChooseSource: async () => ({
          grantToken: 'grant',
          manifestText: stringify(value),
          manifestSha256: 'a'.repeat(64),
        }),
        brandReadSourceAssets: async (_grant, paths) =>
          paths.map((path) => ({ path, bytes: SVG_BYTES, sha256: 'b'.repeat(64) })),
        brandRevokeSourceGrant: revoke,
        brandImport: importPack,
        brandActivate: activate,
        brandRemove: remove,
      }),
      document.createElement('div'),
    )

    const preview = await controller.importPack()

    expect(preview).toMatchObject({ canActivate: false, previewOnly: true })
    expect(controller.state.get().packs.map(({ manifest }) => manifest.id)).toContain('preview-only')
    expect(importPack).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('grant')
    await expect(controller.activate('preview-only')).rejects.toThrow(/blocking brand validation/i)
    expect(activate).not.toHaveBeenCalled()
    await controller.remove('preview-only', false)
    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps an unsafe selected pack as a non-renderable inspection report and revokes its grant', async () => {
    const revoke = vi.fn(async () => undefined)
    const controller = createBrandController(
      native({
        brandChooseSource: async () => ({
          grantToken: 'failed-grant',
          manifestText: 'schemaVersion: 1\nid: unsafe\ncss: body {}\n',
          manifestSha256: 'a'.repeat(64),
        }),
        brandRevokeSourceGrant: revoke,
      }),
      document.createElement('div'),
    )

    expect(await controller.importPack()).toBeNull()
    expect(controller.state.get().reports).toContainEqual(
      expect.objectContaining({
        displayName: 'Rejected brand pack',
        message: expect.stringMatching(/css/i),
        safeToRender: false,
      }),
    )
    expect(controller.state.get().packs).toHaveLength(1)
    expect(revoke).toHaveBeenCalledWith('failed-grant')
  })

  it('recovers when the active-brand record itself cannot be read', async () => {
    const activate = vi.fn(async (id: string) => ({ id, pack: null }))
    const controller = createBrandController(
      native({
        brandLoadActive: async () => Promise.reject(new Error('invalid active brand record')),
        brandActivate: activate,
      }),
      document.createElement('div'),
    )

    await controller.initialize()

    expect(controller.state.get().activeId).toBe('loop24')
    expect(controller.state.get().warning).toBe('invalid active brand record')
    expect(activate).toHaveBeenCalledWith('loop24')
  })

  it('reverts a corrupt startup selection to LOOP24 and exposes one bounded warning', async () => {
    const controller = createBrandController(
      native({
        brandLoadActive: async () => ({ id: 'loop24', pack: null, recovered: true, warning: 'x'.repeat(9000) }),
        brandLoadPack: async () => Promise.reject(new Error('x'.repeat(9000))),
      }),
      document.createElement('div'),
    )

    await controller.initialize()

    expect(controller.state.get().activeId).toBe('loop24')
    expect(controller.state.get().warning).toHaveLength(4097)
  })

  it('hydrates every valid persisted pack and surfaces bounded corrupt-entry and recovery warnings', async () => {
    const bundled = loadBundledBrand()
    const acme = { ...bundled, id: 'acme', displayName: 'Acme' }
    const beta = { ...bundled, id: 'beta', displayName: 'Beta' }
    const icon = vi.fn(async () => ({ status: 'applied' as const }))
    const controller = createBrandController(
      native({
        brandListPacks: async () => ({ packs: [stored(acme), stored(beta)], warnings: ['corrupt ignored'] }),
        brandLoadActive: async () => ({
          id: 'acme',
          pack: stored(acme),
          recovered: true,
          warning: 'active record recovered',
        }),
        setWindowIcon: icon,
      }),
      document.createElement('div'),
    )

    await controller.initialize()

    expect(controller.state.get().packs.map(({ manifest }) => manifest.id)).toEqual(['loop24', 'acme', 'beta'])
    expect(controller.state.get().warning).toMatch(/corrupt ignored.*active record recovered/i)
    expect(icon).toHaveBeenCalledWith('acme', stored(acme).revision)
  })

  it('rolls a custom startup selection and its window icon back to LOOP24 when icon application fails', async () => {
    const custom = { ...loadBundledBrand(), id: 'acme', displayName: 'Acme' }
    const calls: string[] = []
    const activate = vi.fn(async (id: string) => {
      calls.push(`activate:${id}`)
      return { id, pack: null }
    })
    const icon = vi.fn(async (id: string) => {
      calls.push(`icon:${id}`)
      if (id === 'acme') throw new Error('startup icon failed')
      return { status: 'applied' as const }
    })
    const root = document.createElement('div')
    const controller = createBrandController(
      native({
        brandLoadActive: async () => ({
          id: 'acme',
          pack: stored(custom),
          recovered: false,
          warning: null,
        }),
        brandActivate: activate,
        setWindowIcon: icon,
      }),
      root,
    )

    await controller.initialize()

    expect(calls).toEqual(['icon:acme', 'activate:loop24', 'icon:loop24'])
    expect(controller.state.get().activeId).toBe('loop24')
    expect(controller.state.get().warning).toMatch(/startup icon failed/i)
    expect(root.dataset.brand).toBe('loop24')
  })

  it('commits only the exact native-revalidated activation revision and restores the default icon for LOOP24', async () => {
    const bundled = loadBundledBrand()
    const stale = {
      ...bundled,
      id: 'acme',
      themes: { ...bundled.themes, dark: { ...bundled.themes.dark, background: '#010101' } },
    }
    const exact = { ...stale, themes: { ...stale.themes, dark: { ...stale.themes.dark, background: '#000000' } } }
    const calls: string[] = []
    const activate = vi.fn(async (id: string) => {
      calls.push(`activate:${id}`)
      return { id, pack: id === 'loop24' ? null : stored(exact, 'sha256:exact') }
    })
    const icon = vi.fn(async (id: string, revision: string | null) => {
      calls.push(`icon:${id}:${revision ?? 'default'}`)
      return { status: 'applied' as const }
    })
    const root = document.createElement('div')
    const controller = createBrandController(native({ brandActivate: activate, setWindowIcon: icon }), root)
    controller.registerForTest(stale)

    await controller.activate('acme')
    expect(root.style.getPropertyValue('--color-background')).toBe('#000000')
    expect(controller.state.get().packs.find(({ manifest }) => manifest.id === 'acme')?.revision).toBe('sha256:exact')

    await controller.activate('loop24')
    expect(calls).toEqual(['activate:acme', 'icon:acme:sha256:exact', 'activate:loop24', 'icon:loop24:default'])
    expect(root.dataset.brand).toBe('loop24')
  })

  it('keeps a custom SVG brand active when native resets its prior PNG icon to the platform default', async () => {
    const bundled = loadBundledBrand()
    const pngBrand = {
      ...bundled,
      id: 'png-brand',
      assets: { ...bundled.assets, windowIcon: 'icon.png' },
    }
    const svgBrand = {
      ...bundled,
      id: 'svg-brand',
      assets: { ...bundled.assets, windowIcon: 'icon.svg' },
    }
    const pngPack = stored(pngBrand, 'sha256:png')
    const exactPacks = new Map([
      [
        pngBrand.id,
        {
          ...pngPack,
          assets: pngPack.assets.map((asset) => (asset.path === 'icon.png' ? { ...asset, bytes: PNG_BYTES } : asset)),
        },
      ],
      [svgBrand.id, stored(svgBrand, 'sha256:svg')],
    ])
    const activate = vi.fn(async (id: string) => ({ id, pack: exactPacks.get(id) ?? null }))
    const icon = vi
      .fn()
      .mockResolvedValueOnce({ status: 'applied' as const })
      .mockResolvedValueOnce({ status: 'unsupported' as const })
    const root = document.createElement('div')
    const controller = createBrandController(native({ brandActivate: activate, setWindowIcon: icon }), root)
    controller.registerForTest(pngBrand)
    controller.registerForTest(svgBrand)

    await controller.activate(pngBrand.id)
    await controller.activate(svgBrand.id)

    expect(activate.mock.calls).toEqual([[pngBrand.id], [svgBrand.id]])
    expect(icon.mock.calls).toEqual([
      [pngBrand.id, 'sha256:png'],
      [svgBrand.id, 'sha256:svg'],
    ])
    expect(controller.state.get().activeId).toBe(svgBrand.id)
    expect(root.dataset.brand).toBe(svgBrand.id)
  })

  it('reconciles renderer state when active removal reverts natively but cleanup reports failure', async () => {
    const bundled = loadBundledBrand()
    const custom = { ...bundled, id: 'acme' }
    const calls: string[] = []
    const icon = vi.fn(async (id: string) => {
      calls.push(`icon:${id}`)
      return { status: 'applied' as const }
    })
    const remove = vi.fn(async () => {
      calls.push('remove:acme')
      return { activeId: 'loop24', removed: false, warning: 'cleanup denied' }
    })
    const controller = createBrandController(
      native({
        brandActivate: async () => ({ id: 'acme', pack: stored(custom) }),
        brandRemove: remove,
        setWindowIcon: icon,
      }),
      document.createElement('div'),
    )
    controller.registerForTest(custom)
    await controller.activate('acme')

    await controller.remove('acme', true)

    expect(controller.state.get().activeId).toBe('loop24')
    expect(controller.state.get().packs.map(({ manifest }) => manifest.id)).toContain('acme')
    expect(controller.state.get().warning).toBe('cleanup denied')
    expect(icon).toHaveBeenLastCalledWith('loop24', null)
    expect(calls.slice(-2)).toEqual(['icon:loop24', 'remove:acme'])
  })

  it('rolls native, renderer, and icon state back when a supported activation icon update fails', async () => {
    const custom = { ...loadBundledBrand(), id: 'acme' }
    const activate = vi.fn(async (id: string) => ({ id, pack: id === 'loop24' ? null : stored(custom) }))
    const icon = vi
      .fn()
      .mockRejectedValueOnce(new Error('supported icon update failed'))
      .mockResolvedValueOnce({ status: 'applied' })
    const root = document.createElement('div')
    const controller = createBrandController(native({ brandActivate: activate, setWindowIcon: icon }), root)
    controller.registerForTest(custom)

    await expect(controller.activate('acme')).rejects.toThrow(/icon update failed/i)

    expect(activate.mock.calls).toEqual([['acme'], ['loop24']])
    expect(icon.mock.calls).toEqual([
      ['acme', stored(custom).revision],
      ['loop24', null],
    ])
    expect(controller.state.get().activeId).toBe('loop24')
    expect(root.dataset.brand).toBe('loop24')
  })

  it('serializes activation so failed or stale work cannot leave a half-applied global theme', async () => {
    let release!: () => void
    const first = new Promise<void>((resolve) => (release = resolve))
    const root = document.createElement('div')
    const bundled = loadBundledBrand()
    const acme = {
      ...bundled,
      id: 'acme',
      themes: { ...bundled.themes, dark: { ...bundled.themes.dark, background: '#010203' } },
    }
    const beta = {
      ...bundled,
      id: 'beta',
      themes: { ...bundled.themes, dark: { ...bundled.themes.dark, background: '#040506' } },
    }
    const byId = new Map([
      [acme.id, stored(acme)],
      [beta.id, stored(beta)],
    ])
    const activate = vi
      .fn()
      .mockImplementationOnce(async (id: string) => {
        await first
        return { id, pack: byId.get(id)! }
      })
      .mockImplementationOnce(async (id: string) => ({ id, pack: byId.get(id)! }))
    const controller = createBrandController(native({ brandActivate: activate }), root)
    controller.registerForTest(acme)
    controller.registerForTest(beta)

    const pendingFirst = controller.activate('acme')
    const pendingSecond = controller.activate('beta')
    expect(activate).toHaveBeenCalledTimes(1)
    expect(root.style.getPropertyValue('--color-background')).toBe('')
    release()
    await Promise.all([pendingFirst, pendingSecond])

    expect(activate.mock.calls).toEqual([['acme'], ['beta']])
    expect(controller.state.get().activeId).toBe('beta')
    expect(root.style.getPropertyValue('--color-background')).toBe('#040506')
  })

  it('serializes startup restoration before user-triggered brand operations', async () => {
    let releaseStartup!: () => void
    const custom = { ...loadBundledBrand(), id: 'queued-custom' }
    const startup = new Promise<Awaited<ReturnType<BrandNativeBridge['brandLoadActive']>>>(
      (resolve) => (releaseStartup = () => resolve({ id: 'loop24', pack: null, recovered: false, warning: null })),
    )
    const activate = vi.fn(async (id: string) => ({ id, pack: stored(custom) }))
    const controller = createBrandController(
      native({ brandLoadActive: () => startup, brandActivate: activate }),
      document.createElement('div'),
    )
    controller.registerForTest(custom)

    const initialization = controller.initialize()
    const activation = controller.activate('queued-custom')

    expect(controller.state.get().pending).toBe(true)
    expect(activate).not.toHaveBeenCalled()
    releaseStartup()
    await Promise.all([initialization, activation])
    expect(activate).toHaveBeenCalledWith('queued-custom')
  })
})
