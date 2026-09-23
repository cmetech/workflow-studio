import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import ImportWorkflowPackageDialog from './ImportWorkflowPackageDialog.svelte'
import type { PackageWorkflowSource } from '$src/lib/packages/creation'
const source = {
  kind: 'workspace',
  authoring: { limits: { max_document_bytes: 10000 } },
  definition: { path: 'workflows/main.yaml', sourcePath: 'old.yaml', text: 'exact' },
  companion: { path: 'workflows/main.hermes.yaml', sourcePath: 'old.hermes.yaml', text: 'exact companion' },
  resources: [{ path: 'scripts/job.py', sourcePath: 'scripts/job.py', text: 'pass' }],
} as unknown as PackageWorkflowSource
it('previews chosen copy destinations and submits them separately from the selected source authority', async () => {
  const onImport = vi.fn()
  render(ImportWorkflowPackageDialog, {
    root: 'pkg',
    packageName: 'Demo',
    sources: [{ id: 'blank', label: 'Blank', source: { ...source, kind: 'blank' } }],
    onImport,
    onCancel: vi.fn(),
  })
  await fireEvent.input(screen.getByLabelText('Definition destination'), { target: { value: 'workflows/second.yaml' } })
  await fireEvent.input(screen.getByLabelText('Companion destination'), { target: { value: 'policies/second.yaml' } })
  await fireEvent.input(screen.getByLabelText('Workflow name'), { target: { value: 'Second workflow' } })
  expect(screen.getByText('old.yaml to pkg/workflows/second.yaml')).toBeVisible()
  expect(screen.getByText('old.hermes.yaml to pkg/policies/second.yaml')).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Copy Workflow' }))
  expect(onImport.mock.calls[0]?.[0]).toMatchObject({
    destination: { definition: 'workflows/second.yaml', companion: 'policies/second.yaml', name: 'Second workflow' },
    workflow: { definition: source.definition, companion: source.companion, resources: source.resources },
  })
})
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
  expect(screen.getByLabelText('Workflow name')).toBeDisabled()
  expect(screen.getByText('Moving preserves the source workflow name. Choose Copy to change it.')).toBeVisible()
  expect(screen.getByText('old.yaml to packages/support/workflows/main.yaml')).toBeVisible()
  expect(screen.getByText('scripts/job.py to packages/support/scripts/job.py (copy)')).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Move Workflow' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Source changed; review again.'))
  expect(onImport.mock.calls[0]?.[0]).toMatchObject({ root: 'packages/support', mode: 'move', workflow: source })
  expect(screen.getByRole('button', { name: 'Move Workflow' })).toBeEnabled()
})
