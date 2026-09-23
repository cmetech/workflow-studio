import { atom, computed } from 'nanostores'
import type { PackageCatalog } from '$src/lib/packages/types'
export type PackageSelection = {
  readonly packageId: string
  readonly kind: 'overview' | 'artifact' | 'workflow'
  readonly path?: string
}
export interface PackageCatalogState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly workspaceId: string | null
  readonly catalog: PackageCatalog
  readonly active: PackageSelection | null
  readonly error: string | null
}
const empty = (): PackageCatalogState => ({
  phase: 'idle',
  workspaceId: null,
  catalog: { packages: [], findings: [] },
  active: null,
  error: null,
})
export const $packageCatalog = atom<PackageCatalogState>(empty())
export const $activePackageSelection = computed($packageCatalog, (state) => state.active)
export function resetPackages(): void {
  $packageCatalog.set(empty())
}
