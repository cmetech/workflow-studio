import { atom } from 'nanostores'
import {
  applyBrandTheme,
  getBundledBrandAssetUrl,
  loadBundledBrand,
  resolveThemeMode,
} from '$src/lib/branding/load-brand'
import { parseBrandManifest, validateBrandPack, type ValidatedBrandPack } from '$src/lib/branding/validate-theme'
import type { BrandManifest, RuntimeBrandPack, RuntimeBrandReport, ThemePreference } from '$src/lib/branding/types'
import type { BrandActivationResult, BrandNativeBridge, StoredBrandPack } from '$src/lib/native/types'

export const activeBrand = atom('loop24')
export const activeBrandManifest = atom<BrandManifest>(loadBundledBrand())
export const themePreference = atom<ThemePreference>('system')

export interface BrandControllerState {
  readonly activeId: string
  readonly packs: readonly RuntimeBrandPack[]
  readonly reports: readonly RuntimeBrandReport[]
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
  const value =
    typeof cause === 'string'
      ? cause
      : cause instanceof Error && cause.message
        ? cause.message
        : 'The active brand could not be loaded.'
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

function runtimePack(validated: ValidatedBrandPack, previewOnly = false, revision?: string): RuntimeBrandPack {
  const createdUrls: string[] = []
  const urlFor = (path: string): string => {
    const asset = validated.assets[path]
    if (!asset) throw new Error(`Validated brand asset ${path} is missing.`)
    const url = makeObjectUrl(asset.bytes, asset.mediaType)
    createdUrls.push(url)
    return url
  }
  try {
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
      ...(revision ? { revision } : {}),
    }
  } catch (cause: unknown) {
    if (typeof URL.revokeObjectURL === 'function') {
      for (const url of new Set(createdUrls)) URL.revokeObjectURL(url)
    }
    throw cause
  }
}

function releasePack(pack: RuntimeBrandPack | undefined): void {
  if (!pack || pack.builtIn || typeof URL.revokeObjectURL !== 'function') return
  for (const url of new Set(Object.values(pack.assetUrls))) URL.revokeObjectURL(url)
}

function loadStoredRuntimePack(stored: StoredBrandPack): RuntimeBrandPack {
  const assets = Object.fromEntries(stored.assets.map(({ path, bytes }) => [path, Uint8Array.from(bytes)]))
  const validated = validateBrandPack(JSON.stringify(stored.manifest), assets)
  if (!validated.canActivate) throw new Error(`${stored.manifest.id} no longer meets activation requirements.`)
  return runtimePack(validated, false, stored.revision)
}

