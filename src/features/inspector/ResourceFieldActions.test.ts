import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import ResourceFieldActions from './ResourceFieldActions.svelte'
import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
const contract = {
  surfaces: [{ field_path: 'nodes[].script', scope: 'root', node_types: ['script'] }],
} as unknown as ResourceResolutionContract
it('shows actions only for declared resource fields and passes the focus origin', async () => {
  const onCreate = vi.fn()
  const view = render(ResourceFieldActions, {
    contract,
    fieldPath: 'nodes[].script',
    nodeKind: 'script',
    scope: 'root',
    inPackage: true,
    onCreate,
  })
  const button = screen.getByRole('button', { name: 'Create' })
  await fireEvent.click(button)
  expect(onCreate).toHaveBeenCalledWith(button)
  expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reveal in Package' })).toBeDisabled()
  await view.rerender({
    contract,
    fieldPath: 'nodes[].unknown',
    nodeKind: 'script',
    scope: 'root',
    inPackage: true,
    onCreate,
  })
  expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
})
it('blocks mutation for stale or non-package workflows and offers extraction for inline scripts', async () => {
  const view = render(ResourceFieldActions, {
    contract,
    fieldPath: 'nodes[].script',
    nodeKind: 'script',
    scope: 'root',
    inPackage: false,
    onCreate: vi.fn(),
    onSelect: vi.fn(),
  })
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  await view.rerender({
    contract,
    fieldPath: 'nodes[].script',
    nodeKind: 'script',
    scope: 'root',
    inPackage: true,
    disabledReason: 'Save the workflow first.',
    onCreate: vi.fn(),
    onSelect: vi.fn(),
  })
  expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
  expect(screen.getByText('Save the workflow first.')).toBeVisible()
  const onExtract = vi.fn()
  await view.rerender({
    contract,
    fieldPath: 'nodes[].script',
    nodeKind: 'script',
    scope: 'root',
    inPackage: true,
    inline: true,
    onCreate: vi.fn(),
    onExtract,
  })
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Extract to Resource' }))
  expect(onExtract).toHaveBeenCalledOnce()
})

it('links script actions to the exact offline runtime-resolution guide', async () => {
  const onHelp = vi.fn()
  const scriptContract = {
    surfaces: [{ field_path: 'nodes[].script', scope: 'root', node_types: ['script'], lookup_kind: 'script' }],
  } as unknown as ResourceResolutionContract
  render(ResourceFieldActions, {
    contract: scriptContract,
    fieldPath: 'nodes[].script',
    nodeKind: 'script',
    scope: 'root',
    inPackage: true,
    onHelp,
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Resource help' }))
  expect(onHelp).toHaveBeenCalledWith('guide:script-resources#runtime-resolution')
})
