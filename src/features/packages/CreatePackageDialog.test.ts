import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import CreatePackageDialog from './CreatePackageDialog.svelte'
import type { PackageWorkflowSource } from '$src/lib/packages/creation'

const source = {
  kind: 'blank',
  definition: { path: 'workflows/main.yaml', text: '# exact\n' },
  companion: null,
  resources: [],
} as unknown as PackageWorkflowSource
it('collects metadata and previews exact files before sending one creation request', async () => {
  const onCreate = vi.fn<(request: unknown) => Promise<void>>(async () => undefined)
  render(CreatePackageDialog, {
    sources: [{ id: 'blank', label: 'Blank workflow', source }],
    onCreate,
    onCancel: vi.fn(),
  })
  for (const [label, value] of [
    ['Package ID', 'support'],
    ['Display name', 'Support'],
    ['Description', 'Help'],
    ['License', 'MIT'],
    ['Publisher', 'team'],
    ['Tags (comma separated)', 'one, two'],
  ])
    await fireEvent.input(screen.getByLabelText(label!), { target: { value } })
  await fireEvent.input(screen.getByLabelText('Destination folder'), { target: { value: 'packages/support' } })
  expect(screen.getByText('packages/support/workflows/main.yaml')).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Create Package' }))
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce())
  expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
    root: 'packages/support',
    metadata: {
      id: 'support',
      version: '1.0.0',
      displayName: 'Support',
      tags: ['one', 'two'],
      externalRequirements: { runtimes: [] },
    },
    workflow: source,
    mode: 'copy',
  })
})

it('keeps failed creation visible, disables missing source choices, and restores focus on cancel', async () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const view = render(CreatePackageDialog, { sources: [], onCreate: vi.fn(), onCancel: vi.fn(), opener })
  expect(screen.getByRole('button', { name: 'Create Package' })).toBeDisabled()
  expect(screen.getByText('No verified workflow sources are available.')).toBeVisible()
  view.unmount()
  await waitFor(() => expect(opener).toHaveFocus())
  opener.remove()
})

it('collects declared external requirements without inferring runtime availability', async () => {
  const onCreate = vi.fn<(request: unknown) => Promise<void>>(async () => {
    throw new Error('Destination changed; choose another folder.')
  })
  render(CreatePackageDialog, {
    sources: [{ id: 'blank', label: 'Blank workflow', source }],
    onCreate,
    onCancel: vi.fn(),
  })
  for (const [label, value] of [
    ['Package ID', 'support'],
    ['Display name', 'Support'],
    ['Description', 'Help'],
    ['License', 'MIT'],
    ['Publisher', 'team'],
    ['External runtimes', 'uv, bun'],
    ['External secrets', 'API_TOKEN'],
  ])
    await fireEvent.input(screen.getByLabelText(label!), { target: { value } })
  await fireEvent.click(screen.getByRole('button', { name: 'Create Package' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Destination changed'))
  expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
    metadata: { externalRequirements: { runtimes: ['uv', 'bun'], secrets: ['API_TOKEN'] } },
  })
  expect(screen.getByLabelText('Package ID')).toHaveValue('support')
})
