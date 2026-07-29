import { validateContractFormCoverage } from '$src/lib/forms/widget-registry'
import { canonicalizeContractPayload, sha256Hex } from './canonical-json'
import { loadAuthoringContract } from './contract-loader'
import type { AuthoringContract, ContractSource, WorkflowProfile } from './types'

export type ContractCacheSource = 'bundled' | 'cached'

export interface ContractCacheEntry {
  readonly digest: `sha256:${string}`
  readonly profile: WorkflowProfile
  readonly schemaVersion: number
  readonly normalizerVersion: number
  readonly readerVersion: number
  readonly status: ContractCacheSource
  readonly provenance: ContractSource
  readonly active: boolean
  readonly canActivate: boolean
}

export interface ContractCacheStoredEntry {
  readonly digest: `sha256:${string}`
  readonly profile: WorkflowProfile
  readonly schemaVersion: number
  readonly normalizerVersion: number
  readonly readerVersion: number
  readonly source: ContractSource
  readonly content: string
  readonly active: boolean
}

export interface ContractCacheNative {
  contractCacheLoad(): Promise<readonly ContractCacheStoredEntry[]>
  contractCacheWrite(entries: readonly ContractCacheStoredEntry[]): Promise<void>
}

export interface ContractCacheOptions {
  readonly bundled: readonly AuthoringContract[]
  readonly native: ContractCacheNative
  readonly activate: (contract: AuthoringContract) => Promise<boolean>
  readonly widgetCoverage?: (contract: AuthoringContract) => readonly { readonly code: string }[]
}

export type ContractActivationResult =
  | { readonly ok: true; readonly contract: AuthoringContract }
  | {
      readonly ok: false
      readonly code:
        | 'contract_not_found'
        | 'contract_profile_mismatch'
        | 'contract_reader_unsupported'
        | 'contract_activation_failed'
    }

export interface ContractCache {
  hydrate(): Promise<void>
  importBytes(
    bytes: Uint8Array,
    source: ContractSource,
    options?: { readonly cacheUnsupported?: boolean },
  ): Promise<ContractCacheEntry>
  listCachedContracts(): readonly ContractCacheEntry[]
  listAuthoringContracts(): readonly AuthoringContract[]
  activeContract(profile: WorkflowProfile): AuthoringContract | undefined
  activateContract(digest: `sha256:${string}`, profile: WorkflowProfile): Promise<ContractActivationResult>
  removeContract(digest: `sha256:${string}`): Promise<void>
}

export class ContractCacheError extends Error {
  constructor(
    readonly code: 'contract_digest_mismatch' | 'contract_shape_invalid' | 'contract_reader_unsupported',
    message: string,
  ) {
    super(message)
    this.name = 'ContractCacheError'
  }
}

interface CachedContract {
  readonly entry: ContractCacheStoredEntry
  readonly contract: AuthoringContract | null
  readonly canActivate: boolean
}

