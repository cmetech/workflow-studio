import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '$src/lib/workspace/types'
import QuickOpen from './QuickOpen.svelte'

const entries: readonly WorkspaceEntry[] = [
  {
    kind: 'workflow',
    id: 'one',
    name: 'Release.yaml',
    relativePath: 'flows/Release.yaml',
    definitionPath: 'flows/Release.yaml',
    companionPath: null,
    state: 'legacy',
    readOnly: false,
  },
  {
    kind: 'workflow',
    id: 'two',
    name: 'Deploy.yaml',
    relativePath: 'ops/Deploy.yaml',
    definitionPath: 'ops/Deploy.yaml',
    companionPath: null,
    state: 'legacy',
    readOnly: false,
  },
]

describe('QuickOpen', () => {
  it('filters path metadata without a content reader and opens the selected result from the keyboard', async () => {
    const onOpen = vi.fn()
    render(QuickOpen, { entries, onOpen })
    const search = screen.getByRole('combobox', { name: 'Quick Open workflows' })
    await fireEvent.input(search, { target: { value: 'ops' } })
    expect(screen.queryByRole('option', { name: /Release/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Deploy/ })).toBeVisible()
    await fireEvent.keyDown(search, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'ops/Deploy.yaml' }))
  })
})
