import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageOverview from './PackageOverview.svelte'
import type { WorkflowPackageProjection } from '$src/lib/packages/types'
import type { PackageAnalysis } from '$src/lib/packages/readiness'
import { MARKETPLACE_INDEX_PATH } from '$src/lib/packages/marketplace-index'
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

const blocked: PackageAnalysis = {
  ready: false,
  findings: [],
  advisories: [],
  blockers: [
    {
      code: 'invalid',
      path: 'scripts/run.py',
      line: 3,
      column: 4,
      message: 'Fix this script.',
      severity: 'blocking',
    },
    { code: 'missing', path: 'missing.py', message: 'Missing resource.', severity: 'blocking' },
    { code: 'unsafe', path: '../secret.txt', message: 'Unsafe path.', severity: 'blocking' },
    { code: 'escape', path: 'p/../../secret.txt', message: 'Traversal path.', severity: 'blocking' },
    { code: 'outside', path: 'another-package/run.py', message: 'Outside selected package.', severity: 'blocking' },
    {
      code: 'index',
      path: MARKETPLACE_INDEX_PATH,
      line: 2,
      column: 1,
      message: 'Repair the shared index.',
      severity: 'blocking',
    },
  ],
  references: { references: [], inlineScripts: [], findings: [], unreferencedPaths: [], forNode: () => [] },
  executionSurface: { workflowPaths: [], artifactPaths: [], inlineScripts: [] },
}

it('opens existing safe finding locations while blocked preparation remains disabled', async () => {
  const onOpenArtifact = vi.fn(),
    onPrepare = vi.fn()
  render(PackageOverview, {
    package: {
      ...pkg,
      artifacts: [
        { path: 'scripts/run.py', workspacePath: 'p/scripts/run.py', kind: 'file', size: 1, readOnly: false },
        { path: '../secret.txt', workspacePath: '../secret.txt', kind: 'file', size: 1, readOnly: false },
        { path: 'run.py', workspacePath: 'another-package/run.py', kind: 'file', size: 1, readOnly: false },
      ],
    },
    analysis: blocked,
    onOpenArtifact,
    onPrepare,
  })
  expect(screen.getByRole('button', { name: 'Prepare Package' })).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Open scripts/run.py:3:4' }))
  expect(onOpenArtifact).toHaveBeenCalledExactlyOnceWith('scripts/run.py', 3, 4)
  expect(onPrepare).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Open missing.py' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open ../secret.txt' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open p/../../secret.txt' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open another-package/run.py' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: `Open ${MARKETPLACE_INDEX_PATH}:2:1` })).not.toBeInTheDocument()
  expect(screen.getByText(/Missing resource/)).toBeVisible()
  expect(screen.getByText(/Unsafe path/)).toBeVisible()
  expect(screen.getByText(/Dependencies, credentials, services, trust/)).toBeVisible()
})

it('links the shared index only when its existence is confirmed and an opener is available', async () => {
  const onOpenArtifact = vi.fn()
  const props = { package: pkg, analysis: blocked, hasMarketplaceIndex: true }
  const { rerender } = render(PackageOverview, props)
  expect(screen.queryByRole('button', { name: `Open ${MARKETPLACE_INDEX_PATH}:2:1` })).not.toBeInTheDocument()
  await rerender({ ...props, onOpenArtifact })
  await fireEvent.click(screen.getByRole('button', { name: `Open ${MARKETPLACE_INDEX_PATH}:2:1` }))
  expect(onOpenArtifact).toHaveBeenCalledExactlyOnceWith(MARKETPLACE_INDEX_PATH, 2, 1)
  await rerender({ ...props, hasMarketplaceIndex: false, onOpenArtifact })
  expect(screen.queryByRole('button', { name: `Open ${MARKETPLACE_INDEX_PATH}:2:1` })).not.toBeInTheDocument()
})

it('offers explicit removal for a declared workflow without removing it on selection', async () => {
  const onRemoveWorkflow = vi.fn()
  render(PackageOverview, {
    package: { ...pkg, workflows: [{ definition: 'main.yaml', companion: 'policy/custom.yaml' }] },
    onRemoveWorkflow,
  })
  expect(onRemoveWorkflow).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: 'Remove Workflow: main.yaml' }))
  expect(onRemoveWorkflow).toHaveBeenCalledWith('main.yaml')
})