export function createContractCache(options: ContractCacheOptions): ContractCache {
  const bundled = new Map(options.bundled.map((contract) => [contract.contract_digest, contract]))
  const cached = new Map<string, CachedContract>()
  const activeByProfile = new Map<WorkflowProfile, `sha256:${string}`>()
  const coverage = options.widgetCoverage ?? validateContractFormCoverage

  for (const contract of options.bundled) activeByProfile.set(contract.profile, contract.contract_digest)

  function listCachedContracts(): readonly ContractCacheEntry[] {
    const entries: ContractCacheEntry[] = []
    for (const contract of bundled.values())
      entries.push(
        publicEntry(contract, 'bundled', activeByProfile.get(contract.profile) === contract.contract_digest, true),
      )
    for (const value of cached.values()) {
      entries.push({
        digest: value.entry.digest,
        profile: value.entry.profile,
        schemaVersion: value.entry.schemaVersion,
        normalizerVersion: value.entry.normalizerVersion,
        readerVersion: value.entry.readerVersion,
        status: 'cached',
        provenance: value.entry.source,
        active: activeByProfile.get(value.entry.profile) === value.entry.digest,
        canActivate: value.canActivate,
      })
    }
    return entries.sort(
      (left, right) => left.profile.localeCompare(right.profile) || left.digest.localeCompare(right.digest),
    )
  }

  async function hydrate(): Promise<void> {
    for (const stored of await options.native.contractCacheLoad()) {
      await acceptStored(stored, true)
    }
    for (const value of cached.values()) {
      if (!value.entry.active || !value.contract || !value.canActivate) continue
      try {
        if (await options.activate(value.contract)) activeByProfile.set(value.contract.profile, value.entry.digest)
      } catch {
        // Keep unavailable cached contracts inspectable; the bundled contract remains active.
      }
    }
  }

  function listAuthoringContracts(): readonly AuthoringContract[] {
    return [
      ...bundled.values(),
      ...[...cached.values()].flatMap((value) => (value.contract ? [value.contract] : [])),
    ].sort(
      (left, right) =>
        left.profile.localeCompare(right.profile) || left.contract_digest.localeCompare(right.contract_digest),
    )
  }

  function activeContract(profile: WorkflowProfile): AuthoringContract | undefined {
    const digest = activeByProfile.get(profile)
    return digest ? (bundled.get(digest) ?? cached.get(digest)?.contract ?? undefined) : undefined
  }

  async function importBytes(
    bytes: Uint8Array,
    source: ContractSource,
    importOptions: { readonly cacheUnsupported?: boolean } = {},
  ): Promise<ContractCacheEntry> {
    const stored = await storedFromBytes(bytes, source)
    const existingBundled = bundled.get(stored.digest)
    if (existingBundled) {
      return publicEntry(
        existingBundled,
        'bundled',
        activeByProfile.get(existingBundled.profile) === existingBundled.contract_digest,
        true,
      )
    }
    const value = await acceptStored(stored, importOptions.cacheUnsupported === true)
    if (!value)
      throw new ContractCacheError(
        'contract_reader_unsupported',
        'This contract reader version cannot be cached without confirmation.',
      )
    await persist()
    return listCachedContracts().find((entry) => entry.digest === stored.digest && entry.status === 'cached')!
  }

  async function activateContract(
    digest: `sha256:${string}`,
    profile: WorkflowProfile,
  ): Promise<ContractActivationResult> {
    const cachedCandidate = cached.get(digest)
    if (cachedCandidate && !cachedCandidate.canActivate) return { ok: false, code: 'contract_reader_unsupported' }
    const candidate = bundled.get(digest) ?? cachedCandidate?.contract
    if (!candidate) return { ok: false, code: 'contract_not_found' }
    if (candidate.profile !== profile) return { ok: false, code: 'contract_profile_mismatch' }
    if (coverage(candidate).length > 0) return { ok: false, code: 'contract_reader_unsupported' }
    try {
      if (!(await options.activate(candidate))) return { ok: false, code: 'contract_activation_failed' }
    } catch {
      return { ok: false, code: 'contract_activation_failed' }
    }
    activeByProfile.set(profile, digest)
    await persist()
    return { ok: true, contract: candidate }
  }

  async function removeContract(digest: `sha256:${string}`): Promise<void> {
    const value = cached.get(digest)
    if (!value) return
    if (activeByProfile.get(value.entry.profile) === digest) {
      const fallback = [...bundled.values()].find((contract) => contract.profile === value.entry.profile)
      if (fallback) {
        const result = await activateContract(fallback.contract_digest, value.entry.profile)
        if (!result.ok)
          throw new ContractCacheError(
            'contract_reader_unsupported',
            'The bundled fallback contract cannot be activated.',
          )
      }
    }
    cached.delete(digest)
    await persist()
  }

  async function acceptStored(
    stored: ContractCacheStoredEntry,
    allowUnsupported: boolean,
  ): Promise<CachedContract | null> {
    if (cached.has(stored.digest) || bundled.has(stored.digest)) return cached.get(stored.digest) ?? null
    const loaded = await loadAuthoringContract(new TextEncoder().encode(stored.content), stored.source)
    if (loaded.ok) {
      if (loaded.contract.contract_digest !== stored.digest)
        throw new ContractCacheError(
          'contract_digest_mismatch',
          'The cached digest does not match the contract payload.',
        )
      const value = { entry: stored, contract: loaded.contract, canActivate: coverage(loaded.contract).length === 0 }
      cached.set(stored.digest, value)
      return value
    }
    if (loaded.code !== 'contract_reader_unsupported' || !allowUnsupported) {
      throw new ContractCacheError(
        loaded.code === 'contract_digest_mismatch' ? loaded.code : 'contract_shape_invalid',
        loaded.message,
      )
    }
    const inspected = await inspectUnsupported(stored.content)
    if (!inspected || inspected.digest !== stored.digest || inspected.profile !== stored.profile) {
      throw new ContractCacheError('contract_shape_invalid', 'The unsupported contract cache entry is malformed.')
    }
    const value = { entry: stored, contract: null, canActivate: false }
    cached.set(stored.digest, value)
    return value
  }

  async function persist(): Promise<void> {
    await options.native.contractCacheWrite(
      [...cached.values()].map(({ entry }) => ({
        ...entry,
        active: activeByProfile.get(entry.profile) === entry.digest,
      })),
    )
  }

  return {
    hydrate,
    importBytes,
    listCachedContracts,
    listAuthoringContracts,
    activeContract,
    activateContract,
    removeContract,
  }
}

