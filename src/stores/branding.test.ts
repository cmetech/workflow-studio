import { stringify } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBundledBrand } from '$src/lib/branding/load-brand'
import { synchronizeBrandTheme } from '$src/lib/branding/theme-sync'
import type { BrandNativeBridge } from '$src/lib/native/types'
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
    brandActivate: async () => undefined,
    brandRemove: async () => undefined,
    brandLoadActive: async () => 'loop24',
    brandLoadPack: async () => {
      throw new Error('missing pack')
    },
    setWindowIcon: async () => ({ status: 'unsupported' }),
    ...overrides,
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
    const controller = createBrandController(native(), root)
    const custom = {
      ...bundled,
      id: 'custom',
      themes: {
        light: { ...bundled.themes.light, background: '#112233' },
        dark: { ...bundled.themes.dark, background: '#445566' },
      },
    }
    controller.registerForTest(custom)

    await controller.activate('custom')
    themePreference.set('light')

    expect(root.dataset.brand).toBe('custom')
    expect(root.style.getPropertyValue('--color-background')).toBe('#112233')

    themePreference.set('system')
    for (const listener of mediaListeners) {
      listener({ matches: true } as MediaQueryListEvent)
    }
    expect(root.dataset.brand).toBe('custom')
    expect(root.style.getPropertyValue('--color-background')).toBe('#445566')
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
    const svg = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')]
    const importPack = vi.fn(async () => ({ id: value.id, displayName: value.displayName }))
    const revoke = vi.fn(async () => undefined)
    const activate = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const controller = createBrandController(
      native({
        brandChooseSource: async () => ({
          grantToken: 'grant',
          manifestText: stringify(value),
          manifestSha256: 'a'.repeat(64),
        }),
        brandReadSourceAssets: async (_grant, paths) =>
          paths.map((path) => ({ path, bytes: svg, sha256: 'b'.repeat(64) })),
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

  it('revokes a selected source grant when renderer validation fails', async () => {
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

    await expect(controller.importPack()).rejects.toThrow(/css/i)
    expect(revoke).toHaveBeenCalledWith('failed-grant')
  })

  it('recovers when the active-brand record itself cannot be read', async () => {
    const activate = vi.fn(async () => undefined)
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
    const activate = vi.fn(async () => undefined)
    const controller = createBrandController(
      native({
        brandLoadActive: async () => 'corrupt',
        brandLoadPack: async () => Promise.reject(new Error('x'.repeat(9000))),
        brandActivate: activate,
      }),
      document.createElement('div'),
    )

    await controller.initialize()

    expect(controller.state.get().activeId).toBe('loop24')
    expect(controller.state.get().warning).toHaveLength(4097)
    expect(activate).toHaveBeenCalledWith('loop24')
  })

  it('serializes activation so failed or stale work cannot leave a half-applied global theme', async () => {
    let release!: () => void
    const first = new Promise<void>((resolve) => (release = resolve))
    const activate = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(undefined)
    const root = document.createElement('div')
    const controller = createBrandController(native({ brandActivate: activate }), root)
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
    const startup = new Promise<string>((resolve) => (releaseStartup = () => resolve('loop24')))
    const activate = vi.fn(async () => undefined)
    const controller = createBrandController(
      native({ brandLoadActive: () => startup, brandActivate: activate }),
      document.createElement('div'),
    )
    const custom = { ...loadBundledBrand(), id: 'queued-custom' }
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
