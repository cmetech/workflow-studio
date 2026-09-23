import { atom } from 'nanostores'
import type { PackageAnalysis } from '$src/lib/packages/readiness'

export const $packageReadiness = atom<{ workspaceId: string; root: string; analysis: PackageAnalysis } | null>(null)
export const $preparedPackage = atom<{
  workspaceId: string
  root: string
  packageId: string
  version: string
  commitOid: string
} | null>(null)
export function resetPackagePreparation(): void {
  $packageReadiness.set(null)
  $preparedPackage.set(null)
}
