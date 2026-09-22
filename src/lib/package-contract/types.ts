export interface PackageContractSource {
  readonly sha256: string
}

export interface PackageLimits {
  readonly max_files: number
  readonly max_file_bytes: number
  readonly max_total_bytes: number
  readonly max_index_bytes: number
  readonly max_catalog_entries: number
  readonly max_traversal_entries: number
}

export interface PackagePathRules {
  readonly separator: '/'
  readonly relative_only: true
  readonly unicode_normalization: 'NFC'
  readonly reject_empty_segments: true
  readonly reject_dot_segments: true
  readonly reject_backslashes: true
  readonly reject_nul: true
  readonly reject_casefold_collisions: true
  readonly reject_symlinks: true
  readonly reject_nested_package_roots: true
  readonly reject_repository_metadata: true
}

export interface PackageDigestContract {
  readonly algorithm: 'sha256'
  readonly bytes: 'exact_no_normalization'
  readonly domain_separator_base64: string
  readonly excluded_paths: readonly string[]
  readonly file_hash_encoding: 'raw_32_byte_sha256'
  readonly file_size_encoding: 'unsigned_64_bit_big_endian'
  readonly included_paths: 'all_regular_files_below_package_root'
  readonly ordering: 'unicode_code_point_by_canonical_path'
  readonly path_length_encoding: 'unsigned_64_bit_big_endian'
}

export interface PackageCompatibilityRules {
  readonly missing_external_requirements: 'advisory'
  readonly semantic_version_standard: 'SemVer 2.0.0'
  readonly supported_contract_versions: readonly [1]
  readonly supported_index_schema_versions: readonly [1]
  readonly supported_manifest_schema_versions: readonly [1]
  readonly unsupported_versions: 'fail_closed'
  readonly version_comparison: 'SemVer_2.0.0_precedence_build_metadata_ignored'
}

export interface WorkflowPackageContract {
  readonly contract_version: 1
  readonly package_manifest_schema: Readonly<Record<string, unknown>>
  readonly marketplace_index_schema: Readonly<Record<string, unknown>>
  readonly digests_schema: Readonly<Record<string, unknown>>
  readonly path_rules: PackagePathRules
  readonly resource_rules: PackageLimits
  readonly digest_rules: PackageDigestContract
  readonly compatibility_rules: PackageCompatibilityRules
  readonly diagnostic_codes: Readonly<Record<string, string>>
}

export type PackageContractFailure = {
  readonly ok: false
  readonly code: 'unsupported_contract' | 'invalid_schema' | 'digest_mismatch'
  readonly message: string
}
export type PackageContractLoadResult =
  { readonly ok: true; readonly contract: WorkflowPackageContract } | PackageContractFailure

/** Vector payloads retain upstream recipes; consumers validate and execute their own family. */
export type PackageVector = Readonly<Record<string, unknown>> & { readonly name: string }
export interface WorkflowPackageVectors {
  readonly contractVersion: 1
  readonly digestVectors: readonly PackageVector[]
  readonly pathVectors: readonly PackageVector[]
  readonly validationVectors: readonly PackageVector[]
  readonly boundaryVectors: readonly PackageVector[]
}
export type PackageVectorsLoadResult =
  { readonly ok: true; readonly vectors: WorkflowPackageVectors } | PackageContractFailure
