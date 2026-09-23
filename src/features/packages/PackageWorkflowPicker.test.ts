import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageWorkflowPicker from './PackageWorkflowPicker.svelte'
import type { PackageWorkflowSource } from '$src/lib/packages/creation'
it('names sources and disables unverified imports', async () => {
  const onSelect = vi.fn()
  const source = { kind: 'example' } as PackageWorkflowSource
  render(PackageWorkflowPicker, {
    sources: [
      { id: 'example', label: 'Offline example', source },
      { id: 'missing', label: 'Missing resources', source, disabledReason: 'Resolve resource origins first.' },
    ],
    selectedId: 'example',
    onSelect,
  })
  expect(screen.getByRole('option', { name: 'Missing resources - Resolve resource origins first.' })).toBeDisabled()
  await fireEvent.change(screen.getByLabelText('First workflow'), { target: { value: 'example' } })
  expect(onSelect).toHaveBeenCalledWith('example')
})
