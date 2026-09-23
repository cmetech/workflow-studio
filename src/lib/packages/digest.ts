import type { PackageDigestContract, WorkflowPackageContract } from '../package-contract/types'
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import { parseUniqueJson } from './manifest'
import { comparePackagePaths, validatePackagePaths } from './paths'

const digestValidators = new WeakMap<WorkflowPackageContract, ValidateFunction>()
type DigestVerification = { readonly ok: true } | { readonly ok: false; readonly code: string }
interface DigestClaim {
  contractVersion: 1
  algorithm: 'sha256'
  files: { path: string; size: number; sha256: string }[]
  packageDigest: string
}

export async function verifyPackageDigests(
  text: string,
  files: readonly PackageFileHash[],
  contract: WorkflowPackageContract,
): Promise<DigestVerification> {
  const fail = (code = 'package_digest_invalid'): DigestVerification => ({ ok: false, code })
  if (new TextEncoder().encode(text).byteLength > contract.resource_rules.max_file_bytes)
    return fail('package_file_size_limit')
  let raw: unknown
  try {
    raw = parseUniqueJson(text)
  } catch {
    return fail()
  }
  let validate = digestValidators.get(contract)
  if (!validate) {
    validate = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }).compile(contract.digests_schema)
    digestValidators.set(contract, validate)
  }
  if (!validate(raw)) return fail()
  const claim = raw as DigestClaim
  const claimed = claim.files.map((file) => ({ relativePath: file.path, size: file.size, sha256: file.sha256 }))
  try {
    const canonical = orderPackageFileHashes(claimed, contract.digest_rules)
    if (
      canonical.length !== claimed.length ||
      canonical.some((file, index) => file.relativePath !== claimed[index]!.relativePath)
    )
      return fail()
  } catch {
    return fail()
  }
  const limit = packagePayloadLimitError(files, contract)
  if (limit) return fail(limit)
  const ordered = orderPackageFileHashes(files, contract.digest_rules)
  if (
    ordered.length !== claimed.length ||
    ordered.some((file, index) => {
      const expected = claimed[index]!
      return (
        file.relativePath !== expected.relativePath || file.size !== expected.size || file.sha256 !== expected.sha256
      )
    })
  )
    return fail('package_digest_mismatch')
  if (claim.packageDigest !== (await composePackageDigest(ordered, contract.digest_rules)))
    return fail('package_digest_mismatch')
  return { ok: true }
}

export async function generatePackageDigests(
  files: readonly PackageFileHash[],
  contract: WorkflowPackageContract,
): Promise<string> {
  const limit = packagePayloadLimitError(files, contract)
  if (limit) throw new Error(limit)
  const ordered = orderPackageFileHashes(files, contract.digest_rules)
  const text =
    JSON.stringify(
      {
        contractVersion: 1,
        algorithm: contract.digest_rules.algorithm,
        files: ordered.map((file) => ({ path: file.relativePath, size: file.size, sha256: file.sha256 })),
        packageDigest: await composePackageDigest(ordered, contract.digest_rules),
      },
      null,
      2,
    ) + '\n'
  const verified = await verifyPackageDigests(text, files, contract)
  if (!verified.ok) throw new Error(verified.code)
  return text
}

/** Exact byte hashes supplied by the bounded native scanner; identities stay with its snapshot. */
export interface PackageFileHash {
  readonly relativePath: string
  readonly size: number
  readonly sha256: string
}

export function packagePayloadLimitError(
  files: readonly PackageFileHash[],
  contract: WorkflowPackageContract,
): string | null {
  const payload = orderPackageFileHashes(files, contract.digest_rules)
  const limits = contract.resource_rules
  if (payload.length > limits.max_files) return 'package_file_count_limit'
  if (files.some((file) => file.size > limits.max_file_bytes)) return 'package_file_size_limit'
  if (payload.reduce((sum, file) => sum + file.size, 0) > limits.max_total_bytes) return 'package_total_size_limit'
  return null
}

export function orderPackageFileHashes(
  files: readonly PackageFileHash[],
  rules: PackageDigestContract,
): PackageFileHash[] {
  const findings = validatePackagePaths(
    files.map((file) => ({
      relativePath: file.relativePath,
      kind: 'file' as const,
      size: file.size,
      symlink: 'none' as const,
      modifiedAt: '',
      readOnly: false,
    })),
  )
  if (findings.length) throw new Error(findings[0]!.code)
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid package file size')
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid package file SHA-256')
  }
  return files
    .filter((file) => !rules.excluded_paths.includes(file.relativePath))
    .sort((left, right) => comparePackagePaths(left.relativePath, right.relativePath))
}

/** Compose the exported byte framing without reading files or normalizing their contents. */
export async function composePackageDigest(
  files: readonly PackageFileHash[],
  rules: PackageDigestContract,
): Promise<string> {
  const ordered = orderPackageFileHashes(files, rules)
  const encoder = new TextEncoder()
  const domain = Uint8Array.from(atob(rules.domain_separator_base64), (c) => c.charCodeAt(0))
  const paths = ordered.map((file) => encoder.encode(file.relativePath))
  const bytes = new Uint8Array(domain.length + paths.reduce((size, path) => size + 8 + path.length + 8 + 32, 0))
  bytes.set(domain)
  const view = new DataView(bytes.buffer)
  let offset = domain.length
  for (let index = 0; index < ordered.length; index++) {
    const file = ordered[index]!,
      path = paths[index]!
    view.setBigUint64(offset, BigInt(path.length), false)
    offset += 8
    bytes.set(path, offset)
    offset += path.length
    view.setBigUint64(offset, BigInt(file.size), false)
    offset += 8
    bytes.set(
      Uint8Array.from(file.sha256.match(/../g)!, (pair) => Number.parseInt(pair, 16)),
      offset,
    )
    offset += 32
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
