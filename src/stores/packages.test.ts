import { beforeEach, expect, it } from 'vitest'
import { $activePackageSelection, $packageCatalog, resetPackages } from './packages'
beforeEach(resetPackages)
it('derives active selection from the catalog and clears both on reset', () => {
  $packageCatalog.set({ ...$packageCatalog.get(), workspaceId: 'w', active: { kind: 'overview', packageId: 'p' } })
  expect($activePackageSelection.get()).toEqual({ kind: 'overview', packageId: 'p' })
  resetPackages()
  expect($activePackageSelection.get()).toBeNull()
  expect($packageCatalog.get().workspaceId).toBeNull()
})
