import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import type { WorkflowPackageContract } from '../package-contract/types'
import { freezePackageValue } from '../package-contract/package-contract-loader'
import { isCanonicalPackageText, parseUniqueJson } from './manifest'
import { comparePackagePaths, packagePathError, packagePathIdentity } from './paths'
import type { WorkflowPackageManifest } from './types'

export { MARKETPLACE_INDEX_PATH } from './marketplace-path'
export type MarketplaceEntry = Pick<
  WorkflowPackageManifest,
  'id' | 'version' | 'displayName' | 'description' | 'license' | 'publisher' | 'tags'
> & {
  readonly packagePath: string
  readonly contractVersion: 1
  readonly packageDigest: string
}
export interface MarketplaceIndex {
  readonly schemaVersion: 1
  readonly packages: readonly MarketplaceEntry[]
}
export type MarketplaceIndexResult =
  { readonly ok: true; readonly index: MarketplaceIndex } | { readonly ok: false; readonly code: string }
const validators = new WeakMap<WorkflowPackageContract, ValidateFunction>()
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function marketplaceEntry(
  manifest: WorkflowPackageManifest,
  packagePath: string,
  packageDigest: string,
): MarketplaceEntry {
  const { id, version, displayName, description, license, publisher, tags } = manifest
  return {
    id,
    version,
    displayName,
    description,
    license,
    publisher,
    tags: [...tags],
    packagePath,
    contractVersion: 1,
    packageDigest,
  }
}

/** Checks bytes separately so boundary recipes need not also be valid JSON. */
export function marketplaceIndexSizeError(bytes: Uint8Array, contract: WorkflowPackageContract): string | null {
  return bytes.byteLength > contract.resource_rules.max_index_bytes ? 'package_index_size_limit' : null
}

export function parseMarketplaceIndex(text: string, contract: WorkflowPackageContract): MarketplaceIndexResult {
  const fail = (code = 'package_index_invalid'): MarketplaceIndexResult => ({ ok: false, code })
  const sizeError = marketplaceIndexSizeError(new TextEncoder().encode(text), contract)
  if (sizeError) return fail(sizeError)
  let raw: unknown
  try {
    raw = parseUniqueJson(text)
  } catch {
    return fail()
  }
  if (!record(raw)) return fail()
  if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion !== 1) return fail('package_contract_unsupported')
  if (Array.isArray(raw.packages)) {
    if (raw.packages.length > contract.resource_rules.max_catalog_entries) return fail('package_catalog_entry_limit')
    const paths: string[] = []
    for (const entry of raw.packages) {
      if (!record(entry)) continue
      if (Number.isInteger(entry.contractVersion) && entry.contractVersion !== 1)
        return fail('package_contract_unsupported')
      if (typeof entry.packagePath === 'string') {
        const error = packagePathError(entry.packagePath)
        if (error) return fail(error)
        paths.push(packagePathIdentity(entry.packagePath))
      }
    }
    // Sorting identities makes segment ancestry checks linear after sorting.
    paths.sort(comparePackagePaths)
    const identities = new Set(paths)
    for (const path of paths) {
      const parts = path.split('/')
      for (let end = 1; end < parts.length; end++)
        if (identities.has(parts.slice(0, end).join('/'))) return fail('package_root_nested')
    }
    if (identities.size !== paths.length) return fail()
  }
  let validate = validators.get(contract)
  if (!validate) {
    validate = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }).compile(
      contract.marketplace_index_schema,
    )
    validators.set(contract, validate)
  }
  if (!validate(raw)) return fail()
  const index = raw as unknown as MarketplaceIndex
  let previous = ''
  for (const entry of index.packages) {
    if (comparePackagePaths(previous, entry.id) >= 0) return fail()
    previous = entry.id
    if (![entry.displayName, entry.description, entry.license, entry.publisher].every(isCanonicalPackageText))
      return fail()
    if (new Set(entry.tags).size !== entry.tags.length) return fail()
  }
  return { ok: true, index: freezePackageValue(index) }
}

export function generateMarketplaceIndex(
  entries: readonly MarketplaceEntry[],
  contract: WorkflowPackageContract,
): string {
  const packages = [...entries]
    .sort((a, b) => comparePackagePaths(a.id, b.id))
    .map((entry) => ({
      id: entry.id,
      version: entry.version,
      displayName: entry.displayName,
      description: entry.description,
      license: entry.license,
      publisher: entry.publisher,
      tags: [...entry.tags],
      packagePath: entry.packagePath,
      contractVersion: entry.contractVersion,
      packageDigest: entry.packageDigest,
    }))
  const text = JSON.stringify({ schemaVersion: 1, packages }, null, 2) + '\n'
  const result = parseMarketplaceIndex(text, contract)
  if (!result.ok) throw new Error(result.code)
  return text
}