export function createBrandController(
  native: BrandNativeBridge,
  root: HTMLElement = document.documentElement,
): BrandController {
  const packs = new Map<string, RuntimeBrandPack>([['loop24', bundledPack()]])
  const reports: RuntimeBrandReport[] = []
  const state = atom<BrandControllerState>({
    activeId: 'loop24',
    packs: [...packs.values()],
    reports,
    pending: false,
    warning: null,
  })
  const queued: (() => void)[] = []
  let busy = false

  function publish(patch: Partial<BrandControllerState> = {}): void {
    state.set({ ...state.get(), packs: [...packs.values()], reports: [...reports], ...patch })
  }

  function releaseUnreferenced(...candidates: (RuntimeBrandPack | undefined)[]): void {
    const retained = new Set(packs.values())
    for (const pack of new Set(candidates)) {
      if (pack && !retained.has(pack)) releasePack(pack)
    }
  }

  function replacePack(pack: RuntimeBrandPack, announce: () => void = publish): void {
    const previous = packs.get(pack.manifest.id)
    packs.set(pack.manifest.id, pack)
    announce()
    releaseUnreferenced(previous)
  }

  function warningText(values: readonly unknown[]): string | null {
    const messages = values.filter((value) => value !== null && value !== undefined).map(boundedWarning)
    return messages.length > 0 ? boundedWarning(messages.join(' ')) : null
  }

  function addReport(cause: unknown): void {
    reports.push({
      reportId: `rejected-${reports.length + 1}`,
      displayName: 'Rejected brand pack',
      message: boundedWarning(cause),
      canActivate: false,
      safeToRender: false,
    })
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
      const warnings: unknown[] = []
      try {
        const listed = await native.brandListPacks()
        warnings.push(...listed.warnings)
        for (const stored of listed.packs) {
          try {
            const pack = loadStoredRuntimePack(stored)
            replacePack(pack)
          } catch (cause: unknown) {
            addReport(cause)
            warnings.push(cause)
          }
        }
      } catch (cause: unknown) {
        warnings.push(cause)
      }
      try {
        const active = await native.brandLoadActive()
        if (active.warning) warnings.push(active.warning)
        const pack =
          active.id === 'loop24'
            ? packs.get('loop24')!
            : active.pack
              ? loadStoredRuntimePack(active.pack)
              : (() => {
                  throw new Error('The active custom brand did not include its exact stored revision.')
                })()
        if (!pack.builtIn) {
          replacePack(pack, () => commit(pack))
        } else {
          commit(pack)
        }
        try {
          await native.setWindowIcon(pack.manifest.id, pack.revision ?? null)
        } catch (cause: unknown) {
          warnings.push(cause)
          if (pack.manifest.id !== 'loop24') {
            await native.brandActivate('loop24')
            commit(packs.get('loop24')!)
            try {
              await native.setWindowIcon('loop24', null)
            } catch (fallbackIconCause: unknown) {
              warnings.push(fallbackIconCause)
            }
          }
        }
      } catch (cause: unknown) {
        warnings.push(cause)
        try {
          await native.brandActivate('loop24')
        } catch (fallbackCause: unknown) {
          warnings.push(fallbackCause)
        }
        commit(packs.get('loop24')!)
        try {
          await native.setWindowIcon('loop24', null)
        } catch (iconCause: unknown) {
          warnings.push(iconCause)
        }
      }
      publish({ warning: warningText(warnings) })
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
        replacePack(pack)
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
        addReport(cause)
        publish()
        return null
      }
    })
  }

  function exactActivationPack(result: BrandActivationResult): RuntimeBrandPack {
    if (result.id === 'loop24') {
      if (result.pack) throw new Error('LOOP24 activation returned an unexpected custom payload.')
      return packs.get('loop24')!
    }
    if (!result.pack || result.pack.manifest.id !== result.id) {
      throw new Error('Native activation did not return its exact custom brand revision.')
    }
    return loadStoredRuntimePack(result.pack)
  }

  async function activate(id: string): Promise<void> {
    return serialize(async () => {
      const pack = packs.get(id)
      if (!pack) throw new Error('The selected brand is not available.')
      if (!pack.canActivate) throw new Error('Resolve blocking brand validation issues before activation.')
      const previous = packs.get(state.get().activeId) ?? packs.get('loop24')!
      const activated = await native.brandActivate(id)
      let exact: RuntimeBrandPack | undefined
      try {
        exact = exactActivationPack(activated)
        if (!exact.builtIn) packs.set(exact.manifest.id, exact)
        commit(exact)
      } catch (cause: unknown) {
        const rolledBack = exactActivationPack(await native.brandActivate(previous.manifest.id))
        const displaced = rolledBack.builtIn ? undefined : packs.get(rolledBack.manifest.id)
        if (exact && !exact.builtIn && exact.manifest.id !== rolledBack.manifest.id) {
          packs.set(exact.manifest.id, pack)
        }
        if (!rolledBack.builtIn) packs.set(rolledBack.manifest.id, rolledBack)
        commit(rolledBack)
        releaseUnreferenced(exact, pack, displaced)
        throw cause
      }
      if (!exact) throw new Error('Native activation did not return a usable brand revision.')
      try {
        await native.setWindowIcon(exact.manifest.id, exact.revision ?? null)
      } catch (cause: unknown) {
        const rolledBack = exactActivationPack(await native.brandActivate(previous.manifest.id))
        const displaced = rolledBack.builtIn ? undefined : packs.get(rolledBack.manifest.id)
        if (!exact.builtIn && exact.manifest.id !== rolledBack.manifest.id) {
          packs.set(exact.manifest.id, pack)
        }
        if (!rolledBack.builtIn) packs.set(rolledBack.manifest.id, rolledBack)
        commit(rolledBack)
        releaseUnreferenced(exact, pack, displaced)
        try {
          await native.setWindowIcon(rolledBack.manifest.id, rolledBack.revision ?? null)
        } catch (rollbackIconCause: unknown) {
          publish({ warning: warningText([cause, rollbackIconCause]) })
        }
        throw cause
      }
      releaseUnreferenced(pack)
    })
  }

  async function remove(id: string, revertActive: boolean): Promise<void> {
    return serialize(async () => {
      const removed = packs.get(id)
      if (!removed) throw new Error('The selected brand is not available.')
      if (removed.previewOnly) {
        packs.delete(id)
        releasePack(removed)
        publish()
        return
      }
      const revertingActive = state.get().activeId === id && revertActive
      if (revertingActive) await native.setWindowIcon('loop24', null)
      let result: Awaited<ReturnType<BrandNativeBridge['brandRemove']>>
      try {
        result = await native.brandRemove(id, revertActive)
      } catch (cause: unknown) {
        if (revertingActive) {
          try {
            await native.setWindowIcon(removed.manifest.id, removed.revision ?? null)
          } catch (restoreIconCause: unknown) {
            throw new AggregateError([cause, restoreIconCause], 'Brand removal and icon restoration both failed.')
          }
        }
        throw cause
      }
      const warnings: unknown[] = result.warning ? [result.warning] : []
      if (result.activeId !== state.get().activeId) {
        const next = packs.get(result.activeId)
        if (!next) throw new Error('Native removal selected an unavailable active brand.')
        commit(next)
        if (!revertingActive) {
          try {
            await native.setWindowIcon(next.manifest.id, next.revision ?? null)
          } catch (cause: unknown) {
            warnings.push(cause)
          }
        }
      }
      if (result.removed) {
        packs.delete(id)
        releasePack(removed)
      }
      publish({ warning: warningText(warnings) })
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
