import { atom } from 'nanostores'
import {
  applyBrandTheme,
  getBundledBrandAssetUrl,
  loadBundledBrand,
  resolveThemeMode,
} from '$src/lib/branding/load-brand'
import { parseBrandManifest, validateBrandPack, type ValidatedBrandPack } from '$src/lib/branding/validate-theme'
import type { BrandManifest, RuntimeBrandPack, ThemePreference } from '$src/lib/branding/types'
import type { BrandNativeBridge } from '$src/lib/native/types'

export const activeBrand = atom('loop24')
export const activeBrandManifest = atom<BrandManifest>(loadBundledBrand())
export const themePreference = atom<ThemePreference>('system')

export interface BrandControllerState {
  readonly activeId: string
  readonly packs: readonly RuntimeBrandPack[]
  readonly pending: boolean
  readonly warning: string | null
}

export interface BrandController {
  readonly state: ReturnType<typeof atom<BrandControllerState>>
  initialize(): Promise<void>
  importPack(): Promise<RuntimeBrandPack | null>
  activate(id: string): Promise<void>
  remove(id: string, revertActive: boolean): Promise<void>
  registerForTest(manifest: BrandManifest): void
}

function boundedWarning(cause: unknown): string {
  const value = cause instanceof Error && cause.message ? cause.message : 'The active brand could not be loaded.'
  return value.length <= 4096 ? value : `${value.slice(0, 4096)}…`
}

function bundledPack(): RuntimeBrandPack {
  const manifest = loadBundledBrand()
  return {
    manifest,
    assetUrls: {
      logo: getBundledBrandAssetUrl(manifest, 'logo'),
      mark: getBundledBrandAssetUrl(manifest, 'mark'),
      windowIcon: getBundledBrandAssetUrl(manifest, 'windowIcon'),
    },
    issues: [],
    canActivate: true,
    builtIn: true,
  }
}

function makeObjectUrl(bytes: Uint8Array, mediaType: string): string {
  if (typeof URL.createObjectURL !== 'function') return `blob:workflow-studio-${crypto.randomUUID()}`
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }))
}

function runtimePack(validated: ValidatedBrandPack, previewOnly = false): RuntimeBrandPack {
  const urlFor = (path: string): string => {
    const asset = validated.assets[path]
    if (!asset) throw new Error(`Validated brand asset ${path} is missing.`)
    return makeObjectUrl(asset.bytes, asset.mediaType)
  }
  return {
    manifest: validated.manifest,
    assetUrls: {
      logo: urlFor(validated.manifest.assets.logo),
      mark: urlFor(validated.manifest.assets.mark),
      windowIcon: urlFor(validated.manifest.assets.windowIcon),
    },
    issues: validated.issues,
    canActivate: validated.canActivate,
    builtIn: false,
    previewOnly,
  }
}

