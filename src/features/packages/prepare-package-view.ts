import type { PackageAnalysis } from '$src/lib/packages/readiness'

export interface PackageChange {
  kind: 'added' | 'modified' | 'removed' | 'renamed' | 'metadata'
  path: string
  previousPath?: string
  trustImpact?: boolean
}
export interface PreparePackageFailure {
  message: string
  recovery: readonly string[]
}
export type PreparePackageView =
  | { step: 'validate'; busy?: boolean; analysis?: PackageAnalysis; error?: PreparePackageFailure }
  | {
      step: 'review' | 'version'
      busy?: boolean
      analysis: PackageAnalysis
      changes: readonly PackageChange[]
      includedPaths: readonly string[]
      trustChanges: readonly string[]
      suggestedVersion: string
      suggestionReasons: readonly string[]
      finalPreview?: { diff: string; version: string; message: string }
      error?: PreparePackageFailure
    }
  | {
      step: 'complete'
      commitOid: string
      version: string
      includedPaths: readonly string[]
      warnings?: readonly string[]
    }
