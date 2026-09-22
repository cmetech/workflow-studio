import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import ImportWorkflowPackageDialog from './ImportWorkflowPackageDialog.svelte'
import type { PackageWorkflowSource } from '$src/lib/packages/creation'
const source = {
  kind: 'workspace',
  definition: { path: 'workflows/main.yaml', sourcePath: 'old.yaml', text: 'exact' },
  companion: { path: 'workflows/main.hermes.yaml', sourcePath: 'old.hermes.yaml', text: 'exact companion' },
  resources: [{ path: 'scripts/job.py', sourcePath: 'scripts/job.py', text: 'pass' }],
} as unknown as PackageWorkflowSource
it('previews exact move/copy paths and never offers deletion of shared resources', async () => {
  const onImport = vi.fn<(request: unknown) => Promise<void>>(async () => {
    throw new Error('Source changed; review again.')
  })
  render(ImportWorkflowPackageDialog, {
    root: 'packages/support',
    packageName: 'Support',
    sources: [{ id: 'old', label: 'Existing workflow', source }],
    onImport,
    onCancel: vi.fn(),
  })
  await fireEvent.click(screen.getByLabelText('Move workflow into package'))
  expect(screen.getByText('old.yaml ? packages/support/workflows/main.yaml')).toBeVisible()
  expect(screen.getByText('scripts/job.py ? packages/support/scripts/job.py (copy)')).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Move Workflow' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Source changed; review again.'))
  expect(onImport.mock.calls[0]?.[0]).toMatchObject({ root: 'packages/support', mode: 'move', workflow: source })
  expect(screen.getByRole('button', { name: 'Move Workflow' })).toBeEnabled()
})