export function createBrandController(
  native: BrandNativeBridge,
  root: HTMLElement = document.documentElement,
): BrandController {
  const packs = new Map<string, RuntimeBrandPack>([['loop24', bundledPack()]])
  const state = atom<BrandControllerState>({
    activeId: 'loop24',
    packs: [...packs.values()],
    pending: false,
    warning: null,
  })
  const queued: (() => void)[] = []
  let busy = false

  function publish(patch: Partial<BrandControllerState> = {}): void {
    state.set({ ...state.get(), packs: [...packs.values()], ...patch })
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        busy = true
        publish({ pending: true })
        void operation()
          .then(resolve, reject)
          .finally(() => {
            const next = queued.shift()
            if (next) next()
            else {
              busy = false
              publish({ pending: false })
            }
          })
      }
      if (busy) queued.push(run)
      else run()
    })
  }

  function commit(pack: RuntimeBrandPack): void {
    applyBrandTheme(pack.manifest, resolveThemeMode(themePreference.get()), root)
    activeBrand.set(pack.manifest.id)
    activeBrandManifest.set(pack.manifest)
    publish({ activeId: pack.manifest.id, warning: null })
  }

  async function initialize(): Promise<void> {
    return serialize(async () => {
      try {
        const id = await native.brandLoadActive()
        if (id === 'loop24') {
          commit(packs.get('loop24')!)
          return
        }
        const stored = await native.brandLoadPack(id)
        const assets = Object.fromEntries(stored.assets.map(({ path, bytes }) => [path, Uint8Array.from(bytes)]))
        const validated = validateBrandPack(JSON.stringify(stored.manifest), assets)
        if (!validated.canActivate) throw new Error('The saved active brand no longer meets activation requirements.')
        const pack = runtimePack(validated)
        packs.set(id, pack)
        commit(pack)
      } catch (cause: unknown) {
        let warning = boundedWarning(cause)
        try {
          await native.brandActivate('loop24')
        } catch (fallbackCause: unknown) {
          warning = boundedWarning(fallbackCause)
        }
        commit(packs.get('loop24')!)
        publish({ warning })
      }
    })
  }

  async function importPack(): Promise<RuntimeBrandPack | null> {
    return serialize(async () => {
      const selection = await native.brandChooseSource()
      if (!selection) return null
      try {
        const manifest = parseBrandManifest(selection.manifestText, { existingIds: [...packs.keys()] })
        const paths = [...new Set(Object.values(manifest.assets))]
        const sourceAssets = await native.brandReadSourceAssets(selection.grantToken, paths)
        const sources = Object.fromEntries(sourceAssets.map(({ path, bytes }) => [path, Uint8Array.from(bytes)]))
        const validated = validateBrandPack(selection.manifestText, sources, { existingIds: [...packs.keys()] })
        const sourceByPath = new Map(sourceAssets.map((asset) => [asset.path, asset]))
        if (validated.canActivate) {
          await native.brandImport({
            grantToken: selection.grantToken,
            manifest: validated.manifest,
            manifestSourceSha256: selection.manifestSha256,
            assets: Object.values(validated.assets).map((asset) => ({
              path: asset.path,
              sourceSha256: sourceByPath.get(asset.path)!.sha256,
              mediaType: asset.mediaType,
              sanitizedBytes: [...asset.bytes],
            })),
          })
        } else {
          await native.brandRevokeSourceGrant(selection.grantToken)
        }
        const pack = runtimePack(validated, !validated.canActivate)
        packs.set(pack.manifest.id, pack)
        publish()
        return pack
      } catch (cause: unknown) {
        try {
          await native.brandRevokeSourceGrant(selection.grantToken)
        } catch (revokeCause: unknown) {
          throw new AggregateError(
            [cause, revokeCause],
            'Brand import failed and its source grant could not be revoked.',
          )
        }
        throw cause
      }
    })
  }

  async function activate(id: string): Promise<void> {
    return serialize(async () => {
      const pack = packs.get(id)
      if (!pack) throw new Error('The selected brand is not available.')
      if (!pack.canActivate) throw new Error('Resolve blocking brand validation issues before activation.')
      const previous = packs.get(state.get().activeId) ?? packs.get('loop24')!
      await native.brandActivate(id)
      try {
        commit(pack)
      } catch (cause: unknown) {
        await native.brandActivate(previous.manifest.id)
        commit(previous)
        throw cause
      }
      try {
        await native.setWindowIcon(id)
      } catch (cause: unknown) {
        publish({ warning: boundedWarning(cause) })
      }
    })
  }

  async function remove(id: string, revertActive: boolean): Promise<void> {
    return serialize(async () => {
      const removed = packs.get(id)
      if (!removed) throw new Error('The selected brand is not available.')
      if (!removed.previewOnly) await native.brandRemove(id, revertActive)
      if (state.get().activeId === id) commit(packs.get('loop24')!)
      packs.delete(id)
      if (removed && !removed.builtIn && typeof URL.revokeObjectURL === 'function') {
        for (const url of new Set(Object.values(removed.assetUrls))) URL.revokeObjectURL(url)
      }
      publish()
    })
  }

  function registerForTest(manifest: BrandManifest): void {
    packs.set(manifest.id, {
      manifest,
      assetUrls: {
        logo: `blob:${manifest.id}-logo`,
        mark: `blob:${manifest.id}-mark`,
        windowIcon: `blob:${manifest.id}-icon`,
      },
      issues: [],
      canActivate: true,
      builtIn: false,
    })
    publish()
  }

  return { state, initialize, importPack, activate, remove, registerForTest }
}

export function selectBrand(id: string): void {
  activeBrand.set(id)
}

export function selectTheme(preference: ThemePreference): void {
  themePreference.set(preference)
}
