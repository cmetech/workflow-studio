import Ajv2020, { type ValidateFunction, type AnySchema } from 'ajv/dist/2020.js'
import type { WorkflowPackageContract } from '$src/lib/package-contract/types'
import { comparePackagePaths } from '$src/lib/packages/paths'
import { isCanonicalPackageText } from '$src/lib/packages/manifest'

const validators = new WeakMap<WorkflowPackageContract, ValidateFunction>()
function parseVersion(value: string, contract: WorkflowPackageContract) {
  let validate = validators.get(contract)
  if (!validate) {
    const properties = contract.package_manifest_schema.properties as Record<string, unknown>
    validate = new Ajv2020({ strict: true }).compile(properties.version as AnySchema)
    validators.set(contract, validate)
  }
  if (!isCanonicalPackageText(value) || !validate(value)) throw new Error('package_version_invalid')
  const core = value.split('+')[0]!
  const separator = core.indexOf('-')
  const stable = separator === -1 ? core : core.slice(0, separator)
  return {
    numbers: stable.split('.').map(BigInt),
    prerelease: separator === -1 ? [] : core.slice(separator + 1).split('.'),
  }
}
const compare = (left: bigint | string, right: bigint | string): -1 | 0 | 1 =>
  left === right ? 0 : left < right ? -1 : 1

/** SemVer precedence from the pinned contract; build metadata never changes precedence. */
export function comparePackageVersions(left: string, right: string, contract: WorkflowPackageContract): -1 | 0 | 1 {
  const a = parseVersion(left, contract),
    b = parseVersion(right, contract)
  for (let i = 0; i < 3; i++) {
    const order = compare(a.numbers[i]!, b.numbers[i]!)
    if (order) return order
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const av = a.prerelease[i],
      bv = b.prerelease[i]
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1
    const an = /^[0-9]+$/.test(av),
      bn = /^[0-9]+$/.test(bv)
    const order = an && bn ? compare(BigInt(av), BigInt(bv)) : an !== bn ? (an ? -1 : 1) : compare(av, bv)
    if (order) return order
  }
  return 0
}
export function packageVersionError(
  version: string,
  baseline: string | null,
  contract: WorkflowPackageContract,
): string | null {
  try {
    parseVersion(version, contract)
    if (baseline !== null && comparePackageVersions(version, baseline, contract) <= 0)
      return 'package_version_not_increased'
    return null
  } catch {
    return 'package_version_invalid'
  }
}
export interface PackageChangeSummary {
  readonly removedWorkflows: readonly string[]
  readonly addedCapabilities: readonly string[]
  readonly compatibilityChanged: boolean
}
export function suggestPackageVersion(
  change: PackageChangeSummary,
  baseline: string,
  contract: WorkflowPackageContract,
) {
  const [major, minor, patch] = parseVersion(baseline, contract).numbers as [bigint, bigint, bigint]
  const kind =
    change.removedWorkflows.length || change.compatibilityChanged
      ? 'major'
      : change.addedCapabilities.length
        ? 'minor'
        : 'patch'
  const version =
    kind === 'major'
      ? `${major + BigInt(1)}.0.0`
      : kind === 'minor'
        ? `${major}.${minor + BigInt(1)}.0`
        : `${major}.${minor}.${patch + BigInt(1)}`
  parseVersion(version, contract)
  return {
    kind,
    version,
    reasons:
      kind === 'major'
        ? ['A workflow was removed or declared compatibility changed.']
        : kind === 'minor'
          ? ['The package adds a workflow or resource capability.']
          : ['The package contains fixes, metadata, documentation, or fixture changes.'],
  }
}
export interface PackageFileVersion {
  readonly relativePath: string
  readonly sha256: string
  readonly size: number
}
export interface PackageFileChange {
  readonly kind: 'added' | 'modified' | 'removed'
  readonly path: string
}
export function comparePackageFiles(
  before: readonly PackageFileVersion[],
  after: readonly PackageFileVersion[],
): PackageFileChange[] {
  const previous = new Map(before.map((file) => [file.relativePath, file])),
    current = new Map(after.map((file) => [file.relativePath, file]))
  const changes: PackageFileChange[] = []
  for (const path of [...new Set([...previous.keys(), ...current.keys()])].sort(comparePackagePaths)) {
    const old = previous.get(path),
      next = current.get(path)
    if (!old) changes.push({ kind: 'added', path })
    else if (!next) changes.push({ kind: 'removed', path })
    else if (old.sha256 !== next.sha256 || old.size !== next.size) changes.push({ kind: 'modified', path })
  }
  return changes
}
