import { render, screen } from '@testing-library/svelte'
import { expect, it } from 'vitest'
import PackageOverview from './PackageOverview.svelte'
import type { WorkflowPackageProjection } from '$src/lib/packages/types'
export const pkg: WorkflowPackageProjection = {
  id: 'test',
  root: 'p',
  manifestPath: 'p/workflow-package.json',
  manifest: {
    schemaVersion: 1,
    id: 'test',
    version: '1.0.0',
    displayName: 'Test package',
    description: 'Description',
    license: 'MIT',
    publisher: 'Publisher',
    tags: [],
    workflows: [],
    externalRequirements: { runtimes: [], tools: [], providers: [], services: [], secrets: [] },
  },
  workflows: [],
  artifacts: [],
}
it('never claims that discovery has completed preparation checks', () => {
  render(PackageOverview, { package: pkg })
  expect(screen.getByRole('heading', { name: 'Test package' })).toBeVisible()
  expect(screen.getByText(/Complete package scan/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare Package' })).toBeDisabled()
})