function publicEntry(
  contract: AuthoringContract,
  status: ContractCacheSource,
  active: boolean,
  canActivate: boolean,
): ContractCacheEntry {
  return {
    digest: contract.contract_digest,
    profile: contract.profile,
    schemaVersion: contract.schema_version,
    normalizerVersion: contract.normalizer_version,
    readerVersion: contract.contract_reader_version,
    status,
    provenance: { kind: 'bundled', identifier: contract.profile },
    active,
    canActivate,
  }
}

async function storedFromBytes(bytes: Uint8Array, source: ContractSource): Promise<ContractCacheStoredEntry> {
  let content: string
  let payload: Record<string, unknown>
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed)) throw new Error('not an object')
    payload = parsed
  } catch {
    throw new ContractCacheError('contract_shape_invalid', 'The authoring contract must be UTF-8 JSON object.')
  }
  const digest = await verifiedDigest(payload)
  if (
    !isProfile(payload.profile) ||
    !isPositiveInteger(payload.schema_version) ||
    !isPositiveInteger(payload.normalizer_version) ||
    !isPositiveInteger(payload.contract_reader_version)
  ) {
    throw new ContractCacheError('contract_shape_invalid', 'The authoring contract is missing cache identity fields.')
  }
  return {
    digest,
    profile: payload.profile,
    schemaVersion: payload.schema_version,
    normalizerVersion: payload.normalizer_version,
    readerVersion: payload.contract_reader_version,
    source,
    content,
    active: false,
  }
}

async function inspectUnsupported(
  content: string,
): Promise<{ readonly digest: string; readonly profile: WorkflowProfile } | null> {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed) || !isProfile(parsed.profile)) return null
    return { digest: await verifiedDigest(parsed), profile: parsed.profile }
  } catch {
    return null
  }
}

async function verifiedDigest(payload: Record<string, unknown>): Promise<`sha256:${string}`> {
  if (typeof payload.contract_digest !== 'string' || !/^sha256:[0-9a-fA-F]{64}$/.test(payload.contract_digest)) {
    throw new ContractCacheError('contract_shape_invalid', 'The authoring contract digest is invalid.')
  }
  const actual = await sha256Hex(canonicalizeContractPayload(payload))
  const digest = payload.contract_digest.toLowerCase()
  if (digest !== `sha256:${actual}`)
    throw new ContractCacheError(
      'contract_digest_mismatch',
      'The authoring contract digest does not match its canonical payload.',
    )
  return digest as `sha256:${string}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isProfile(value: unknown): value is WorkflowProfile {
  return value === 'hermes-legacy' || value === 'archon-2026-07'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}
